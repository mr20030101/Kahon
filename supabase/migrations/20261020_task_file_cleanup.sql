-- Auto delete files from completed tasks (2026-10-20). Run once in Supabase -> SQL Editor,
-- after 20261015_file_cleanup.sql. supabase/schema.sql includes the same changes for fresh installs.
-- Then redeploy the function: npx supabase functions deploy file-cleanup --no-verify-jwt
--
-- With auto delete on, a task's attachments are also deleted once the task (or subtask) has
-- been completed for 2 days, on top of the project rule. A file added after the task was
-- completed gets its own 2 days. Reopening the task before then keeps its files. Tasks that
-- were already complete count from when this is installed.

-- ------------------------------------------------------------
-- completed_at is set only by the trigger. It used to keep whatever the client sent while a
-- task stayed complete, so an editor could backdate it and have files deleted early.
-- ------------------------------------------------------------
create or replace function public.touch_task()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if not new.completed then
    new.completed_at := null;
  elsif tg_op = 'INSERT' or not old.completed then
    new.completed_at := now();
  else
    new.completed_at := coalesce(old.completed_at, now());
  end if;
  return new;
end;
$$;

-- Tasks completed before this count from here, so installing it never deletes files at once.
alter table public.app_settings add column if not exists task_files_since timestamptz not null default now();

create index if not exists idx_tasks_completed_at on public.tasks (completed_at) where completed;

-- The log records the task when a run deleted one task's files rather than a whole project's.
alter table public.file_cleanup_log add column if not exists task_id uuid references public.tasks (id) on delete set null;
alter table public.file_cleanup_log add column if not exists task_title text;

-- ------------------------------------------------------------
-- When each attachment of a completed task may go: the waiting period after the latest of the
-- task's completion, the file's upload and task_files_since. Tasks in a project that's due
-- under the project rule are left to that rule.
-- ------------------------------------------------------------
create or replace function public.task_file_cleanup_files()
returns table (
  id uuid, task_id uuid, path text, mime_type text, size_bytes integer, delete_after timestamptz,
  task_title text, task_completed_at timestamptz, project_id uuid, project_name text, workspace text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, t.id, a.path, a.mime_type, a.size_bytes,
         greatest(t.completed_at, a.created_at, s.task_files_since) + s.auto_delete_after,
         t.title, t.completed_at, p.id, p.name, w.name
  from public.task_attachments a
  join public.tasks t on t.id = a.task_id
  join public.projects p on p.id = t.project_id
  left join public.workspaces w on w.id = p.workspace_id
  cross join public.app_settings s
  where s.id
    and t.completed
    and t.completed_at is not null
    and not (p.status = 'complete' and p.completed_at <= now() - s.auto_delete_after);
$$;

revoke execute on function public.task_file_cleanup_files() from public, anon, authenticated;
grant execute on function public.task_file_cleanup_files() to service_role;

-- Tasks with files due now, one row each. Used by the file-cleanup function (service role).
create or replace function public.task_file_cleanup_due()
returns table (task_id uuid, task_title text, project_id uuid, project_name text, workspace text,
               completed_at timestamptz, files bigint, bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select f.task_id, f.task_title, f.project_id, f.project_name, f.workspace, f.task_completed_at,
         count(*), coalesce(sum(f.size_bytes), 0)::bigint
  from public.task_file_cleanup_files() f
  where f.delete_after <= now()
  group by f.task_id, f.task_title, f.project_id, f.project_name, f.workspace, f.task_completed_at
  order by f.task_completed_at;
$$;

revoke execute on function public.task_file_cleanup_due() from public, anon, authenticated;
grant execute on function public.task_file_cleanup_due() to service_role;

-- ------------------------------------------------------------
-- File cleanup page: adds tasks due now, tasks coming up, and the task in the log.
-- ------------------------------------------------------------
create or replace function public.admin_file_cleanup()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.app_settings;
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view file cleanup';
  end if;
  select * into v_settings from public.app_settings where id;
  return json_build_object(
    'enabled', v_settings.auto_delete_files,
    'after_days', extract(day from v_settings.auto_delete_after)::int,
    'updated_at', v_settings.updated_at,
    'updated_by', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = v_settings.updated_by),
    'due', coalesce((select json_agg(d) from public.file_cleanup_due() d), '[]'),
    'upcoming', coalesce((
      select json_agg(x order by x.delete_after) from (
        select p.id as project_id, p.name as project_name, w.name as workspace, p.completed_at,
               p.completed_at + v_settings.auto_delete_after as delete_after, f.files, f.bytes
        from public.projects p
        left join public.workspaces w on w.id = p.workspace_id
        cross join lateral (
          select count(*) as files, coalesce(sum(x.size_bytes), 0)::bigint as bytes from (
            select a.size_bytes from public.task_attachments a where a.project_id = p.id
            union all
            select pf.size_bytes from public.project_files pf where pf.project_id = p.id
          ) x
        ) f
        where p.status = 'complete' and p.completed_at > now() - v_settings.auto_delete_after and f.files > 0
      ) x), '[]'),
    'due_tasks', coalesce((
      select json_agg(x order by x.completed_at) from (
        select f.task_id, f.task_title, f.project_name, f.workspace, f.task_completed_at as completed_at,
               count(*) as files, coalesce(sum(f.size_bytes), 0)::bigint as bytes
        from public.task_file_cleanup_files() f
        where f.delete_after <= now()
        group by f.task_id, f.task_title, f.project_name, f.workspace, f.task_completed_at
      ) x), '[]'),
    'upcoming_tasks', coalesce((
      select json_agg(x order by x.delete_after) from (
        select f.task_id, f.task_title, f.project_name, f.workspace, f.task_completed_at as completed_at,
               min(f.delete_after) as delete_after, count(*) as files, coalesce(sum(f.size_bytes), 0)::bigint as bytes
        from public.task_file_cleanup_files() f
        where f.delete_after > now()
        group by f.task_id, f.task_title, f.project_name, f.workspace, f.task_completed_at
      ) x), '[]'),
    'log', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select l.project_name, l.task_title, l.workspace, l.files, l.bytes, l.created_at
        from public.file_cleanup_log l order by l.created_at desc limit 50
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_file_cleanup() from public, anon;
grant execute on function public.admin_file_cleanup() to authenticated;
