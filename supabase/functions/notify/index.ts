// Kahon notification emails, sent through Resend.
//
// The app calls this after an action with only an event type and an id. Recipients
// and content are always looked up here, from the database, so a caller can't use
// this to email arbitrary people or text: they must be signed in, be a member of
// the project, and (for comments) be the comment's author.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM ("Kahon <notifications@yourdomain.com>"),
// APP_URL ("https://kahon.vercel.app"). SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Kahon <onboarding@resend.dev>';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');

// At most one email per kind, item and person in this window.
const DEDUPE_MINUTES = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Admin = SupabaseClient;
type Email = { subject: string; heading: string; intro: string; quote?: string; cta: string; url: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const handler = HANDLERS[body?.type as keyof typeof HANDLERS];
    if (!handler) return json({ error: 'Unknown notification type' }, 400);

    const sent = await handler(admin, user.id, body);
    return json({ sent });
  } catch (err) {
    console.error(err);
    return json({ error: 'Could not send notification' }, 500);
  }
});

const HANDLERS = {
  // {}: a sample email to the caller's own address, to check delivery end to end.
  async test(admin: Admin, actorId: string) {
    const { data: me } = await admin.from('profiles').select('id, email, full_name').eq('id', actorId).single();
    if (!me?.email) return 0;
    return deliver(admin, me, 'test', me.id, {
      subject: 'Kahon test email',
      heading: 'Email is working',
      intro: `Hi ${me.full_name || 'there'}, this is a test from Kahon. If you can read this, notification emails are set up correctly.`,
      cta: 'Open Kahon',
      url: APP_URL || 'https://resend.com',
    }, 1); // test sends may repeat after a minute
  },

  // { task_id }: email the task's assignee.
  async task_assigned(admin: Admin, actorId: string, { task_id }: { task_id?: string }) {
    const task = await getTask(admin, task_id);
    if (!task || !(await isMember(admin, task.project_id, actorId))) return 0;
    return send(admin, {
      kind: 'task_assigned', refId: task.id, recipientIds: [task.assignee_id], actorId,
      build: (actor) => ({
        subject: `${actor} assigned you "${task.title}"`,
        heading: 'You have a new task',
        intro: `${actor} assigned you a task in ${task.project.name}.`,
        quote: task.title,
        cta: 'Open task',
        url: `${APP_URL}/p/${task.project_id}?task=${task.id}`,
      }),
    });
  },

  // { project_id, user_id }: email someone the project owner just added.
  async member_added(admin: Admin, actorId: string, { project_id, user_id }: { project_id?: string; user_id?: string }) {
    if (!project_id || !user_id) return 0;
    const { data: rows } = await admin.from('project_members').select('user_id, role')
      .eq('project_id', project_id).in('user_id', [actorId, user_id]);
    const actorIsOwner = rows?.some((r) => r.user_id === actorId && r.role === 'owner');
    const added = rows?.some((r) => r.user_id === user_id);
    if (!actorIsOwner || !added) return 0;
    const { data: project } = await admin.from('projects').select('id, name').eq('id', project_id).single();
    if (!project) return 0;
    return send(admin, {
      kind: 'member_added', refId: project.id, recipientIds: [user_id], actorId,
      build: (actor) => ({
        subject: `${actor} added you to ${project.name}`,
        heading: `You've joined ${project.name}`,
        intro: `${actor} added you to the ${project.name} project on Kahon. You can now see and work on its tasks.`,
        cta: 'Open project',
        url: `${APP_URL}/p/${project.id}`,
      }),
    });
  },

  // { comment_id }: email the task's assignee and creator, except the commenter.
  async comment_added(admin: Admin, actorId: string, { comment_id }: { comment_id?: string }) {
    if (!comment_id) return 0;
    const { data: comment } = await admin.from('comments').select('id, body, author_id, task_id').eq('id', comment_id).single();
    if (!comment || comment.author_id !== actorId) return 0;
    const task = await getTask(admin, comment.task_id);
    if (!task) return 0;
    return send(admin, {
      // Keyed by task, so a burst of comments sends one email, not one per comment.
      kind: 'comment_added', refId: task.id, recipientIds: [task.assignee_id, task.created_by], actorId,
      build: (actor) => ({
        subject: `${actor} commented on "${task.title}"`,
        heading: 'New comment',
        intro: `${actor} commented on "${task.title}" in ${task.project.name}.`,
        quote: comment.body.length > 600 ? `${comment.body.slice(0, 600)}…` : comment.body,
        cta: 'Reply in Kahon',
        url: `${APP_URL}/p/${task.project_id}?task=${task.id}`,
      }),
    });
  },
};

