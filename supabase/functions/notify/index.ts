// Kahon notification emails, sent through Resend.
//
// The app calls this after an action with only an event type and an id. Recipients
// and content are always looked up here, from the database, so a caller can't use
// this to email arbitrary people or text: they must be signed in (with two-factor if
// it's on), be a member of the project, and (for comments) be the comment's author.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM ("Kahon <notifications@yourdomain.com>"),
// APP_URL ("https://kahon.vercel.app"). SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { CORS, json, requireUser } from '../_shared/auth.ts';
import { APP_URL, type Email, plainMentions, sendEmail } from '../_shared/email.ts';

// At most one email per kind, item and person in this window.
const DEDUPE_MINUTES = 10;
// Re-sending an invitation is allowed this often.
const INVITE_RESEND_MINUTES = 5;
const MENTION = /@\[[^\]]{1,120}\]\(([0-9a-f-]{36})\)/g;

type Admin = SupabaseClient;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const auth = await requireUser(req);
    if ('response' in auth) return auth.response;
    const body = await req.json().catch(() => ({}));
    const handler = HANDLERS[body?.type as keyof typeof HANDLERS];
    if (!handler) return json({ error: 'Unknown notification type' }, 400);

    const sent = await handler(auth.admin, auth.user.id, body);
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

  // { task_id, user_id? }: email the task's assignee, or `user_id` when they were added as
  // an extra assignee (only if they really are one).
  async task_assigned(admin: Admin, actorId: string, { task_id, user_id }: { task_id?: string; user_id?: string }) {
    const task = await getTask(admin, task_id);
    if (!task || !(await isMember(admin, task.project_id, actorId))) return 0;
    let recipient = task.assignee_id;
    if (user_id) {
      const { count } = await admin.from('task_assignees').select('user_id', { count: 'exact', head: true })
        .eq('task_id', task.id).eq('user_id', user_id);
      recipient = count ? user_id : null;
    }
    return send(admin, {
      kind: 'task_assigned', refId: task.id, recipientIds: [recipient], actorId,
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

  // { comment_id }: email people @mentioned in it (if they're in the project), then the
  // task's assignees and creator, except the commenter.
  async comment_added(admin: Admin, actorId: string, { comment_id }: { comment_id?: string }) {
    if (!comment_id) return 0;
    const { data: comment } = await admin.from('comments').select('id, body, author_id, task_id').eq('id', comment_id).single();
    if (!comment || comment.author_id !== actorId) return 0;
    const task = await getTask(admin, comment.task_id);
    if (!task) return 0;

    const text = plainMentions(comment.body);
    const quote = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    const url = `${APP_URL}/p/${task.project_id}?task=${task.id}`;

    const tagged = [...new Set([...comment.body.matchAll(MENTION)].map((m) => m[1]))];
    const { data: members } = tagged.length
      ? await admin.from('project_members').select('user_id').eq('project_id', task.project_id).in('user_id', tagged)
      : { data: [] };
    const mentioned = (members ?? []).map((m) => m.user_id);

    const { data: extra } = await admin.from('task_assignees').select('user_id').eq('task_id', task.id);
    const followers = [task.assignee_id, task.created_by, ...(extra ?? []).map((a) => a.user_id)]
      .filter((id) => id && !mentioned.includes(id));

    let sent = await send(admin, {
      kind: 'mentioned', refId: comment.id, recipientIds: mentioned, actorId,
      build: (actor) => ({
        subject: `${actor} mentioned you on "${task.title}"`,
        heading: 'You were mentioned',
        intro: `${actor} mentioned you in a comment on "${task.title}" in ${task.project.name}.`,
        quote, cta: 'Reply in Kahon', url,
      }),
    });
    sent += await send(admin, {
      // Keyed by task, so a burst of comments sends one email, not one per comment.
      kind: 'comment_added', refId: task.id, recipientIds: followers, actorId,
      build: (actor) => ({
        subject: `${actor} commented on "${task.title}"`,
        heading: 'New comment',
        intro: `${actor} commented on "${task.title}" in ${task.project.name}.`,
        quote, cta: 'Reply in Kahon', url,
      }),
    });
    return sent;
  },

  // { invitation_id }: email someone without an account who was invited to a project.
  async invited(admin: Admin, actorId: string, { invitation_id }: { invitation_id?: string }) {
    if (!invitation_id) return 0;
    const { data: invite } = await admin.from('invitations')
      .select('id, email, project_id, last_sent_at, project:projects(name)').eq('id', invitation_id).single();
    if (!invite) return 0;
    const { count } = await admin.from('project_members').select('user_id', { count: 'exact', head: true })
      .eq('project_id', invite.project_id).eq('user_id', actorId).eq('role', 'owner');
    if (!count) return 0;
    if (invite.last_sent_at && Date.now() - new Date(invite.last_sent_at).getTime() < INVITE_RESEND_MINUTES * 60_000) return 0;

    const { data: actor } = await admin.from('profiles').select('full_name, email').eq('id', actorId).single();
    const who = actor?.full_name || actor?.email || 'A teammate';
    const project = (Array.isArray(invite.project) ? invite.project[0] : invite.project)?.name ?? 'a project';
    await sendEmail(invite.email, {
      subject: `${who} invited you to ${project} on Kahon`,
      heading: `Join ${project} on Kahon`,
      intro: `${who} invited you to the ${project} project on Kahon, where your team plans and tracks its work. Create your account with this email address (${invite.email}) and you'll be added automatically.`,
      cta: 'Create your account',
      url: `${APP_URL}/?signup=${encodeURIComponent(invite.email)}`,
      footer: `You got this because ${who} invited ${invite.email}. If you don't want to join, ignore this email.`,
    });
    await admin.from('invitations').update({ last_sent_at: new Date().toISOString() }).eq('id', invite.id);
    return 1;
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
  const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();
  const { count } = await admin.from('email_log').select('id', { count: 'exact', head: true })
    .eq('kind', kind).eq('ref_id', refId).eq('recipient_id', person.id).gte('sent_at', since);
  if (count) return 0;

  await sendEmail(person.email, email);
  await admin.from('email_log').insert({ kind, ref_id: refId, recipient_id: person.id });
  return 1;
}

