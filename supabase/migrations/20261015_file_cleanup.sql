-- Auto delete files from completed projects (2026-10-15). Run once in Supabase -> SQL Editor,
-- after 20261010_admin_tools.sql. supabase/schema.sql includes the same changes for fresh installs.
-- Then deploy the function: npx supabase functions deploy file-cleanup --no-verify-jwt
--
-- When a super admin turns it on, task attachments and project reference files are deleted
-- from projects whose status has been Complete for 2 days. It starts off. Reopening a project
-- before then keeps its files. Projects, tasks and comments are never deleted, only files.

-- ------------------------------------------------------------
-- When a project was marked Complete. Set by the trigger only (it isn't in the column grants),
-- so nobody can backdate it to have files deleted early.
-- ------------------------------------------------------------
alter table public.projects add column if not exists completed_at timestamptz;

create or replace function public.set_project_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'complete' then
    new.completed_at := case
      when tg_op = 'UPDATE' and old.status = 'complete' then old.completed_at
      else now() end;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_completed_at on public.projects;
create trigger projects_completed_at
  before insert or update on public.projects
  for each row execute function public.set_project_completed_at();

-- Projects already complete count from now, so turning this on never deletes files the day
-- it's installed.
update public.projects set completed_at = now() where status = 'complete' and completed_at is null;

create index if not exists idx_projects_completed_at on public.projects (completed_at) where completed_at is not null;

-- ------------------------------------------------------------
-- Kahon-wide settings: one row. RLS on with no policies, so the API can't touch it; read and
-- changed only through the functions below.
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  id                    boolean primary key default true check (id),
  auto_delete_files     boolean not null default false,
  auto_delete_after     interval not null default interval '2 days',
  updated_by            uuid references public.profiles (id) on delete set null,
  updated_at            timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- What each cleanup run deleted, for the File cleanup page. RLS on with no policies.
create table if not exists public.file_cleanup_log (
  id            bigint generated always as identity primary key,
  project_id    uuid references public.projects (id) on delete set null,
  project_name  text not null,
  workspace     text,
  files         integer not null,
  bytes         bigint not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_file_cleanup_log_created on public.file_cleanup_log (created_at desc);

alter table public.file_cleanup_log enable row level security;

-- Super admin actions now include turning auto delete on and off.
alter table public.admin_audit drop constraint if exists admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('resend_confirmation', 'auto_delete_files_on', 'auto_delete_files_off'));

-- ------------------------------------------------------------
-- Whether auto delete is on, so a project can say when its files go. Any signed-in person;
-- it's one Kahon-wide yes/no.
-- ------------------------------------------------------------
create or replace function public.file_cleanup_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select auto_delete_files from public.app_settings where id), false) $$;

revoke execute on function public.file_cleanup_enabled() from public, anon;
grant execute on function public.file_cleanup_enabled() to authenticated, service_role;

-- Projects whose files are due: Complete for at least the waiting period, with files left.
-- Used by the file-cleanup function (service role) and the admin page.
create or replace function public.file_cleanup_due()
returns table (project_id uuid, project_name text, workspace text, completed_at timestamptz, files bigint, bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, w.name, p.completed_at, f.files, f.bytes
  from public.projects p
  left join public.workspaces w on w.id = p.workspace_id
  cross join lateral (
    select count(*) as files, coalesce(sum(x.size_bytes), 0)::bigint as bytes from (
      select a.size_bytes from public.task_attachments a where a.project_id = p.id
      union all
      select pf.size_bytes from public.project_files pf where pf.project_id = p.id
    ) x
  ) f
  where p.status = 'complete'
    and p.completed_at <= now() - (select auto_delete_after from public.app_settings where id)
    and f.files > 0
  order by p.completed_at;
$$;

revoke execute on function public.file_cleanup_due() from public, anon, authenticated;
grant execute on function public.file_cleanup_due() to service_role;

-- ------------------------------------------------------------
-- File cleanup page: the switch, what's due now, what's coming up and what was deleted.
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
    'log', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select l.project_name, l.workspace, l.files, l.bytes, l.created_at
        from public.file_cleanup_log l order by l.created_at desc limit 50
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_file_cleanup() from public, anon;
grant execute on function public.admin_file_cleanup() to authenticated;

-- Turns auto delete on or off, recorded in admin_audit.
create or replace function public.admin_set_auto_delete_files(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can change file cleanup';
  end if;
  if p_on is null then
    raise exception 'Choose on or off';
  end if;
  update public.app_settings
  set auto_delete_files = p_on, updated_by = auth.uid(), updated_at = now()
  where id;
  insert into public.admin_audit (actor_id, action)
  values (auth.uid(), case when p_on then 'auto_delete_files_on' else 'auto_delete_files_off' end);
end;
$$;

revoke execute on function public.admin_set_auto_delete_files(boolean) from public, anon;
grant execute on function public.admin_set_auto_delete_files(boolean) to authenticated;

-- ------------------------------------------------------------
-- Every hour, while auto delete is on, call the file-cleanup Edge Function. It checks the
-- same Vault secret as the reminders job. Points at this project's URL; change it for another.
-- ------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'kahon-file-cleanup';
select cron.schedule(
  'kahon-file-cleanup',
  '15 * * * *',
  $job$
    select net.http_post(
      url := 'https://wvqgkelahpfhibbjvfey.supabase.co/functions/v1/file-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kahon_reminder_secret')
      ),
      body := '{}'::jsonb
    )
    where (select auto_delete_files from public.app_settings where id);
  $job$
);