async function getTask(admin: Admin, id?: string) {
  if (!id) return null;
  const { data } = await admin.from('tasks')
    .select('id, title, project_id, assignee_id, created_by, project:projects(name)')
    .eq('id', id).single();
  return data as null | {
    id: string; title: string; project_id: string; assignee_id: string | null; created_by: string | null;
    project: { name: string };
  };
}

async function isMember(admin: Admin, projectId: string, userId: string) {
  const { count } = await admin.from('project_members').select('user_id', { count: 'exact', head: true })
    .eq('project_id', projectId).eq('user_id', userId);
  return (count ?? 0) > 0;
}

// Emails each recipient once (never the actor, never someone who opted out, never
// twice inside the dedupe window) and logs it. Returns how many were sent.
async function send(admin: Admin, opts: {
  kind: string; refId: string; recipientIds: (string | null)[]; actorId: string; build: (actor: string) => Email;
}) {
  const ids = [...new Set(opts.recipientIds.filter((id): id is string => !!id && id !== opts.actorId))];
  if (!ids.length) return 0;
  const { data: people } = await admin.from('profiles')
    .select('id, email, full_name, email_notifications').in('id', [...ids, opts.actorId]);
  const actor = people?.find((p) => p.id === opts.actorId);
  const email = opts.build(actor?.full_name || actor?.email || 'Someone');

  let sent = 0;
  for (const person of people ?? []) {
    if (!ids.includes(person.id) || !person.email || !person.email_notifications) continue;
    try {
      sent += await deliver(admin, person, opts.kind, opts.refId, email);
    } catch (err) {
      console.error(err); // one failed recipient shouldn't stop the rest
    }
  }
  return sent;
}

// Sends one email unless the same kind/item/person was sent inside the dedupe
// window, then logs it. Returns 1 when sent, 0 when skipped.
async function deliver(
  admin: Admin, person: { id: string; email: string }, kind: string, refId: string, email: Email,
  dedupeMinutes = DEDUPE_MINUTES,
) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();
  const { count } = await admin.from('email_log').select('id', { count: 'exact', head: true })
    .eq('kind', kind).eq('ref_id', refId).eq('recipient_id', person.id).gte('sent_at', since);
  if (count) return 0;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [person.email], subject: email.subject, html: renderHtml(email), text: renderText(email) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  await admin.from('email_log').insert({ kind, ref_id: refId, recipient_id: person.id });
  return 1;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderText(e: Email) {
  return [e.heading, '', e.intro, e.quote ? `\n"${e.quote}"\n` : '', `${e.cta}: ${e.url}`, '',
    'You get these emails because you use Kahon. Turn them off in Settings, under Notifications.'].join('\n');
}

// Inline styles only: email clients ignore <style> blocks and CSS variables.
function renderHtml(e: Email) {
  const logo = APP_URL ? `<img src="${esc(APP_URL)}/icons/icon-192.png" width="28" height="28" alt="" style="display:block;border-radius:6px" />` : '';
  const quote = e.quote
    ? `<div style="margin:18px 0 0;padding:12px 14px;border-left:3px solid #3DBE6B;background:#F4F8F5;border-radius:6px;color:#13341F;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(e.quote)}</div>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#F4F8F5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#13341F">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #D3E2D8;border-radius:12px">
      <tr><td style="padding:18px 24px;background:#13341F;border-radius:12px 12px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:10px">${logo}</td>
          <td style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.3px">Kahon</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:26px 24px 8px">
        <h1 style="margin:0;font-size:20px;line-height:1.3;color:#13341F">${esc(e.heading)}</h1>
        <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:#4A6B56">${esc(e.intro)}</p>
        ${quote}
        <p style="margin:24px 0 0"><a href="${esc(e.url)}" style="display:inline-block;padding:11px 18px;background:#15703C;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">${esc(e.cta)}</a></p>
      </td></tr>
      <tr><td style="padding:22px 24px 22px;font-size:12px;line-height:1.5;color:#7A8F80">
        You get these emails because you use Kahon. Turn them off in Settings, under Notifications.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
