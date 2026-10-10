// Daily due-date reminders. Called once a day by pg_cron (see the feature-pack migration)
// with a secret kept in Supabase Vault; anyone else gets a 401.
//
// For each person with open tasks due today, due tomorrow or overdue (as the main or an
// extra assignee): one digest email (if they have email notifications on) and an inbox
// notification per task. Running it twice in a day sends nothing new.

import { adminClient, json } from '../_shared/auth.ts';
import { APP_URL, sendEmail } from '../_shared/email.ts';

type Project = { name: string; workspace: { name: string } | { name: string }[] | null };
type Task = { id: string; title: string; due_date: string; project_id: string; assignee_id: string | null; project: Project | Project[] };

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v);
// "Loop · Website", so people in several workspaces can tell which company a task is for.
const projectName = (t: Task) => {
  const project = one(t.project);
  return [one(project?.workspace)?.name, project?.name].filter(Boolean).join(' · ');
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const admin = adminClient();

  const { data: ok } = await admin.rpc('check_reminder_secret', { p_secret: req.headers.get('x-reminder-secret') ?? '' });
  if (!ok) return json({ error: 'Unauthorized' }, 401);

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const { data: tasks, error } = await admin.from('tasks')
    .select('id, title, due_date, project_id, assignee_id, project:projects!inner(name, archived_at, workspace:workspaces(name))')
    .eq('completed', false).not('due_date', 'is', null).lte('due_date', tomorrow)
    .is('project.archived_at', null);
  if (error) {
    console.error(error);
    return json({ error: 'Could not load tasks' }, 500);
  }

  const ids = (tasks ?? []).map((t) => t.id);
  const { data: extras } = ids.length ? await admin.from('task_assignees').select('task_id, user_id').in('task_id', ids) : { data: [] };

  // person -> their due tasks
  const byPerson = new Map<string, Task[]>();
  const add = (userId: string | null, task: Task) => {
    if (!userId) return;
    const list = byPerson.get(userId) ?? [];
    if (!list.some((t) => t.id === task.id)) list.push(task);
    byPerson.set(userId, list);
  };
  for (const t of (tasks ?? []) as Task[]) {
    add(t.assignee_id, t);
    for (const e of extras ?? []) if (e.task_id === t.id) add(e.user_id, t);
  }

  const since = new Date(Date.now() - 20 * 3_600_000).toISOString();
  let emails = 0;
  let notes = 0;

  for (const [userId, list] of byPerson) {
    // Inbox notifications, once per task per day.
    const { data: recent } = await admin.from('notifications').select('task_id')
      .eq('user_id', userId).in('kind', ['due_soon', 'overdue']).gte('created_at', since);
    const already = new Set((recent ?? []).map((r) => r.task_id));
    const rows = list.filter((t) => !already.has(t.id)).map((t) => ({
      user_id: userId, kind: t.due_date < today ? 'overdue' : 'due_soon', project_id: t.project_id, task_id: t.id,
    }));
    if (rows.length) {
      await admin.from('notifications').insert(rows);
      notes += rows.length;
    }

    // One digest email a day.
    const { data: person } = await admin.from('profiles').select('email, full_name, email_notifications').eq('id', userId).single();
    if (!person?.email || person.email_notifications === false) continue;
    const { count } = await admin.from('email_log').select('id', { count: 'exact', head: true })
      .eq('kind', 'digest').eq('ref_id', userId).eq('recipient_id', userId).gte('sent_at', since);
    if (count) continue;

    const overdue = list.filter((t) => t.due_date < today);
    const dueToday = list.filter((t) => t.due_date === today);
    const dueTomorrow = list.filter((t) => t.due_date === tomorrow);
    const line = (t: Task) => `- ${t.title} (${projectName(t)})`;
    const sections = [
      overdue.length && `Overdue:\n${overdue.map(line).join('\n')}`,
      dueToday.length && `Due today:\n${dueToday.map(line).join('\n')}`,
      dueTomorrow.length && `Due tomorrow:\n${dueTomorrow.map(line).join('\n')}`,
    ].filter(Boolean).join('\n\n');
    const counts = [
      overdue.length && `${overdue.length} overdue`,
      dueToday.length && `${dueToday.length} due today`,
      dueTomorrow.length && `${dueTomorrow.length} due tomorrow`,
    ].filter(Boolean).join(', ');

    try {
      await sendEmail(person.email, {
        subject: `Kahon: ${counts}`,
        heading: `Hi ${person.full_name?.split(' ')[0] || 'there'}, here's what's due`,
        intro: `You have ${counts}.`,
        quote: sections,
        cta: 'Open My tasks',
        url: APP_URL || 'https://kahon.app',
      });
      await admin.from('email_log').insert({ kind: 'digest', ref_id: userId, recipient_id: userId });
      emails += 1;
    } catch (err) {
      console.error(err);
    }
  }

  return json({ people: byPerson.size, emails, notifications: notes });
});
