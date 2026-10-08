-- ============================================================
-- Kahon database schema
-- Run this whole file once in Supabase → SQL Editor → New query.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Profiles (one per auth user, created automatically on sign-up)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text unique,
  full_name   text,
  color       text not null default '#2E6F73',
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, color)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    (array['#2E6F73','#B4532A','#5B4BB7','#2F7D32','#C2185B','#1565C0','#8D6E00'])[1 + floor(random() * 7)::int]
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Projects, members, sections, tasks, comments
-- ------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  color       text not null default '#2E6F73',
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  added_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  section_id    uuid references public.sections (id) on delete cascade,
  parent_id     uuid references public.tasks (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 500),
  description   text not null default '',
  assignee_id   uuid references public.profiles (id) on delete set null,
  due_date      date,
  priority      text check (priority in ('low', 'medium', 'high')),
  completed     boolean not null default false,
  completed_at  timestamptz,
  position      double precision not null default 0,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);

create index if not exists idx_members_user      on public.project_members (user_id);
create index if not exists idx_sections_project  on public.sections (project_id);
create index if not exists idx_tasks_project     on public.tasks (project_id);
create index if not exists idx_tasks_section     on public.tasks (section_id);
create index if not exists idx_tasks_parent      on public.tasks (parent_id);
create index if not exists idx_tasks_assignee    on public.tasks (assignee_id);
create index if not exists idx_comments_task     on public.comments (task_id);

-- Keep updated_at and completed_at in sync
create or replace function public.touch_task()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.completed and (tg_op = 'INSERT' or not old.completed) then
    new.completed_at := now();
  elsif not new.completed then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch
  before insert or update on public.tasks
  for each row execute function public.touch_task();

-- ------------------------------------------------------------
-- Membership helpers (security definer avoids RLS recursion)
-- ------------------------------------------------------------
create or replace function public.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.shares_project_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.sections        enable row level security;
alter table public.tasks           enable row level security;
alter table public.comments        enable row level security;

-- Profiles: see yourself and people you share a project with
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_project_with(id));

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Projects
drop policy if exists "projects read" on public.projects;
create policy "projects read" on public.projects
  for select to authenticated using (public.is_member(id));

drop policy if exists "projects update" on public.projects;
create policy "projects update" on public.projects
  for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

drop policy if exists "projects delete" on public.projects;
create policy "projects delete" on public.projects
  for delete to authenticated using (public.is_owner(id));
-- Projects are created through create_project() below.

-- Members (added through add_member_by_email() below)
drop policy if exists "members read" on public.project_members;
create policy "members read" on public.project_members
  for select to authenticated using (public.is_member(project_id));

drop policy if exists "members remove" on public.project_members;
create policy "members remove" on public.project_members
  for delete to authenticated
  using (role <> 'owner' and (public.is_owner(project_id) or user_id = auth.uid()));

-- Sections
drop policy if exists "sections all" on public.sections;
create policy "sections all" on public.sections
  for all to authenticated
  using (public.is_member(project_id)) with check (public.is_member(project_id));

-- Tasks
drop policy if exists "tasks all" on public.tasks;
create policy "tasks all" on public.tasks
  for all to authenticated
  using (public.is_member(project_id)) with check (public.is_member(project_id));

-- Comments
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments
  for select to authenticated
  using (public.is_member((select t.project_id from public.tasks t where t.id = task_id)));

drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_member((select t.project_id from public.tasks t where t.id = task_id))
  );

drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments
  for delete to authenticated using (author_id = auth.uid());

