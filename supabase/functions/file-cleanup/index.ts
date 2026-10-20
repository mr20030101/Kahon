// Deletes the files of projects that have been Complete for 2 days, and the attachments of tasks
// that have been completed for 2 days, when a super admin has turned auto delete on
// (Super admin -> File cleanup). Called every hour by pg_cron (see the
// file-cleanup migration) with the secret kept in Supabase Vault; anyone else gets a 401.
//
// Only files go: task attachments and project reference files, from storage and their rows.
// Projects, tasks and comments stay. Each project and task is checked again right before its
// files are removed, so one reopened in the meantime keeps them.

import { adminClient, json } from '../_shared/auth.ts';

const BUCKET = 'attachments';
const CHUNK = 100; // storage.remove takes a list of paths; keep each request small

type Due = { project_id: string; project_name: string; workspace: string | null; files: number; bytes: number };
type DueTask = Due & { task_id: string; task_title: string };
type FileRow = { id: string; path: string; size_bytes: number; mime_type?: string };

// Images (not GIFs) have a thumbnail stored next to them; see thumbPathOf in src/lib/uploads.js.
const storedPaths = (f: FileRow) =>
  f.mime_type?.startsWith('image/') && f.mime_type !== 'image/gif'
    ? [f.path, f.path.replace(/\.[a-z0-9]+$/i, '') + '.thumb.webp']
    : [f.path];

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
        admin.from('task_attachments').select('id, path, size_bytes, mime_type').eq('project_id', p.project_id),
        admin.from('project_files').select('id, path, size_bytes').eq('project_id', p.project_id),
      ]);
      const all = [...(attachments ?? []), ...(projectFiles ?? [])] as FileRow[];
      if (!all.length) continue;

      if (!(await removeStored(admin, all, p.project_id))) continue;

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

  // Then single tasks, in projects the rule above didn't cover.
  const { data: dueTasks, error: taskError } = await admin.rpc('task_file_cleanup_due');
  if (taskError) {
    console.error(taskError);
    return json({ error: 'Could not load tasks' }, 500);
  }

  let tasks = 0;
  for (const t of (dueTasks ?? []) as DueTask[]) {
    try {
      // Asked again per task, so a task reopened since the list was made comes back empty.
      const { data: files } = await admin.rpc('task_file_cleanup_files')
        .eq('task_id', t.task_id).lte('delete_after', new Date().toISOString());
      const due = (files ?? []) as FileRow[];
      if (!due.length) continue;

      if (!(await removeStored(admin, due, t.task_id))) continue;
      await admin.from('task_attachments').delete().in('id', due.map((f) => f.id));

      await admin.from('file_cleanup_log').insert({
        project_id: t.project_id,
        project_name: t.project_name,
        task_id: t.task_id,
        task_title: t.task_title,
        workspace: t.workspace,
        files: due.length,
        bytes: due.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0),
      });
      tasks += 1;
      deleted += due.length;
    } catch (e) {
      console.error(`file-cleanup: task ${t.task_id}`, e);
    }
  }

  return json({ projects, tasks, files: deleted });
});

// Storage first: a row without its file is harmless, a file without its row is never cleaned up.
async function removeStored(admin: ReturnType<typeof adminClient>, files: FileRow[], owner: string) {
  const paths = files.flatMap(storedPaths);
  for (let i = 0; i < paths.length; i += CHUNK) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + CHUNK));
    if (error) {
      console.error(`file-cleanup: storage remove failed for ${owner}`, error.message);
      return false;
    }
  }
  return true;
}
