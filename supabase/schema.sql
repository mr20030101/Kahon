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

-- ============================================================
-- Feature pack: invitations, comment editing, labels, extra assignees, repeating tasks,
-- notifications and mentions, activity, archiving, moving/duplicating, reminders, error log.
-- Later definitions here (add_member_by_email, handle_new_user) replace the earlier ones.
-- The reminders cron job below points at this project's URL; change it for another project.
-- ============================================================
-- Invitations: owners can invite people who don't have an account yet. When that email
-- signs up, they join the project automatically.
-- ============================================================
create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  email        text not null check (email = lower(email) and char_length(email) between 3 and 320),
  invited_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  unique (project_id, email)
);

alter table public.invitations enable row level security;

drop policy if exists "invitations read" on public.invitations;
create policy "invitations read" on public.invitations
  for select to authenticated using (public.is_member(project_id));

drop policy if exists "invitations cancel" on public.invitations;
create policy "invitations cancel" on public.invitations
  for delete to authenticated using (public.is_owner(project_id));

-- add_member_by_email now invites unknown emails instead of failing.
-- Returns {status: 'added' | 'invited', ...}.
create or replace function public.add_member_by_email(p_project uuid, p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_profile public.profiles;
  v_invite public.invitations;
begin
  if not public.is_owner(p_project) then
    raise exception 'Only a project owner can add members';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select * into v_profile from public.profiles where email = v_email;
  if v_profile.id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (p_project, v_profile.id, 'member')
    on conflict do nothing;
    return json_build_object('status', 'added', 'id', v_profile.id, 'full_name', v_profile.full_name,
      'email', v_profile.email, 'color', v_profile.color);
  end if;

  insert into public.invitations (project_id, email, invited_by)
  values (p_project, v_email, auth.uid())
  on conflict (project_id, email) do update set invited_by = excluded.invited_by
  returning * into v_invite;
  return json_build_object('status', 'invited', 'invitation_id', v_invite.id, 'email', v_email);
end;
$$;

-- New accounts: create the profile, then accept any invitations for that email.
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

  insert into public.project_members (project_id, user_id, role)
  select i.project_id, new.id, 'member' from public.invitations i where i.email = lower(new.email)
  on conflict do nothing;
  delete from public.invitations where email = lower(new.email);
  return new;
end;
$$;

-- ============================================================
-- Comments: authors can edit their own (only the text).
-- ============================================================
alter table public.comments add column if not exists edited_at timestamptz;

drop policy if exists "comments update own" on public.comments;
create policy "comments update own" on public.comments
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

revoke update on public.comments from authenticated;
grant update (body, edited_at) on public.comments to authenticated;

-- ============================================================
-- Labels (per project) and extra assignees
-- ============================================================
create table if not exists public.project_labels (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  color       text not null default '#5B4BB7' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create table if not exists public.task_labels (
  task_id   uuid not null references public.tasks (id) on delete cascade,
  label_id  uuid not null references public.project_labels (id) on delete cascade,
  primary key (task_id, label_id)
);

-- People assigned alongside tasks.assignee_id (the main assignee).
create table if not exists public.task_assignees (
  task_id   uuid not null references public.tasks (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists idx_task_labels_label on public.task_labels (label_id);
create index if not exists idx_task_assignees_user on public.task_assignees (user_id);

alter table public.project_labels enable row level security;
alter table public.task_labels enable row level security;
alter table public.task_assignees enable row level security;

create or replace function public.task_project(p_task uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id from public.tasks where id = p_task;
$$;

drop policy if exists "labels all" on public.project_labels;
create policy "labels all" on public.project_labels
  for all to authenticated
  using (public.is_member(project_id)) with check (public.is_member(project_id));

drop policy if exists "task labels all" on public.task_labels;
create policy "task labels all" on public.task_labels
  for all to authenticated
  using (public.is_member(public.task_project(task_id)))
  with check (
    public.is_member(public.task_project(task_id))
    and public.task_project(task_id) = (select l.project_id from public.project_labels l where l.id = label_id)
  );

drop policy if exists "task assignees all" on public.task_assignees;
create policy "task assignees all" on public.task_assignees
  for all to authenticated
  using (public.is_member(public.task_project(task_id)))
  with check (
    public.is_member(public.task_project(task_id))
    and exists (select 1 from public.project_members m where m.project_id = public.task_project(task_id) and m.user_id = task_assignees.user_id)
  );

-- ============================================================
-- Repeating tasks: completing one creates the next, with the due date moved on.
-- ============================================================
alter table public.tasks add column if not exists recurrence text;
alter table public.tasks drop constraint if exists tasks_recurrence_check;
alter table public.tasks add constraint tasks_recurrence_check
  check (recurrence is null or recurrence in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly'));

create or replace function public.next_due(p_from date, p_rule text)
returns date
language plpgsql
immutable
as $$
declare
  v date := p_from;
begin
  case p_rule
    when 'daily' then return p_from + 1;
    when 'weekly' then return p_from + 7;
    when 'monthly' then return (p_from + interval '1 month')::date;
    when 'yearly' then return (p_from + interval '1 year')::date;
    when 'weekdays' then
      loop
        v := v + 1;
        exit when extract(isodow from v) < 6;
      end loop;
      return v;
    else return null;
  end case;
end;
$$;

create or replace function public.repeat_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next uuid;
begin
  insert into public.tasks (project_id, section_id, title, description, assignee_id, due_date, priority,
                            recurrence, position, created_by)
  values (new.project_id, new.section_id, new.title, new.description, new.assignee_id,
          public.next_due(coalesce(new.due_date, current_date), new.recurrence), new.priority,
          new.recurrence, new.position + 0.5, new.created_by)
  returning id into v_next;

  insert into public.task_labels (task_id, label_id)
  select v_next, label_id from public.task_labels where task_id = new.id;
  insert into public.task_assignees (task_id, user_id)
  select v_next, user_id from public.task_assignees where task_id = new.id;

  -- The completed copy stops repeating, so reopening and completing it again can't fork a second series.
  update public.tasks set recurrence = null where id = new.id;
  return null;
end;
$$;

drop trigger if exists tasks_repeat on public.tasks;
create trigger tasks_repeat
  after update of completed on public.tasks
  for each row
  when (new.completed and not old.completed and new.recurrence is not null and new.parent_id is null)
  execute function public.repeat_task();

-- ============================================================
-- In-app notifications (the inbox). Written by triggers, read by their recipient.
-- ============================================================
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('assigned', 'comment', 'mention', 'added_to_project', 'due_soon', 'overdue')),
  project_id  uuid references public.projects (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete cascade,
  comment_id  uuid references public.comments (id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Insert one notification unless it's for the person who caused it.
create or replace function public.notify_user(p_user uuid, p_kind text, p_project uuid, p_task uuid, p_comment uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, actor_id, kind, project_id, task_id, comment_id)
  select p_user, auth.uid(), p_kind, p_project, p_task, p_comment
  where p_user is not null and p_user is distinct from auth.uid();
$$;

create or replace function public.notify_on_task_assign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify_user(new.assignee_id, 'assigned', new.project_id, new.id, null);
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_notify_assign on public.tasks;
create trigger tasks_notify_assign
  after insert or update of assignee_id on public.tasks
  for each row execute function public.notify_on_task_assign();

create or replace function public.notify_on_extra_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_user(new.user_id, 'assigned', public.task_project(new.task_id), new.task_id, null);
  return null;
end;
$$;

drop trigger if exists task_assignees_notify on public.task_assignees;
create trigger task_assignees_notify
  after insert on public.task_assignees
  for each row execute function public.notify_on_extra_assignee();

-- Mentions are written into comment text as @[Name](user-id).
create or replace function public.comment_mentions(p_body text)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct m[1]::uuid), '{}')
  from regexp_matches(p_body, '@\[[^\]]{1,120}\]\(([0-9a-f-]{36})\)', 'g') as m;
$$;

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_mentioned uuid[];
  v_user uuid;
begin
  select * into v_task from public.tasks where id = new.task_id;
  -- Only people in the project can be mentioned.
  select coalesce(array_agg(m.user_id), '{}') into v_mentioned
  from public.project_members m
  where m.project_id = v_task.project_id and m.user_id = any (public.comment_mentions(new.body));

  foreach v_user in array v_mentioned loop
    perform public.notify_user(v_user, 'mention', v_task.project_id, v_task.id, new.id);
  end loop;

  for v_user in
    select distinct u from (
      select v_task.assignee_id as u
      union select v_task.created_by
      union select a.user_id from public.task_assignees a where a.task_id = v_task.id
    ) s where u is not null and not (u = any (v_mentioned))
  loop
    perform public.notify_user(v_user, 'comment', v_task.project_id, v_task.id, new.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_on_comment();

create or replace function public.notify_on_member_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Creating a project adds its owner; that's not news to them.
  if new.role = 'member' then
    perform public.notify_user(new.user_id, 'added_to_project', new.project_id, null, null);
  end if;
  return null;
end;
$$;

drop trigger if exists members_notify on public.project_members;
create trigger members_notify
  after insert on public.project_members
  for each row execute function public.notify_on_member_added();

-- ============================================================
-- Task activity: what changed on a task, by whom and when.
-- ============================================================
create table if not exists public.task_activity (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  field       text not null,
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_task_activity_task on public.task_activity (task_id, created_at);

alter table public.task_activity enable row level security;

drop policy if exists "activity read" on public.task_activity;
create policy "activity read" on public.task_activity
  for select to authenticated using (public.is_member(project_id));

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, project_id, actor_id, field, new_value)
    values (new.id, new.project_id, v_actor, 'created', new.title);
    return null;
  end if;

  if new.title is distinct from old.title then
    insert into public.task_activity (task_id, project_id, actor_id, field, old_value, new_value)
    values (new.id, new.project_id, v_actor, 'title', old.title, new.title);
  end if;
  if new.description is distinct from old.description then
    insert into public.task_activity (task_id, project_id, actor_id, field) values (new.id, new.project_id, v_actor, 'description');
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.task_activity (task_id, project_id, actor_id, field, old_value, new_value)
    values (new.id, new.project_id, v_actor, 'assignee', old.assignee_id::text, new.assignee_id::text);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_activity (task_id, project_id, actor_id, field, old_value, new_value)
    values (new.id, new.project_id, v_actor, 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_activity (task_id, project_id, actor_id, field, old_value, new_value)
    values (new.id, new.project_id, v_actor, 'priority', old.priority, new.priority);
  end if;
  if new.completed is distinct from old.completed then
    insert into public.task_activity (task_id, project_id, actor_id, field, new_value)
    values (new.id, new.project_id, v_actor, 'completed', new.completed::text);
  end if;
  if new.section_id is distinct from old.section_id then
    insert into public.task_activity (task_id, project_id, actor_id, field, old_value, new_value)
    values (new.id, new.project_id, v_actor, 'section',
            (select name from public.sections where id = old.section_id), (select name from public.sections where id = new.section_id));
  end if;
  if new.project_id is distinct from old.project_id then
    insert into public.task_activity (task_id, project_id, actor_id, field, old_value, new_value)
    values (new.id, new.project_id, v_actor, 'project',
            (select name from public.projects where id = old.project_id), (select name from public.projects where id = new.project_id));
  end if;
  if new.recurrence is distinct from old.recurrence and new.recurrence is not null then
    insert into public.task_activity (task_id, project_id, actor_id, field, new_value)
    values (new.id, new.project_id, v_actor, 'recurrence', new.recurrence);
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_activity on public.tasks;
create trigger tasks_activity
  after insert or update on public.tasks
  for each row execute function public.log_task_activity();

-- ============================================================
-- Archiving projects
-- ============================================================
alter table public.projects add column if not exists archived_at timestamptz;

-- ============================================================
-- Moving a task (and its subtasks) to another project you're in. The app moves attachment
-- files in storage first, then calls this to repoint everything in one transaction.
-- ============================================================
drop policy if exists "attachments objects update" on storage.objects;
create policy "attachments objects update" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and public.is_member(public.path_project(name)))
  with check (bucket_id = 'attachments' and public.is_member(public.path_project(name)));

create or replace function public.move_task(p_task uuid, p_project uuid, p_section uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_ids uuid[];
begin
  select * into v_task from public.tasks where id = p_task;
  if v_task.id is null or not public.is_member(v_task.project_id) or not public.is_member(p_project) then
    raise exception 'You can only move tasks between projects you are a member of';
  end if;
  if v_task.parent_id is not null then
    raise exception 'Move the parent task instead';
  end if;
  if not exists (select 1 from public.sections where id = p_section and project_id = p_project) then
    raise exception 'Pick a section in the destination project';
  end if;

  select array_agg(id) into v_ids from public.tasks where id = p_task or parent_id = p_task;

  -- Labels belong to a project; people who aren't in the destination are unassigned.
  delete from public.task_labels where task_id = any (v_ids);
  delete from public.task_assignees a where a.task_id = any (v_ids)
    and not exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = a.user_id);

  update public.tasks t set
    project_id = p_project,
    section_id = p_section,
    assignee_id = case when exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = t.assignee_id)
                       then t.assignee_id end,
    position = case when t.id = p_task
                    then coalesce((select max(position) from public.tasks where section_id = p_section and parent_id is null), 0) + 1000
                    else t.position end
  where t.id = any (v_ids);

  update public.task_attachments set
    project_id = p_project,
    path = p_project::text || substr(path, length(v_task.project_id::text) + 1)
  where task_id = any (v_ids);
end;
$$;

grant execute on function public.move_task(uuid, uuid, uuid) to authenticated;

-- ============================================================
-- Duplicating a project: sections, labels and open tasks (with subtasks and labels).
-- Members, comments and attachments aren't copied; you become its owner.
-- ============================================================
create or replace function public.duplicate_project(p_project uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.projects;
  v_new uuid;
begin
  if not public.is_member(p_project) then
    raise exception 'You can only duplicate projects you are a member of';
  end if;
  select * into v_src from public.projects where id = p_project;

  insert into public.projects (name, color, owner_id, description, status, start_date, due_date, links)
  values (left(trim(p_name), 120), v_src.color, auth.uid(), v_src.description, 'on_track', null, null, v_src.links)
  returning id into v_new;
  insert into public.project_members (project_id, user_id, role) values (v_new, auth.uid(), 'owner');

  create temp table _map (old_id uuid primary key, new_id uuid) on commit drop;

  insert into _map select id, gen_random_uuid() from public.sections where project_id = p_project;
  insert into public.sections (id, project_id, name, position)
  select m.new_id, v_new, s.name, s.position from public.sections s join _map m on m.old_id = s.id;

  insert into _map select id, gen_random_uuid() from public.project_labels where project_id = p_project;
  insert into public.project_labels (id, project_id, name, color)
  select m.new_id, v_new, l.name, l.color from public.project_labels l join _map m on m.old_id = l.id;

  insert into _map select id, gen_random_uuid() from public.tasks where project_id = p_project and not completed;
  insert into public.tasks (id, project_id, section_id, parent_id, title, description, priority, position, recurrence, created_by)
  select m.new_id, v_new, sm.new_id, pm.new_id, t.title, t.description, t.priority, t.position, t.recurrence, auth.uid()
  from public.tasks t
  join _map m on m.old_id = t.id
  left join _map sm on sm.old_id = t.section_id
  left join _map pm on pm.old_id = t.parent_id
  where t.parent_id is null or pm.new_id is not null
  order by t.parent_id nulls first;

  insert into public.task_labels (task_id, label_id)
  select tm.new_id, lm.new_id from public.task_labels tl
  join _map tm on tm.old_id = tl.task_id
  join _map lm on lm.old_id = tl.label_id
  where exists (select 1 from public.tasks where id = tm.new_id);

  return v_new;
end;
$$;

grant execute on function public.duplicate_project(uuid, text) to authenticated;

-- ============================================================
-- Due-date reminders: a daily job calls the reminders Edge Function, which checks this
-- secret (kept in Supabase Vault, never in code) before sending anything.
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'kahon_reminder_secret') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'kahon_reminder_secret');
  end if;
end $$;

create or replace function public.check_reminder_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from vault.decrypted_secrets where name = 'kahon_reminder_secret' and decrypted_secret = p_secret
  );
$$;

revoke execute on function public.check_reminder_secret(text) from public, anon, authenticated;
grant execute on function public.check_reminder_secret(text) to service_role;

-- Every day at 01:00 UTC (09:00 in Manila).
select cron.unschedule(jobid) from cron.job where jobname = 'kahon-due-reminders';
select cron.schedule(
  'kahon-due-reminders',
  '0 1 * * *',
  $job$
    select net.http_post(
      url := 'https://wvqgkelahpfhibbjvfey.supabase.co/functions/v1/reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kahon_reminder_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);

-- ============================================================
-- Client error log: errors from people's browsers, for fixing bugs nobody reported.
-- Anyone signed in can add a row; nobody can read them through the API (dashboard only).
-- ============================================================
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid() references public.profiles (id) on delete set null,
  message     text not null check (char_length(message) <= 2000),
  stack       text check (char_length(stack) <= 8000),
  url         text check (char_length(url) <= 2000),
  user_agent  text check (char_length(user_agent) <= 500),
  app_version text check (char_length(app_version) <= 20),
  created_at  timestamptz not null default now()
);

alter table public.client_errors enable row level security;

drop policy if exists "client errors insert" on public.client_errors;
create policy "client errors insert" on public.client_errors
  for insert to authenticated with check (user_id is null or user_id = auth.uid());

-- ============================================================
-- Realtime
-- ============================================================
alter table public.notifications replica identity full;
alter table public.task_labels replica identity full;
alter table public.task_assignees replica identity full;
alter table public.project_labels replica identity full;

do $$
begin
  begin alter publication supabase_realtime add table public.notifications;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_labels;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_assignees;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.project_labels;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_activity;   exception when duplicate_object then null; end;
end $$;

-- ============================================================
-- Super admins (grant with: update public.profiles set is_superadmin = true where email = '...';)
-- ============================================================
alter table public.profiles add column if not exists is_superadmin boolean not null default false;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and coalesce((select is_superadmin from public.profiles where id = auth.uid()), false);
$$;

-- Every account, for the super admin's "All users" page. Refuses anyone else.
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  job_title text,
  department text,
  color text,
  avatar_path text,
  is_superadmin boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  mfa_enabled boolean,
  projects bigint,
  projects_owned bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can list all users';
  end if;
  return query
    select u.id, coalesce(p.email, u.email::text), p.full_name, p.job_title, p.department, p.color, p.avatar_path,
           coalesce(p.is_superadmin, false), u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
           (select count(*) from public.project_members m where m.user_id = u.id),
           (select count(*) from public.project_members m where m.user_id = u.id and m.role = 'owner')
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.is_superadmin() to authenticated;

-- ============================================================
-- Project roles (project admin, editor, commenter, viewer) and task update notifications.
-- Later definitions here (add_member_by_email, set_member_role, handle_new_user, move_task,
-- notify_on_member_added) replace the earlier ones.
-- ============================================================
-- ------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------
alter table public.project_members drop constraint if exists project_members_role_check;
update public.project_members set role = 'editor' where role = 'member';
alter table public.project_members alter column role set default 'editor';
alter table public.project_members add constraint project_members_role_check
  check (role in ('owner', 'editor', 'commenter', 'viewer'));

-- Invitations remember the role the person joins with.
alter table public.invitations add column if not exists role text not null default 'editor';
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('owner', 'editor', 'commenter', 'viewer'));

create or replace function public.can_edit(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid() and role in ('owner', 'editor')
  );
$$;

create or replace function public.can_comment(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid() and role in ('owner', 'editor', 'commenter')
  );
$$;

-- ------------------------------------------------------------
-- Policies: every member reads; editors and admins write; commenters also comment.
-- ------------------------------------------------------------
drop policy if exists "sections all" on public.sections;
drop policy if exists "sections read" on public.sections;
create policy "sections read" on public.sections
  for select to authenticated using (public.is_member(project_id));
drop policy if exists "sections write" on public.sections;
create policy "sections write" on public.sections
  for all to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));

drop policy if exists "tasks all" on public.tasks;
drop policy if exists "tasks read" on public.tasks;
create policy "tasks read" on public.tasks
  for select to authenticated using (public.is_member(project_id));
drop policy if exists "tasks write" on public.tasks;
create policy "tasks write" on public.tasks
  for all to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));

drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_comment(public.task_project(task_id)));

drop policy if exists "comments update own" on public.comments;
create policy "comments update own" on public.comments
  for update to authenticated
  using (author_id = auth.uid() and public.can_comment(public.task_project(task_id)))
  with check (author_id = auth.uid());

drop policy if exists "labels all" on public.project_labels;
drop policy if exists "labels read" on public.project_labels;
create policy "labels read" on public.project_labels
  for select to authenticated using (public.is_member(project_id));
drop policy if exists "labels write" on public.project_labels;
create policy "labels write" on public.project_labels
  for all to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));

drop policy if exists "task labels all" on public.task_labels;
drop policy if exists "task labels read" on public.task_labels;
create policy "task labels read" on public.task_labels
  for select to authenticated using (public.is_member(public.task_project(task_id)));
drop policy if exists "task labels write" on public.task_labels;
create policy "task labels write" on public.task_labels
  for all to authenticated
  using (public.can_edit(public.task_project(task_id)))
  with check (
    public.can_edit(public.task_project(task_id))
    and public.task_project(task_id) = (select l.project_id from public.project_labels l where l.id = label_id)
  );

drop policy if exists "task assignees all" on public.task_assignees;
drop policy if exists "task assignees read" on public.task_assignees;
create policy "task assignees read" on public.task_assignees
  for select to authenticated using (public.is_member(public.task_project(task_id)));
