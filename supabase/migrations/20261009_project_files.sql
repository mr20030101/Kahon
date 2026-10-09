-- Project reference files for Ask AI (2026-10-09). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.

-- Specs, briefs and other documents attached to a project rather than a task. Ask AI reads
-- their text for every task in the project. Files live in the private "attachments" bucket
-- at <project_id>/project/<file>. Only types Ask AI can read are allowed; keep in sync with
-- PROJECT_FILE_TYPES in src/components/ProjectFiles.jsx.
create table if not exists public.project_files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  path        text not null unique,
  name        text not null check (char_length(name) between 1 and 255),
  mime_type   text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/markdown', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )),
  size_bytes  integer not null check (size_bytes between 1 and 26214400),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_project_files_project on public.project_files (project_id, created_at);

alter table public.project_files enable row level security;

drop policy if exists "project files read" on public.project_files;
create policy "project files read" on public.project_files
  for select to authenticated using (public.is_member(project_id));

drop policy if exists "project files insert" on public.project_files;
create policy "project files insert" on public.project_files
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_owner(project_id)
    and path like project_id::text || '/project/%'
  );

drop policy if exists "project files delete" on public.project_files;
create policy "project files delete" on public.project_files
  for delete to authenticated using (public.is_owner(project_id));

-- Storage: editors keep managing task files, but the project/ folder is for project admins.
create or replace function public.path_is_project_file(p_name text)
returns boolean
language sql
immutable
as $$ select (storage.foldername(p_name))[2] = 'project' $$;

drop policy if exists "attachments objects insert" on storage.objects;
create policy "attachments objects insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and case
    when public.path_is_project_file(name) then public.is_owner(public.path_project(name))
    else public.can_edit(public.path_project(name)) end);

drop policy if exists "attachments objects update" on storage.objects;
create policy "attachments objects update" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and case
    when public.path_is_project_file(name) then public.is_owner(public.path_project(name))
    else public.can_edit(public.path_project(name)) end)
  with check (bucket_id = 'attachments' and case
    when public.path_is_project_file(name) then public.is_owner(public.path_project(name))
    else public.can_edit(public.path_project(name)) end);

drop policy if exists "attachments objects delete" on storage.objects;
create policy "attachments objects delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and case
    when public.path_is_project_file(name) then public.is_owner(public.path_project(name))
    else public.can_edit(public.path_project(name)) end);

-- Live updates for the file list in About this project.
alter table public.project_files replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.project_files; exception when duplicate_object then null; end;
end $$;
