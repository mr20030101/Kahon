-- Project roles and task update notifications (2026-10-09). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.
--
-- Roles, per project:
--   owner      "Project admin": everything, plus members, settings, archiving and deleting
--   editor     add, edit and delete anything in the project (what "member" used to be)
--   commenter  read and comment, but no edits
--   viewer     read only
-- Existing members become editors, so nobody loses access they had.

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