drop policy if exists "task assignees write" on public.task_assignees;
create policy "task assignees write" on public.task_assignees
  for all to authenticated
  using (public.can_edit(public.task_project(task_id)))
  with check (
    public.can_edit(public.task_project(task_id))
    and exists (select 1 from public.project_members m where m.project_id = public.task_project(task_id) and m.user_id = task_assignees.user_id)
  );

drop policy if exists "attachments insert" on public.task_attachments;
create policy "attachments insert" on public.task_attachments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_edit(project_id)
    and project_id = (select t.project_id from public.tasks t where t.id = task_id)
    and path like project_id::text || '/' || task_id::text || '/%'
  );

drop policy if exists "attachments delete" on public.task_attachments;
create policy "attachments delete" on public.task_attachments
  for delete to authenticated
  using ((created_by = auth.uid() and public.can_edit(project_id)) or public.is_owner(project_id));

drop policy if exists "attachments objects insert" on storage.objects;
create policy "attachments objects insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_edit(public.path_project(name)));

drop policy if exists "attachments objects update" on storage.objects;
create policy "attachments objects update" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and public.can_edit(public.path_project(name)))
  with check (bucket_id = 'attachments' and public.can_edit(public.path_project(name)));

drop policy if exists "attachments objects delete" on storage.objects;
create policy "attachments objects delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.can_edit(public.path_project(name)));

-- ------------------------------------------------------------
-- RPCs that take or check a role
-- ------------------------------------------------------------
-- The two-argument version is replaced by one with a role (default editor).
drop function if exists public.add_member_by_email(uuid, text);

create or replace function public.add_member_by_email(p_project uuid, p_email text, p_role text default 'editor')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_role text := coalesce(p_role, 'editor');
  v_profile public.profiles;
  v_invite public.invitations;
begin
  if not public.is_owner(p_project) then
    raise exception 'Only a project admin can add members';
  end if;
  if v_role not in ('owner', 'editor', 'commenter', 'viewer') then
    raise exception 'Pick a role: project admin, editor, commenter or viewer';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select * into v_profile from public.profiles where email = v_email;
  if v_profile.id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (p_project, v_profile.id, v_role)
    on conflict do nothing;
    return json_build_object('status', 'added', 'id', v_profile.id, 'full_name', v_profile.full_name,
      'email', v_profile.email, 'color', v_profile.color);
  end if;

  insert into public.invitations (project_id, email, invited_by, role)
  values (p_project, v_email, auth.uid(), v_role)
  on conflict (project_id, email) do update set invited_by = excluded.invited_by, role = excluded.role
  returning * into v_invite;
  return json_build_object('status', 'invited', 'invitation_id', v_invite.id, 'email', v_email);
