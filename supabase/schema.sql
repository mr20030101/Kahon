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

-- Per-person opt-out for notification emails (Settings → Notifications)
alter table public.profiles add column if not exists email_notifications boolean not null default true;

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
    (array['#2E6F73','#B4532A','#5B4BB7','#2F7D32','#C2185B','#1565C0',
           '#8D6E00','#6D4C41','#00838F','#7B1FA2','#D84315','#455A64'])[1 + floor(random() * 12)::int]
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

-- Completing a task completes its subtasks. Reopening the parent leaves them as they are.
create or replace function public.complete_subtasks()
returns trigger
language plpgsql
as $$
begin
  update public.tasks set completed = true
  where parent_id = new.id and not completed;
  return null;
end;
$$;

drop trigger if exists tasks_complete_subtasks on public.tasks;
create trigger tasks_complete_subtasks
  after update of completed on public.tasks
  for each row
  when (new.completed and not old.completed)
  execute function public.complete_subtasks();

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
-- RPC: an owner makes a member an owner, or an owner a member.
-- A project always keeps at least one owner.
-- ------------------------------------------------------------
create or replace function public.set_member_role(p_project uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  if not public.is_owner(p_project) then
    raise exception 'Only a project owner can change roles';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'Role must be owner or member';
  end if;

  -- Serialize role changes per project so two owners can't demote each other at once.
  perform 1 from public.projects where id = p_project for update;

  select role into v_current from public.project_members
  where project_id = p_project and user_id = p_user;
  if v_current is null then
    raise exception 'That person is not a member of this project';
  end if;
  if v_current = p_role then
    return;
  end if;

  if v_current = 'owner' and (
    select count(*) from public.project_members where project_id = p_project and role = 'owner'
  ) <= 1 then
    raise exception 'A project needs at least one owner. Make someone else an owner first.';
  end if;

  update public.project_members set role = p_role
  where project_id = p_project and user_id = p_user;
end;
$$;

grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

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
-- Email notifications: what the notify Edge Function has sent, so repeat events
-- within a few minutes don't send repeat emails. Service role only: RLS on, no policies.
-- ------------------------------------------------------------
create table if not exists public.email_log (
  id            bigint generated always as identity primary key,
  kind          text not null,
  ref_id        uuid not null,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  sent_at       timestamptz not null default now()
);

create index if not exists idx_email_log_lookup on public.email_log (kind, ref_id, recipient_id, sent_at desc);

alter table public.email_log enable row level security;

-- ------------------------------------------------------------
-- Ask AI: one row per request, for the per-person daily limit and token spend.
-- Service role only (the ask-ai Edge Function): RLS on, no policies.
-- ------------------------------------------------------------
create table if not exists public.ai_requests (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  task_id        uuid references public.tasks (id) on delete set null,
  kind           text not null,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ai_requests_user on public.ai_requests (user_id, created_at desc);

alter table public.ai_requests enable row level security;

-- ------------------------------------------------------------
-- Profile fields
-- ------------------------------------------------------------
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists job_title   text;
alter table public.profiles add column if not exists department  text;
alter table public.profiles add column if not exists bio         text;
alter table public.profiles add column if not exists location    text;
alter table public.profiles add column if not exists timezone    text;

alter table public.profiles drop constraint if exists profiles_details_check;
alter table public.profiles add constraint profiles_details_check check (
  char_length(coalesce(full_name, '')) <= 120
  and char_length(coalesce(job_title, '')) <= 100
  and char_length(coalesce(department, '')) <= 100
  and char_length(coalesce(bio, '')) <= 1000
  and char_length(coalesce(location, '')) <= 100
  and char_length(coalesce(timezone, '')) <= 64
  and color ~ '^#[0-9A-Fa-f]{6}$'
  -- Avatars live in the avatars bucket under the owner's own folder.
  and (avatar_path is null or avatar_path like id::text || '/%')
);

-- People may edit these columns of their own profile, and nothing else. In particular not
-- email: add_member_by_email finds people by it, so a changeable email would let someone
-- take a teammate's place when an owner adds them.
revoke update on public.profiles from authenticated;
grant update (full_name, color, avatar_path, job_title, department, bio, location, timezone, email_notifications)
  on public.profiles to authenticated;

-- ------------------------------------------------------------
-- Avatars: public bucket (avatars are shown to teammates and in emails), one folder per
-- person, and only you can write to your folder.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading your own folder is needed to replace or remove a photo; everyone else sees
-- avatars through the bucket's public URLs.
drop policy if exists "avatars read own" on storage.objects;
create policy "avatars read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- Project details
-- ------------------------------------------------------------
alter table public.projects add column if not exists description text not null default '';
alter table public.projects add column if not exists status      text not null default 'on_track';
alter table public.projects add column if not exists start_date  date;
alter table public.projects add column if not exists due_date    date;
alter table public.projects add column if not exists links       jsonb not null default '[]'::jsonb;

alter table public.projects drop constraint if exists projects_details_check;
alter table public.projects add constraint projects_details_check check (
  char_length(description) <= 5000
  and status in ('on_track', 'at_risk', 'off_track', 'on_hold', 'complete')
  and (start_date is null or due_date is null or due_date >= start_date)
  and jsonb_typeof(links) = 'array'
  and jsonb_array_length(links) <= 20
  -- Each link is {label, url} with a web URL, so nothing like javascript: can be stored.
  and not jsonb_path_exists(links, '$[*] ? (!(@.url like_regex "^https?://"))')
);

-- ------------------------------------------------------------
-- Two-factor authentication: once someone has a verified authenticator, their session must
-- have passed it (aal2) before any project data is readable or writable. Every project
-- policy goes through these three helpers, so this one check covers them all.
-- ------------------------------------------------------------
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

create or replace function public.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
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
  select public.mfa_ok() and exists (
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
  select public.mfa_ok() and exists (
    select 1
    from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ------------------------------------------------------------
-- Keep profiles.email in step with the sign-in email once a change is confirmed.
-- ------------------------------------------------------------
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();

-- ------------------------------------------------------------
-- RPC: leave every project. Refuses (and changes nothing) while you're the only owner of a
-- project, since that would leave it with no one able to manage it.
-- ------------------------------------------------------------
create or replace function public.leave_all_projects()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocked text;
  v_left integer;
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'Sign in to leave projects';
  end if;

  select string_agg(p.name, ', ' order by p.name) into v_blocked
  from public.project_members m
  join public.projects p on p.id = m.project_id
  where m.user_id = auth.uid() and m.role = 'owner'
    and not exists (
      select 1 from public.project_members o
      where o.project_id = m.project_id and o.role = 'owner' and o.user_id <> auth.uid()
    );
  if v_blocked is not null then
    raise exception 'You are the only owner of: %. Make someone else an owner or delete those projects first.', v_blocked;
  end if;

  delete from public.project_members where user_id = auth.uid();
  get diagnostics v_left = row_count;
  return v_left;
end;
$$;

grant execute on function public.leave_all_projects() to authenticated;

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
