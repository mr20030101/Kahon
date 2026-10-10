-- Workspaces (2026-10-10). Run once in Supabase -> SQL Editor, after
-- 20261010_security_hardening.sql. supabase/schema.sql includes the same changes for fresh installs.
--
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