end;
$$;

grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;

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
    raise exception 'Only a project admin can change roles';
  end if;
  if p_role not in ('owner', 'editor', 'commenter', 'viewer') then
    raise exception 'Pick a role: project admin, editor, commenter or viewer';
  end if;

  -- Serialize role changes per project so two admins can't demote each other at once.
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
    raise exception 'A project needs at least one project admin. Make someone else an admin first.';
  end if;

  update public.project_members set role = p_role
  where project_id = p_project and user_id = p_user;
end;
$$;

-- New accounts join invited projects with the role they were invited with.
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

  insert into public.project_members (project_id, user_id, role)
  select i.project_id, new.id, i.role from public.invitations i where i.email = lower(new.email)
  on conflict do nothing;
  delete from public.invitations where email = lower(new.email);
  return new;
end;
$$;

-- Anyone added to a project hears about it, whatever their role. notify_user skips the
-- person doing it, so creating or duplicating a project doesn't notify its creator.
create or replace function public.notify_on_member_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_user(new.user_id, 'added_to_project', new.project_id, null, null);
  return null;
end;
$$;

-- Moving a task needs edit access in both projects.
create or replace function public.move_task(p_task uuid, p_project uuid, p_section uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_ids uuid[];
begin
  select * into v_task from public.tasks where id = p_task;
  if v_task.id is null or not public.can_edit(v_task.project_id) or not public.can_edit(p_project) then
    raise exception 'You can only move tasks between projects you can edit';
  end if;
  if v_task.parent_id is not null then
    raise exception 'Move the parent task instead';
  end if;
  if not exists (select 1 from public.sections where id = p_section and project_id = p_project) then
    raise exception 'Pick a section in the destination project';
  end if;

  select array_agg(id) into v_ids from public.tasks where id = p_task or parent_id = p_task;

  -- Labels belong to a project; people who aren't in the destination are unassigned.
  delete from public.task_labels where task_id = any (v_ids);
  delete from public.task_assignees a where a.task_id = any (v_ids)
    and not exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = a.user_id);

  update public.tasks t set
    project_id = p_project,
    section_id = p_section,
    assignee_id = case when exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = t.assignee_id)
                       then t.assignee_id end,
    position = case when t.id = p_task
                    then coalesce((select max(position) from public.tasks where section_id = p_section and parent_id is null), 0) + 1000
                    else t.position end
  where t.id = any (v_ids);

  update public.task_attachments set
    project_id = p_project,
    path = p_project::text || substr(path, length(v_task.project_id::text) + 1)
  where task_id = any (v_ids);
end;
$$;

-- ------------------------------------------------------------
-- Task updates notify the task's assignees (comments already did).
-- One unread "updated" notification per person and task: further changes bump it to the
-- top instead of piling up. A newly assigned person gets "assigned" instead.
-- ------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned', 'comment', 'mention', 'added_to_project', 'due_soon', 'overdue', 'updated'));

create or replace function public.notify_on_task_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_newly_assigned uuid := case when new.assignee_id is distinct from old.assignee_id then new.assignee_id end;
begin
  -- Changes made outside the app (SQL editor, scheduled jobs) aren't anyone's update.
  if auth.uid() is null then
    return null;
  end if;

  for v_user in
    select distinct u from (
      select new.assignee_id as u
      union select a.user_id from public.task_assignees a where a.task_id = new.id
    ) s
    where u is not null and u is distinct from v_newly_assigned and u <> auth.uid()
  loop
    update public.notifications set created_at = now(), actor_id = auth.uid()
    where user_id = v_user and task_id = new.id and kind = 'updated' and read_at is null;
    if not found then
      perform public.notify_user(v_user, 'updated', new.project_id, new.id, null);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists tasks_notify_update on public.tasks;
create trigger tasks_notify_update
  after update of title, description, assignee_id, due_date, priority, completed, section_id, recurrence, project_id
  on public.tasks
  for each row
  when (
    new.title is distinct from old.title or new.description is distinct from old.description
    or new.assignee_id is distinct from old.assignee_id or new.due_date is distinct from old.due_date
    or new.priority is distinct from old.priority or new.completed is distinct from old.completed
    or new.section_id is distinct from old.section_id or new.recurrence is distinct from old.recurrence
    or new.project_id is distinct from old.project_id
  )
  execute function public.notify_on_task_update();

-- ============ Home notepad ============
-- One private note per person, shown on Home. Only its owner can read or change it.
create table if not exists public.user_notes (
  user_id     uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  body        text not null default '' check (char_length(body) <= 20000),
  updated_at  timestamptz not null default now()
);

alter table public.user_notes enable row level security;

drop policy if exists "user notes own" on public.user_notes;
create policy "user notes own" on public.user_notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ Project reference files (Ask AI) ============
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

-- ============ Security hardening ============
-- Later definitions here (task_project, handle_new_user, add_member_by_email and several
-- policies) replace the earlier ones.
-- ------------------------------------------------------------
-- notify_user is only for the notification triggers. Like every function in public it was
-- callable through the API, so anyone could put notifications in anyone's inbox.
-- ------------------------------------------------------------
revoke execute on function public.notify_user(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;

-- A task's project only for members, so the function can't be used to look up which project
-- any task id belongs to. Policies only ever pass it to is_member/can_edit, which say no
-- to non-members anyway.
create or replace function public.task_project(p_task uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.project_id from public.tasks t
  where t.id = p_task
    and exists (select 1 from public.project_members m where m.project_id = t.project_id and m.user_id = auth.uid());
$$;

-- ------------------------------------------------------------
-- Tasks: the people and places a task points at must belong to its project. Otherwise an
-- editor could assign a task (or credit its creation) to anyone with an account, and the
-- assignment, comment and reminder emails would go to that person with the editor's text;
-- or point parent_id at another project's task and have Ask AI read out its title.
-- Checked after the row is written so tasks inserted together (duplicate_project) can see
-- each other. Writes made by other triggers (repeating tasks copy the creator and
-- assignee) and by the service role are trusted.
-- ------------------------------------------------------------
create or replace function public.check_task_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'INSERT' and new.created_by is distinct from auth.uid() then
    raise exception 'A task''s creator is the person creating it';
  end if;
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception 'A task''s creator can''t be changed';
  end if;

  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id or new.project_id is distinct from old.project_id)
     and not exists (select 1 from public.project_members m where m.project_id = new.project_id and m.user_id = new.assignee_id) then
    raise exception 'Assign the task to someone in this project';
  end if;

  if new.section_id is not null
     and (tg_op = 'INSERT' or new.section_id is distinct from old.section_id)
     and not exists (select 1 from public.sections s where s.id = new.section_id and s.project_id = new.project_id) then
    raise exception 'Pick a section in this project';
  end if;

  if new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id)
     and not exists (select 1 from public.tasks p where p.id = new.parent_id and p.project_id = new.project_id) then
    raise exception 'A subtask must be in the same project as its parent';
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_check_refs on public.tasks;
create trigger tasks_check_refs
  after insert or update of created_by, assignee_id, section_id, parent_id, project_id on public.tasks
  for each row execute function public.check_task_refs();

-- ------------------------------------------------------------
-- Projects: admins edit the details, not who the project belongs to. owner_id cascades on
-- delete, so pointing it at someone else would tie the project's life to their account.
-- ------------------------------------------------------------
revoke update on public.projects from authenticated;
grant update (name, color, description, status, start_date, due_date, links, archived_at)
  on public.projects to authenticated;

-- ------------------------------------------------------------
-- File paths: exactly <project>/<task>/<name>.<ext> or <project>/project/<name>.<ext>, the
-- shapes the app uploads. The old LIKE patterns also allowed "a/b/../../<other project>/...",
-- and the Edge Functions read (Ask AI) and delete (account deletion) by these paths with
-- the service role, which would have reached another project's files.
-- ------------------------------------------------------------
drop policy if exists "attachments insert" on public.task_attachments;
create policy "attachments insert" on public.task_attachments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_edit(project_id)
    and project_id = (select t.project_id from public.tasks t where t.id = task_id)
    and path ~ ('^' || project_id::text || '/' || task_id::text || '/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10}$')
  );

