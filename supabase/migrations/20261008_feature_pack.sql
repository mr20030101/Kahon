-- Feature pack (2026-10-08): invitations, comment editing, labels, extra assignees,
-- repeating tasks, in-app notifications and @mentions, task activity, project archiving,
-- moving and duplicating, due-date reminders, and client error logging.
-- Run once in Supabase -> SQL Editor. supabase/schema.sql includes the same changes.

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
