-- Security hardening (2026-10-10). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.

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