drop policy if exists "project files insert" on public.project_files;
create policy "project files insert" on public.project_files
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_owner(project_id)
    and path ~ ('^' || project_id::text || '/project/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10}$')
  );

-- ------------------------------------------------------------
-- Invitations are accepted only by an account whose email is confirmed. Before, signing up
-- (unconfirmed) with an invited address joined the project at once, and adding an existing
-- but unconfirmed account added it directly, so whoever registered the address first, not
-- necessarily its owner, got the seat.
-- ------------------------------------------------------------
create or replace function public.accept_invitations(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  select i.project_id, p_user, i.role from public.invitations i where i.email = lower(p_email)
  on conflict do nothing;
  delete from public.invitations where email = lower(p_email);
end;
$$;

revoke execute on function public.accept_invitations(uuid, text) from public, anon, authenticated;

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

  -- Google sign-ups arrive confirmed; email sign-ups wait for the confirmation link.
  if new.email_confirmed_at is not null then
    perform public.accept_invitations(new.id, new.email);
  end if;
  return new;
end;
$$;

create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.accept_invitations(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- An unconfirmed account gets an invitation instead, accepted when it's confirmed.
create or replace function public.add_member_by_email(p_project uuid, p_email text, p_role text default 'editor')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_role text := coalesce(p_role, 'editor');
  v_profile public.profiles;
  v_invite public.invitations;
begin
  if not public.is_owner(p_project) then
    raise exception 'Only a project admin can add members';
  end if;
  if v_role not in ('owner', 'editor', 'commenter', 'viewer') then
    raise exception 'Pick a role: project admin, editor, commenter or viewer';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select p.* into v_profile from public.profiles p
  join auth.users u on u.id = p.id
  where p.email = v_email and u.email_confirmed_at is not null;
  if v_profile.id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (p_project, v_profile.id, v_role)
    on conflict do nothing;
    return json_build_object('status', 'added', 'id', v_profile.id, 'full_name', v_profile.full_name,
      'email', v_profile.email, 'color', v_profile.color);
  end if;

  insert into public.invitations (project_id, email, invited_by, role)
  values (p_project, v_email, auth.uid(), v_role)
  on conflict (project_id, email) do update set invited_by = excluded.invited_by, role = excluded.role
  returning * into v_invite;
  return json_build_object('status', 'invited', 'invitation_id', v_invite.id, 'email', v_email);
end;
$$;

-- ------------------------------------------------------------
-- Two-factor also guards your own private rows: a password alone (aal1) shouldn't read your
-- notes and inbox, or change your profile, comments and memberships.
-- ------------------------------------------------------------
drop policy if exists "user notes own" on public.user_notes;
create policy "user notes own" on public.user_notes
  for all to authenticated
  using (user_id = auth.uid() and public.mfa_ok()) with check (user_id = auth.uid() and public.mfa_ok());

drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select to authenticated using (user_id = auth.uid() and public.mfa_ok());

drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update to authenticated
  using (user_id = auth.uid() and public.mfa_ok()) with check (user_id = auth.uid());

drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete to authenticated using (user_id = auth.uid() and public.mfa_ok());

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.mfa_ok()) with check (id = auth.uid());

drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments
  for delete to authenticated using (author_id = auth.uid() and public.mfa_ok());

drop policy if exists "members remove" on public.project_members;
create policy "members remove" on public.project_members
  for delete to authenticated
  using (role <> 'owner' and (public.is_owner(project_id) or (user_id = auth.uid() and public.mfa_ok())));

-- ============ Workspaces ============
-- A workspace is one company or team (Loop, NCP, ...). Every project belongs to one, and one
-- account can be in several. Workspace admins invite people and create projects; members work
-- in the projects they're added to. Nothing in one workspace is visible from another: project
-- access needs workspace membership too, and tasks can't move between workspaces.
-- Later definitions here (is_member, is_owner, can_edit, can_comment, create_project,
-- add_member_by_email, handle_new_user, move_task, duplicate_project) replace the earlier ones.
-- Invitations are no longer accepted automatically at sign-up: the invitee accepts them in the app.

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  color       text not null default '#15703C' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'member' check (role in ('admin', 'member')),
  added_at      timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists idx_workspace_members_user on public.workspace_members (user_id);

-- People without an account yet. Accepted when they sign up and confirm this email.
create table if not exists public.workspace_invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (email = lower(email) and char_length(email) between 3 and 320),
  role          text not null default 'member' check (role in ('admin', 'member')),
  invited_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  unique (workspace_id, email)
);

alter table public.projects add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
create index if not exists idx_projects_workspace on public.projects (workspace_id);

-- ------------------------------------------------------------
-- Existing projects all go into one workspace (rename it in Workspace settings). Project
-- admins and super admins become its admins, so they can still create projects; everyone
-- else in a project joins as a member. Pending project invitations also invite to it.
-- ------------------------------------------------------------
do $$
declare
  v_ws uuid;
  v_creator uuid;
begin
  if not exists (select 1 from public.projects where workspace_id is null) then
    return;
  end if;

  select id into v_creator from public.profiles where is_superadmin order by created_at limit 1;
  if v_creator is null then
    select owner_id into v_creator from public.projects order by created_at limit 1;
  end if;

  insert into public.workspaces (name, created_by) values ('My workspace', v_creator) returning id into v_ws;
  update public.projects set workspace_id = v_ws where workspace_id is null;

  insert into public.workspace_members (workspace_id, user_id, role)
  select v_ws, m.user_id, case when bool_or(m.role = 'owner') or bool_or(p.is_superadmin) then 'admin' else 'member' end
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  group by m.user_id
  on conflict do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_creator, 'admin')
  on conflict (workspace_id, user_id) do update set role = 'admin';

  insert into public.workspace_invitations (workspace_id, email, role, invited_by)
  select distinct on (i.email) v_ws, i.email, 'member', i.invited_by
  from public.invitations i
  order by i.email, i.created_at
  on conflict do nothing;
end $$;

alter table public.projects alter column workspace_id set not null;

-- ------------------------------------------------------------
-- Membership helpers. Project access now also needs membership of the project's workspace,
-- so removing someone from a workspace cuts them off from all of its projects at once.
-- ------------------------------------------------------------
create or replace function public.in_workspace(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1 from public.workspace_members where workspace_id = p_workspace and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1 from public.workspace_members where workspace_id = p_workspace and user_id = auth.uid() and role = 'admin'
  );
$$;

-- The caller's role in a project, but only while they're also in its workspace.
create or replace function public.project_role(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.project_members m
  join public.projects p on p.id = m.project_id
  join public.workspace_members w on w.workspace_id = p.workspace_id and w.user_id = m.user_id
  where m.project_id = p_project and m.user_id = auth.uid() and public.mfa_ok();
$$;

create or replace function public.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.project_role(p_project) is not null;
$$;

create or replace function public.is_owner(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.project_role(p_project) = 'owner', false);
$$;

create or replace function public.can_edit(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.project_role(p_project) in ('owner', 'editor'), false);
$$;

create or replace function public.can_comment(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.project_role(p_project) in ('owner', 'editor', 'commenter'), false);
$$;

-- People see the people they share a workspace with (member lists, assignees, comments).
create or replace function public.shares_workspace_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_workspace_with(id));

-- ------------------------------------------------------------
-- Policies. Workspaces and their members are changed only through the functions below.
-- ------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;

drop policy if exists "workspaces read" on public.workspaces;
create policy "workspaces read" on public.workspaces
  for select to authenticated using (public.in_workspace(id));

drop policy if exists "workspaces update" on public.workspaces;
create policy "workspaces update" on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));

revoke update on public.workspaces from authenticated;
grant update (name, color) on public.workspaces to authenticated;

drop policy if exists "workspace members read" on public.workspace_members;
create policy "workspace members read" on public.workspace_members
  for select to authenticated using (public.in_workspace(workspace_id));

