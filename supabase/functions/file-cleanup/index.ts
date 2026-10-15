// Deletes the files of projects that have been Complete for 2 days, when a super admin has
// turned auto delete on (Super admin -> File cleanup). Called every hour by pg_cron (see the
// file-cleanup migration) with the secret kept in Supabase Vault; anyone else gets a 401.
//
// Only files go: task attachments and project reference files, from storage and their rows.
// Projects, tasks and comments stay. Each project is checked again right before its files are
// removed, so one reopened in the meantime keeps them.

import { adminClient, json } from '../_shared/auth.ts';

const BUCKET = 'attachments';
const CHUNK = 100; // storage.remove takes a list of paths; keep each request small

type Due = { project_id: string; project_name: string; workspace: string | null; files: number; bytes: number };
type FileRow = { id: string; path: string; size_bytes: number };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const admin = adminClient();

  const { data: ok } = await admin.rpc('check_reminder_secret', { p_secret: req.headers.get('x-reminder-secret') ?? '' });
  if (!ok) return json({ error: 'Unauthorized' }, 401);

  // The cron job skips the call while it's off, but it could have been turned off since.
  const { data: enabled } = await admin.rpc('file_cleanup_enabled');
  if (!enabled) return json({ skipped: 'off' });

  const { data: due, error } = await admin.rpc('file_cleanup_due');
  if (error) {
    console.error(error);
    return json({ error: 'Could not load projects' }, 500);
  }

  let projects = 0;
  let deleted = 0;
  for (const p of (due ?? []) as Due[]) {
    try {
      // Still complete? Someone may have reopened it since file_cleanup_due() ran.
      const { data: project } = await admin.from('projects').select('status').eq('id', p.project_id).single();
      if (project?.status !== 'complete') continue;

      const [{ data: attachments }, { data: projectFiles }] = await Promise.all([
        admin.from('task_attachments').select('id, path, size_bytes').eq('project_id', p.project_id),
        admin.from('project_files').select('id, path, size_bytes').eq('project_id', p.project_id),
      ]);
      const all = [...(attachments ?? []), ...(projectFiles ?? [])] as FileRow[];
      if (!all.length) continue;

      // Storage first: a row without its file is harmless, a file without its row is never cleaned up.
      let failed = false;
      for (let i = 0; i < all.length; i += CHUNK) {
        const { error: rmError } = await admin.storage.from(BUCKET).remove(all.slice(i, i + CHUNK).map((f) => f.path));
        if (rmError) {
          console.error(`file-cleanup: storage remove failed for ${p.project_id}`, rmError.message);
          failed = true;
          break;
        }
      }
      if (failed) continue;

      const ids = (rows: FileRow[] | null) => (rows ?? []).map((r) => r.id);
      if (attachments?.length) await admin.from('task_attachments').delete().in('id', ids(attachments));
      if (projectFiles?.length) await admin.from('project_files').delete().in('id', ids(projectFiles));

      await admin.from('file_cleanup_log').insert({
        project_id: p.project_id,
        project_name: p.project_name,
        workspace: p.workspace,
        files: all.length,
        bytes: all.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0),
      });
      projects += 1;
      deleted += all.length;
    } catch (e) {
      console.error(`file-cleanup: ${p.project_id}`, e);
    }
  }

  return json({ projects, files: deleted });
});
