// Permanently deletes the signed-in person's account.
//
// Before deleting: projects they created but co-own pass to another owner (projects.owner_id
// cascades on delete, so leaving it would delete the project for everyone); projects where
// they're the only member are deleted with their files; and it refuses while they're the only
// owner of a project other people are still in. Their avatar and uploaded files are removed
// from storage, then the auth user is deleted, which cascades to their profile, memberships,
// comments and attachment records.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    // Checked with the service role client, so it works whether or not the legacy anon key is enabled.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!user) return json({ error: 'Sign in to delete your account.' }, 401);

    // With two-factor on, deleting needs a session that passed it.
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    const aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal;
    if (factors?.factors?.some((f) => f.status === 'verified') && aal !== 'aal2') {
      return json({ error: 'Enter your two-factor code first, then try again.' }, 403);
    }

    const { data: memberships } = await admin.from('project_members').select('project_id, role').eq('user_id', user.id);
    const projectIds = (memberships ?? []).map((m) => m.project_id);
    const { data: everyone } = projectIds.length
      ? await admin.from('project_members').select('project_id, user_id, role').in('project_id', projectIds)
      : { data: [] };
    const { data: projects } = projectIds.length
      ? await admin.from('projects').select('id, name, owner_id').in('id', projectIds)
      : { data: [] };

    const others = (pid: string) => (everyone ?? []).filter((m) => m.project_id === pid && m.user_id !== user.id);
    const blocked: string[] = [];
    const solo: string[] = [];
    const handOver: { id: string; to: string }[] = [];

    for (const p of projects ?? []) {
      const rest = others(p.id);
      const mine = memberships!.find((m) => m.project_id === p.id);
      const otherOwner = rest.find((m) => m.role === 'owner');
      if (rest.length === 0) solo.push(p.id);
      else if (mine?.role === 'owner' && !otherOwner) blocked.push(p.name);
      else if (p.owner_id === user.id && otherOwner) handOver.push({ id: p.id, to: otherOwner.user_id });
    }
    if (blocked.length) {
      return json({
        error: `You're the only owner of ${blocked.join(', ')}. Make someone else an owner first, or delete ${blocked.length === 1 ? 'that project' : 'those projects'}.`,
      }, 409);
    }

    for (const h of handOver) {
      const { error } = await admin.from('projects').update({ owner_id: h.to }).eq('id', h.id);
      if (error) throw error;
    }
    // Created by them, but they're not a member any more: also cascades unless handed over.
    const { data: orphaned } = await admin.from('projects').select('id').eq('owner_id', user.id).not('id', 'in', `(${projectIds.join(',') || '00000000-0000-0000-0000-000000000000'})`);
    for (const p of orphaned ?? []) {
      const { data: owner } = await admin.from('project_members').select('user_id').eq('project_id', p.id).eq('role', 'owner').limit(1).maybeSingle();
      if (owner) await admin.from('projects').update({ owner_id: owner.user_id }).eq('id', p.id);
    }

    // Files: attachments in projects being deleted, attachments they uploaded elsewhere, avatars.
    // Only paths inside their own task's folder: the service role could delete anyone's file.
    const { data: files } = await admin.from('task_attachments').select('path, project_id, task_id')
      .or(`created_by.eq.${user.id}${solo.length ? `,project_id.in.(${solo.join(',')})` : ''}`);
    const paths = (files ?? []).map((f) => f.path).filter((path, i) => {
      const folder = `${files![i].project_id}/${files![i].task_id}/`;
      return path.startsWith(folder) && !path.slice(folder.length).includes('/') && !path.includes('..');
    });
    if (paths.length) await admin.storage.from('attachments').remove(paths);
    const { data: avatars } = await admin.storage.from('avatars').list(user.id);
    if (avatars?.length) await admin.storage.from('avatars').remove(avatars.map((a) => `${user.id}/${a.name}`));

    if (solo.length) {
      const { error } = await admin.from('projects').delete().in('id', solo);
      if (error) throw error;
    }

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return json({ deleted: true, projectsDeleted: solo.length });
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong deleting your account. Try again, and contact the project owner if it keeps failing.' }, 500);
  }
});
