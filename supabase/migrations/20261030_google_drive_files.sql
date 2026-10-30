-- Attachments and project files in Google Drive (2026-10-30). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.
--
-- New uploads go to a Google Drive folder through the Vercel Function in api/files.js (see
-- src/lib/driveFiles.js) instead of the "attachments" bucket. Files uploaded before this stay in
-- the bucket and keep working: a row with a drive_file_id is in Drive, one without is in storage.
-- path keeps its <project>/<task>/<name>.<ext> shape either way, so the insert policies and
-- move_task() are unchanged.

alter table public.task_attachments add column if not exists drive_file_id text unique;
alter table public.task_attachments add column if not exists drive_thumb_id text unique;
alter table public.project_files add column if not exists drive_file_id text unique;

-- ------------------------------------------------------------
-- Uploads the function has started, written only with the service role. A row may name a Drive
-- file only if it's one of the inserting user's own verified uploads, for the same project (and
-- task), type and size, so nobody can point a row at a file from a project they can't see.
-- ------------------------------------------------------------
create table if not exists public.drive_uploads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  task_id       uuid references public.tasks (id) on delete cascade,
  kind          text not null check (kind in ('file', 'thumb')),
  mime_type     text not null,
  size_bytes    integer not null,
  drive_file_id text unique,
  created_at    timestamptz not null default now(),
  verified_at   timestamptz,
  claimed_at    timestamptz
);

create index if not exists idx_drive_uploads_user on public.drive_uploads (user_id, created_at);

alter table public.drive_uploads enable row level security;
-- No policies: only the service role reads or writes it.

create or replace function public.claim_drive_upload(
  p_file text, p_kind text, p_project uuid, p_task uuid, p_mime text, p_size integer
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.drive_uploads set claimed_at = now()
    where drive_file_id = p_file and kind = p_kind and user_id = auth.uid()
      and project_id = p_project and task_id is not distinct from p_task
      and mime_type = p_mime and (p_size is null or size_bytes = p_size)
      and verified_at is not null and claimed_at is null
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_drive_upload(text, text, uuid, uuid, text, integer) from public, anon, authenticated;

create or replace function public.check_drive_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Through jsonb: project_files has neither column, and new.<missing column> is an error.
  v_task uuid := (to_jsonb(new) ->> 'task_id')::uuid;
  v_thumb text := to_jsonb(new) ->> 'drive_thumb_id';
begin
  if new.drive_file_id is null then
    if v_thumb is not null then raise exception 'A thumbnail needs its file'; end if;
    return new;
  end if;
  if not public.claim_drive_upload(new.drive_file_id, 'file', new.project_id, v_task, new.mime_type, new.size_bytes) then
    raise exception 'Not an upload of yours';
  end if;
  if v_thumb is not null
     and not public.claim_drive_upload(v_thumb, 'thumb', new.project_id, v_task, 'image/webp', null)
     and not public.claim_drive_upload(v_thumb, 'thumb', new.project_id, v_task, 'image/jpeg', null) then
    raise exception 'Not an upload of yours';
  end if;
  return new;
end;
$$;

drop trigger if exists check_drive_ids on public.task_attachments;
create trigger check_drive_ids before insert on public.task_attachments
  for each row execute function public.check_drive_ids();
drop trigger if exists check_drive_ids on public.project_files;
create trigger check_drive_ids before insert on public.project_files
  for each row execute function public.check_drive_ids();

-- Neither table has an update policy, but keep the Drive ids fixed even for security definer code.
create or replace function public.keep_drive_ids()
returns trigger
language plpgsql
as $$
begin
  if new.drive_file_id is distinct from old.drive_file_id
     or to_jsonb(new) ->> 'drive_thumb_id' is distinct from to_jsonb(old) ->> 'drive_thumb_id' then
    raise exception 'Drive ids can''t change';
  end if;
  return new;
end;
$$;

drop trigger if exists keep_drive_ids on public.task_attachments;
create trigger keep_drive_ids before update on public.task_attachments
  for each row execute function public.keep_drive_ids();
drop trigger if exists keep_drive_ids on public.project_files;
create trigger keep_drive_ids before update on public.project_files
  for each row execute function public.keep_drive_ids();

-- ------------------------------------------------------------
-- Drive files whose row is gone, however it went (removed, its task or project deleted, the
-- account deleted, auto delete). api/files.js deletes them from Drive: right after someone
-- removes a file, and once a day from the Vercel cron job.
-- ------------------------------------------------------------
create table if not exists public.drive_trash (
  drive_file_id text primary key,
  created_at    timestamptz not null default now()
);

alter table public.drive_trash enable row level security;
-- No policies: only the service role reads or writes it.

create or replace function public.trash_drive_files()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.drive_trash (drive_file_id)
  select id from unnest(array[old.drive_file_id, to_jsonb(old) ->> 'drive_thumb_id']) as id
  where id is not null
  on conflict do nothing;
  return old;
end;
$$;

drop trigger if exists trash_drive_files on public.task_attachments;
create trigger trash_drive_files after delete on public.task_attachments
  for each row when (old.drive_file_id is not null) execute function public.trash_drive_files();
drop trigger if exists trash_drive_files on public.project_files;
create trigger trash_drive_files after delete on public.project_files
  for each row when (old.drive_file_id is not null) execute function public.trash_drive_files();