-- ------------------------------------------------------------
-- RPC: create a project with you as owner and three starter sections
-- ------------------------------------------------------------
create or replace function public.create_project(p_name text, p_color text default '#2E6F73')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create a project';
  end if;

  insert into public.projects (name, color, owner_id)
  values (trim(p_name), coalesce(p_color, '#2E6F73'), auth.uid())
  returning id into v_id;

  insert into public.project_members (project_id, user_id, role)
  values (v_id, auth.uid(), 'owner');

  insert into public.sections (project_id, name, position) values
    (v_id, 'To do', 1000),
    (v_id, 'In progress', 2000),
    (v_id, 'Done', 3000);

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- RPC: project owner adds a teammate who already has a Kahon account
-- ------------------------------------------------------------
create or replace function public.add_member_by_email(p_project uuid, p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_owner(p_project) then
    raise exception 'Only the project owner can add members';
  end if;

  select * into v_profile from public.profiles where email = lower(trim(p_email));
  if v_profile.id is null then
    raise exception 'No Kahon account uses that email. Ask them to sign up first.';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project, v_profile.id, 'member')
  on conflict do nothing;

  return json_build_object('id', v_profile.id, 'full_name', v_profile.full_name, 'email', v_profile.email, 'color', v_profile.color);
end;
$$;

grant execute on function public.create_project(text, text) to authenticated;
grant execute on function public.add_member_by_email(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- File attachments on tasks (images, PDFs, docs, sheets, slides)
-- Files live in the private "attachments" bucket at <project_id>/<task_id>/<file>.
-- ------------------------------------------------------------
create table if not exists public.task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  path        text not null unique,
  name        text not null check (char_length(name) between 1 and 255),
  mime_type   text not null,
  size_bytes  integer not null,
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_attachments_task on public.task_attachments (task_id);

-- Images, PDFs, docs, sheets and slides up to 25 MB. Keep in sync with FILE_TYPES
-- in src/components/Attachments.jsx and the bucket below.
alter table public.task_attachments drop constraint if exists task_attachments_mime_type_check;
alter table public.task_attachments add constraint task_attachments_mime_type_check check (mime_type in (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/rtf', 'text/plain', 'text/markdown',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'
  ));
alter table public.task_attachments drop constraint if exists task_attachments_size_bytes_check;
alter table public.task_attachments add constraint task_attachments_size_bytes_check check (size_bytes between 1 and 26214400);

alter table public.task_attachments enable row level security;

drop policy if exists "attachments read" on public.task_attachments;
create policy "attachments read" on public.task_attachments
  for select to authenticated using (public.is_member(project_id));

drop policy if exists "attachments insert" on public.task_attachments;
create policy "attachments insert" on public.task_attachments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_member(project_id)
    and project_id = (select t.project_id from public.tasks t where t.id = task_id)
    and path like project_id::text || '/' || task_id::text || '/%'
  );

drop policy if exists "attachments delete" on public.task_attachments;
create policy "attachments delete" on public.task_attachments
  for delete to authenticated
  using (created_by = auth.uid() or public.is_owner(project_id));

-- Project id from an object path, or null when the first folder isn't a uuid
create or replace function public.path_project(p_name text)
returns uuid
language plpgsql
stable
as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400, array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/rtf', 'text/plain', 'text/markdown',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'
  ])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments objects read" on storage.objects;
create policy "attachments objects read" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(public.path_project(name)));

drop policy if exists "attachments objects insert" on storage.objects;
create policy "attachments objects insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_member(public.path_project(name)));

-- Any member may delete files: members can already delete any task (and with it the
-- attachment rows), and the client clears the files when a task, section or project goes.
drop policy if exists "attachments objects delete" on storage.objects;
create policy "attachments objects delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.is_member(public.path_project(name)));

-- ------------------------------------------------------------
-- Realtime: live updates for boards, comments and membership
-- ------------------------------------------------------------
alter table public.tasks           replica identity full;
alter table public.sections        replica identity full;
alter table public.comments        replica identity full;
alter table public.project_members replica identity full;
alter table public.task_attachments replica identity full;

do $$
begin
  begin alter publication supabase_realtime add table public.tasks;           exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.sections;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.comments;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.project_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.projects;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_attachments; exception when duplicate_object then null; end;
end $$;