drop policy if exists "workspace invitations read" on public.workspace_invitations;
create policy "workspace invitations read" on public.workspace_invitations
  for select to authenticated using (public.is_workspace_admin(workspace_id));

drop policy if exists "workspace invitations cancel" on public.workspace_invitations;
create policy "workspace invitations cancel" on public.workspace_invitations
  for delete to authenticated using (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- RPC: anyone signed in can start a workspace and becomes its admin. Capped per person, since
-- sign-up is open to everyone.
-- ------------------------------------------------------------
create or replace function public.create_workspace(p_name text, p_color text default '#15703C')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'Sign in to create a workspace';
  end if;
  if (select count(*) from public.workspaces where created_by = auth.uid()) >= 20 then
    raise exception 'You can create up to 20 workspaces';
  end if;

  insert into public.workspaces (name, color, created_by)
  values (trim(p_name), coalesce(p_color, '#15703C'), auth.uid())
  returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return v_id;
end;
$$;

grant execute on function public.create_workspace(text, text) to authenticated;

-- ------------------------------------------------------------
-- Invitations need the invitee's consent. Sign-up is open, so anyone can start a workspace:
-- adding an existing account directly would let a stranger pull anyone in by email, see their
-- profile and email them. Instead every invite waits until its invitee, signed in with that
-- confirmed email, accepts it (my_workspace_invitations / respond_workspace_invitation).
-- The reply is the same whether or not the email has an account, so this can't be used to
-- find out who uses Kahon.
-- ------------------------------------------------------------
create or replace function public.invite_to_workspace(p_workspace uuid, p_email text, p_role text default 'member')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_role text := coalesce(p_role, 'member');
  v_invite public.workspace_invitations;
begin
  if not public.is_workspace_admin(p_workspace) then
    raise exception 'Only a workspace admin can invite people';
  end if;
  if v_role not in ('admin', 'member') then
    raise exception 'Pick a role: admin or member';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  -- Admins can see their own member list, so this tells them nothing new.
  if exists (
    select 1 from public.workspace_members m join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace and p.email = v_email
  ) then
    raise exception '% is already in this workspace', v_email;
  end if;

  insert into public.workspace_invitations (workspace_id, email, role, invited_by)
  values (p_workspace, v_email, v_role, auth.uid())
  on conflict (workspace_id, email) do update set invited_by = excluded.invited_by, role = excluded.role
  returning * into v_invite;
  return json_build_object('status', 'invited', 'invitation_id', v_invite.id, 'email', v_email);
end;
$$;

grant execute on function public.invite_to_workspace(uuid, text, text) to authenticated;

-- The signed-in person's confirmed email, or null.
create or replace function public.my_confirmed_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(u.email::text) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

revoke execute on function public.my_confirmed_email() from public, anon, authenticated;

-- Invitations waiting for the signed-in person, with what they need to decide.
create or replace function public.my_workspace_invitations()
returns table (id uuid, workspace_id uuid, workspace_name text, workspace_color text, invited_by_name text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, w.id, w.name, w.color, coalesce(p.full_name, p.email), i.role, i.created_at
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where public.mfa_ok() and i.email = public.my_confirmed_email()
  order by i.created_at;
$$;

grant execute on function public.my_workspace_invitations() to authenticated;

-- Join (with any project invitations in that workspace) or decline.
create or replace function public.respond_workspace_invitation(p_invitation uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.my_confirmed_email();
  v_invite public.workspace_invitations;
begin
  if v_email is null or not public.mfa_ok() then
    raise exception 'Confirm your email address first';
  end if;
  select * into v_invite from public.workspace_invitations where id = p_invitation and email = v_email;
  if v_invite.id is null then
    raise exception 'That invitation is no longer available';
  end if;

  if p_accept then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_invite.workspace_id, auth.uid(), v_invite.role)
    on conflict do nothing;
    insert into public.project_members (project_id, user_id, role)
    select i.project_id, auth.uid(), i.role
    from public.invitations i join public.projects p on p.id = i.project_id
    where i.email = v_email and p.workspace_id = v_invite.workspace_id
    on conflict do nothing;
  end if;

  delete from public.invitations i using public.projects p
  where p.id = i.project_id and i.email = v_email and p.workspace_id = v_invite.workspace_id;
  delete from public.workspace_invitations where id = v_invite.id;
end;
$$;

grant execute on function public.respond_workspace_invitation(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- RPC: a workspace admin makes someone an admin or a member. A workspace keeps at least one admin.
-- ------------------------------------------------------------
create or replace function public.set_workspace_role(p_workspace uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  if not public.is_workspace_admin(p_workspace) then
    raise exception 'Only a workspace admin can change roles';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Pick a role: admin or member';
  end if;

  perform 1 from public.workspaces where id = p_workspace for update;

  select role into v_current from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if v_current is null then
    raise exception 'That person is not in this workspace';
  end if;
  if v_current = p_role then
    return;
  end if;
  if v_current = 'admin' and (select count(*) from public.workspace_members where workspace_id = p_workspace and role = 'admin') <= 1 then
    raise exception 'A workspace needs at least one admin. Make someone else an admin first.';
  end if;

  update public.workspace_members set role = p_role where workspace_id = p_workspace and user_id = p_user;
end;
$$;

grant execute on function public.set_workspace_role(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------
-- RPC: a workspace admin removes someone, or someone leaves. They leave every project in the
-- workspace and are unassigned from its open tasks. Projects they were the only project
-- admin of pass to the admin removing them (or, when they leave, to another workspace admin),
-- so the company's projects are never left without anyone able to manage them.
-- ------------------------------------------------------------
create or replace function public.remove_workspace_member(p_workspace uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_heir uuid;
  v_projects uuid[];
begin
  if not (public.is_workspace_admin(p_workspace) or (p_user = auth.uid() and public.in_workspace(p_workspace))) then
    raise exception 'Only a workspace admin can remove people';
  end if;

  perform 1 from public.workspaces where id = p_workspace for update;

  select role into v_role from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if v_role is null then
    return;
  end if;
  if v_role = 'admin' and (select count(*) from public.workspace_members where workspace_id = p_workspace and role = 'admin') <= 1 then
    raise exception 'A workspace needs at least one admin. Make someone else an admin first.';
  end if;

  v_heir := case when p_user <> auth.uid() then auth.uid() else (
    select user_id from public.workspace_members
    where workspace_id = p_workspace and role = 'admin' and user_id <> p_user
    order by added_at limit 1
  ) end;

  select coalesce(array_agg(id), '{}') into v_projects from public.projects where workspace_id = p_workspace;

  insert into public.project_members (project_id, user_id, role)
  select m.project_id, v_heir, 'owner'
  from public.project_members m
  where m.project_id = any (v_projects) and m.user_id = p_user and m.role = 'owner'
    and not exists (
      select 1 from public.project_members o
      where o.project_id = m.project_id and o.role = 'owner' and o.user_id <> p_user
    )
  on conflict (project_id, user_id) do update set role = 'owner';

  update public.tasks set assignee_id = null
  where project_id = any (v_projects) and assignee_id = p_user and not completed;
  delete from public.task_assignees a
  using public.tasks t
  where t.id = a.task_id and t.project_id = any (v_projects) and a.user_id = p_user;
  delete from public.project_members where project_id = any (v_projects) and user_id = p_user;
  delete from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
end;
$$;

grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: only workspace admins create projects, inside their workspace.
-- ------------------------------------------------------------
drop function if exists public.create_project(text, text);

create or replace function public.create_project(p_workspace uuid, p_name text, p_color text default '#2E6F73')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_workspace_admin(p_workspace) then
    raise exception 'Only a workspace admin can create projects';
  end if;

  insert into public.projects (name, color, owner_id, workspace_id)
  values (trim(p_name), coalesce(p_color, '#2E6F73'), auth.uid(), p_workspace)
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

grant execute on function public.create_project(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- RPC: a project admin adds people to a project. People already in the workspace are added
-- straight away. Anyone else is invited to the workspace and the project together (they
-- join both when they accept), and only a workspace admin may do that. Accounts are never
-- matched by email from outside the workspace, so the reply doesn't reveal who has one.
-- Replaces the sign-up trigger's automatic joining: invitations are now always accepted in the app.
-- ------------------------------------------------------------
create or replace function public.add_member_by_email(p_project uuid, p_email text, p_role text default 'editor')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_role text := coalesce(p_role, 'editor');
  v_ws public.workspaces;
  v_user uuid;
  v_profile public.profiles;
  v_invite public.invitations;
begin
  if not public.is_owner(p_project) then
    raise exception 'Only a project admin can add members';
  end if;
  if v_role not in ('owner', 'editor', 'commenter', 'viewer') then
    raise exception 'Pick a role: project admin, editor, commenter or viewer';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select w.* into v_ws from public.workspaces w join public.projects p on p.workspace_id = w.id where p.id = p_project;
  select m.user_id into v_user from public.workspace_members m join public.profiles p on p.id = m.user_id
  where m.workspace_id = v_ws.id and p.email = v_email;

  if v_user is not null then
    insert into public.project_members (project_id, user_id, role)
    values (p_project, v_user, v_role)
    on conflict do nothing;
    select * into v_profile from public.profiles where id = v_user;
    return json_build_object('status', 'added', 'id', v_profile.id, 'full_name', v_profile.full_name,
      'email', v_profile.email, 'color', v_profile.color);
  end if;

  if not public.is_workspace_admin(v_ws.id) then
    raise exception 'That email isn''t in the % workspace. Ask a workspace admin to invite them first.', v_ws.name;
  end if;

  insert into public.workspace_invitations (workspace_id, email, role, invited_by)
  values (v_ws.id, v_email, 'member', auth.uid())
  on conflict do nothing;
  insert into public.invitations (project_id, email, invited_by, role)
  values (p_project, v_email, auth.uid(), v_role)
  on conflict (project_id, email) do update set invited_by = excluded.invited_by, role = excluded.role
  returning * into v_invite;
  return json_build_object('status', 'invited', 'invitation_id', v_invite.id, 'email', v_email);
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
drop function if exists public.handle_user_confirmed();

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

drop function if exists public.accept_invitations(uuid, text);

-- ------------------------------------------------------------
-- Tasks move only between projects in the same workspace.
-- ------------------------------------------------------------
create or replace function public.move_task(p_task uuid, p_project uuid, p_section uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_ids uuid[];
begin
  select * into v_task from public.tasks where id = p_task;
  if v_task.id is null or not public.can_edit(v_task.project_id) or not public.can_edit(p_project) then
    raise exception 'You can only move tasks between projects you can edit';
  end if;
  if (select workspace_id from public.projects where id = v_task.project_id)
     is distinct from (select workspace_id from public.projects where id = p_project) then
    raise exception 'Tasks can only move between projects in the same workspace';
  end if;
  if v_task.parent_id is not null then
    raise exception 'Move the parent task instead';
  end if;
  if not exists (select 1 from public.sections where id = p_section and project_id = p_project) then
    raise exception 'Pick a section in the destination project';
  end if;

  select array_agg(id) into v_ids from public.tasks where id = p_task or parent_id = p_task;

  -- Labels belong to a project; people who aren't in the destination are unassigned.
  delete from public.task_labels where task_id = any (v_ids);
  delete from public.task_assignees a where a.task_id = any (v_ids)
    and not exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = a.user_id);

  update public.tasks t set
    project_id = p_project,
    section_id = p_section,
    assignee_id = case when exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = t.assignee_id)
                       then t.assignee_id end,
    position = case when t.id = p_task
                    then coalesce((select max(position) from public.tasks where section_id = p_section and parent_id is null), 0) + 1000
                    else t.position end
  where t.id = any (v_ids);

  update public.task_attachments set
    project_id = p_project,
    path = p_project::text || substr(path, length(v_task.project_id::text) + 1)
  where task_id = any (v_ids);
end;
$$;

-- ------------------------------------------------------------
-- Duplicating a project creates a project, so it needs a workspace admin, and the copy stays
-- in the same workspace.
-- ------------------------------------------------------------
create or replace function public.duplicate_project(p_project uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.projects;
  v_new uuid;
begin
  select * into v_src from public.projects where id = p_project;
  if not public.is_member(p_project) or not public.is_workspace_admin(v_src.workspace_id) then
    raise exception 'Only a workspace admin can duplicate projects';
  end if;

  insert into public.projects (name, color, owner_id, workspace_id, description, status, start_date, due_date, links)
  values (left(trim(p_name), 120), v_src.color, auth.uid(), v_src.workspace_id, v_src.description, 'on_track', null, null, v_src.links)
  returning id into v_new;
  insert into public.project_members (project_id, user_id, role) values (v_new, auth.uid(), 'owner');

  create temp table _map (old_id uuid primary key, new_id uuid) on commit drop;

  insert into _map select id, gen_random_uuid() from public.sections where project_id = p_project;
  insert into public.sections (id, project_id, name, position)
  select m.new_id, v_new, s.name, s.position from public.sections s join _map m on m.old_id = s.id;

  insert into _map select id, gen_random_uuid() from public.project_labels where project_id = p_project;
  insert into public.project_labels (id, project_id, name, color)
  select m.new_id, v_new, l.name, l.color from public.project_labels l join _map m on m.old_id = l.id;

  insert into _map select id, gen_random_uuid() from public.tasks where project_id = p_project and not completed;
  insert into public.tasks (id, project_id, section_id, parent_id, title, description, priority, position, recurrence, created_by)
  select m.new_id, v_new, sm.new_id, pm.new_id, t.title, t.description, t.priority, t.position, t.recurrence, auth.uid()
  from public.tasks t
  join _map m on m.old_id = t.id
  left join _map sm on sm.old_id = t.section_id
  left join _map pm on pm.old_id = t.parent_id
  where t.parent_id is null or pm.new_id is not null
  order by t.parent_id nulls first;

  insert into public.task_labels (task_id, label_id)
  select tm.new_id, lm.new_id from public.task_labels tl
  join _map tm on tm.old_id = tl.task_id
  join _map lm on lm.old_id = tl.label_id
  where exists (select 1 from public.tasks where id = tm.new_id);

  return v_new;
end;
$$;

-- ------------------------------------------------------------
-- Realtime: the sidebar's workspace list and switcher.
-- ------------------------------------------------------------
alter table public.workspaces replica identity full;
alter table public.workspace_members replica identity full;

do $$
begin
  begin alter publication supabase_realtime add table public.workspaces;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.workspace_members; exception when duplicate_object then null; end;
end $$;

-- ============ Super admin: all workspaces ============
-- Every workspace with its admins and how much is in it. Read-only, and refuses anyone who
-- isn't a super admin (who must also have passed two-factor when it's on).
create or replace function public.admin_list_workspaces()
returns table (
  id uuid,
  name text,
  color text,
  created_at timestamptz,
  created_by_name text,
  members bigint,
  admins bigint,
  admin_names text,
  projects bigint,
  archived_projects bigint,
  open_tasks bigint,
  pending_invites bigint,
  last_activity timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can list all workspaces';
  end if;
  return query
    select w.id, w.name, w.color, w.created_at, coalesce(c.full_name, c.email),
           (select count(*) from public.workspace_members m where m.workspace_id = w.id),
           (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.role = 'admin'),
           (select string_agg(coalesce(p.full_name, p.email), ', ' order by coalesce(p.full_name, p.email))
              from public.workspace_members m join public.profiles p on p.id = m.user_id
              where m.workspace_id = w.id and m.role = 'admin'),
           (select count(*) from public.projects pr where pr.workspace_id = w.id and pr.archived_at is null),
           (select count(*) from public.projects pr where pr.workspace_id = w.id and pr.archived_at is not null),
           (select count(*) from public.tasks t join public.projects pr on pr.id = t.project_id
              where pr.workspace_id = w.id and not t.completed),
           (select count(*) from public.workspace_invitations i where i.workspace_id = w.id),
           (select max(a.created_at) from public.task_activity a join public.projects pr on pr.id = a.project_id
              where pr.workspace_id = w.id)
    from public.workspaces w
    left join public.profiles c on c.id = w.created_by
    order by w.created_at desc;
end;
$$;

revoke execute on function public.admin_list_workspaces() from public, anon;
grant execute on function public.admin_list_workspaces() to authenticated;

-- ============ Super admin tools ============

-- ------------------------------------------------------------
-- Audit log: every action a super admin takes. Written only by admin_log_action(), read only
-- through admin_security_overview(). RLS on with no policies, so the API can't touch it.
-- ------------------------------------------------------------
create table if not exists public.admin_audit (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null check (action in ('resend_confirmation')),
  target_user  uuid references public.profiles (id) on delete set null,
  target_email text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_admin_audit_created on public.admin_audit (created_at desc);

alter table public.admin_audit enable row level security;

-- Records an action before the app performs it. Only actions in the check above are allowed,
-- and the target must be a real, still-unconfirmed account for a confirmation resend.
create or replace function public.admin_log_action(p_action text, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can do that';
  end if;
  if p_action = 'resend_confirmation' then
    select u.email into v_email from auth.users u where u.id = p_user and u.email_confirmed_at is null;
    if v_email is null then
      raise exception 'That account is already confirmed, or no longer exists';
    end if;
  else
    raise exception 'Unknown action';
  end if;

  insert into public.admin_audit (actor_id, action, target_user, target_email)
  values (auth.uid(), p_action, p_user, v_email);
  return v_email;
end;
$$;

revoke execute on function public.admin_log_action(text, uuid) from public, anon;
grant execute on function public.admin_log_action(text, uuid) to authenticated;

-- ------------------------------------------------------------
-- Errors: browser errors from client_errors, grouped by message, newest first.
-- ------------------------------------------------------------
create or replace function public.admin_list_errors(p_days integer default 7)
returns table (
  message text,
  occurrences bigint,
  people bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  last_url text,
  last_version text,
  last_user text,
  sample_stack text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view errors';
  end if;
  return query
    select g.message, g.occurrences, g.people, g.first_seen, g.last_seen,
           l.url, l.app_version, coalesce(p.full_name, p.email), l.stack
    from (
      select e.message, count(*) as occurrences, count(distinct e.user_id) as people,
             min(e.created_at) as first_seen, max(e.created_at) as last_seen, max(e.id) as last_id
      from public.client_errors e
      where e.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
      group by e.message
    ) g
    join public.client_errors l on l.id = g.last_id
    left join public.profiles p on p.id = l.user_id
    order by g.last_seen desc
    limit 200;
end;
$$;

revoke execute on function public.admin_list_errors(integer) from public, anon;
grant execute on function public.admin_list_errors(integer) to authenticated;

-- ------------------------------------------------------------
-- Ask AI usage: requests and tokens per day, per person and per workspace.
-- ------------------------------------------------------------
create or replace function public.admin_ai_usage(p_days integer default 30)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view Ask AI usage';
  end if;
  return json_build_object(
    'daily', coalesce((
      select json_agg(d order by d.day) from (
        select r.created_at::date as day, count(*) as requests,
               coalesce(sum(r.input_tokens), 0) as input_tokens, coalesce(sum(r.output_tokens), 0) as output_tokens
        from public.ai_requests r where r.created_at >= v_since
        group by 1
      ) d), '[]'),
    'people', coalesce((
      select json_agg(x order by x.requests desc) from (
        select r.user_id, coalesce(p.full_name, p.email) as name, p.email, count(*) as requests,
               coalesce(sum(r.input_tokens), 0) as input_tokens, coalesce(sum(r.output_tokens), 0) as output_tokens,
               (select max(c) from (
                  select count(*) as c from public.ai_requests r2
                  where r2.user_id = r.user_id and r2.created_at >= v_since group by r2.created_at::date
               ) busiest) as busiest_day,
               max(r.created_at) as last_used
        from public.ai_requests r left join public.profiles p on p.id = r.user_id
        where r.created_at >= v_since
        group by r.user_id, p.full_name, p.email
        order by requests desc
        limit 100
      ) x), '[]'),
    'workspaces', coalesce((
      select json_agg(x order by x.requests desc) from (
        select w.id, w.name, w.color, count(*) as requests,
               coalesce(sum(r.input_tokens), 0) + coalesce(sum(r.output_tokens), 0) as tokens
        from public.ai_requests r
        join public.tasks t on t.id = r.task_id
        join public.projects pr on pr.id = t.project_id
        join public.workspaces w on w.id = pr.workspace_id
        where r.created_at >= v_since
        group by w.id, w.name, w.color
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_ai_usage(integer) from public, anon;
grant execute on function public.admin_ai_usage(integer) to authenticated;

-- ------------------------------------------------------------
-- Emails sent: totals by kind and day, and who sends the most invitations (logged against
-- the sender) — the early warning for spam now that anyone can sign up.
-- ------------------------------------------------------------
create or replace function public.admin_email_stats(p_days integer default 30)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view email activity';
  end if;
  return json_build_object(
    'kinds', coalesce((
      select json_agg(k order by k.sent desc) from (
        select l.kind, count(*) as sent, max(l.sent_at) as last_sent
        from public.email_log l where l.sent_at >= v_since group by l.kind
      ) k), '[]'),
    'daily', coalesce((
      select json_agg(d order by d.day) from (
        select l.sent_at::date as day, count(*) as sent
        from public.email_log l where l.sent_at >= v_since group by 1
      ) d), '[]'),
    'inviters', coalesce((
      select json_agg(x order by x.invites desc) from (
        select l.recipient_id as user_id, coalesce(p.full_name, p.email) as name, p.email, count(*) as invites,
               count(*) filter (where l.sent_at >= now() - interval '1 day') as last_day,
               max(l.sent_at) as last_sent
        from public.email_log l left join public.profiles p on p.id = l.recipient_id
        where l.kind = 'invited' and l.sent_at >= v_since
        group by l.recipient_id, p.full_name, p.email
        order by invites desc
        limit 50
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_email_stats(integer) from public, anon;
grant execute on function public.admin_email_stats(integer) to authenticated;

-- ------------------------------------------------------------
-- Security overview: accounts without two-factor, unconfirmed sign-ups, new accounts,
-- workspaces with no admin, super admins, and the latest super admin actions.
-- ------------------------------------------------------------
create or replace function public.admin_security_overview()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view the security overview';
  end if;
  return json_build_object(
    'accounts', (select count(*) from auth.users),
    'no_2fa', coalesce((
      select json_agg(x order by x.is_superadmin desc, x.created_at desc) from (
        select u.id, coalesce(p.full_name, u.email::text) as name, u.email, coalesce(p.is_superadmin, false) as is_superadmin,
               u.created_at, u.last_sign_in_at
        from auth.users u left join public.profiles p on p.id = u.id
        where u.email_confirmed_at is not null
          and not exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
      ) x), '[]'),
    'unconfirmed', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select u.id, coalesce(p.full_name, u.email::text) as name, u.email, u.created_at
        from auth.users u left join public.profiles p on p.id = u.id
        where u.email_confirmed_at is null
      ) x), '[]'),
    'new_accounts', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select u.id, coalesce(p.full_name, u.email::text) as name, u.email, u.created_at,
               u.email_confirmed_at is not null as confirmed,
               (select count(*) from public.workspace_members m where m.user_id = u.id) as workspaces
        from auth.users u left join public.profiles p on p.id = u.id
        where u.created_at >= now() - interval '7 days'
      ) x), '[]'),
    'workspaces_without_admin', coalesce((
      select json_agg(x order by x.name) from (
        select w.id, w.name, w.color,
               (select count(*) from public.workspace_members m where m.workspace_id = w.id) as members
        from public.workspaces w
        where not exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.role = 'admin')
      ) x), '[]'),
    'superadmins', coalesce((
      select json_agg(x order by x.name) from (
        select p.id, coalesce(p.full_name, p.email) as name, p.email,
               exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') as mfa_enabled
        from public.profiles p where p.is_superadmin
      ) x), '[]'),
    'audit', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select a.action, a.target_email, a.created_at, coalesce(p.full_name, p.email) as actor
        from public.admin_audit a left join public.profiles p on p.id = a.actor_id
        order by a.created_at desc limit 50
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_security_overview() from public, anon;
grant execute on function public.admin_security_overview() to authenticated;
