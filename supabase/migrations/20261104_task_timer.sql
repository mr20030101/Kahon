-- Time tracking on tasks (2026-11-04). Run once in Supabase -> SQL Editor; supabase/schema.sql
-- includes the same changes.
--
-- A time entry is someone's stretch of work on a task: started_at to ended_at, or still running
-- when ended_at is null. Each person has at most one running timer; starting another stops it.
-- Editors and project admins track time; everyone in the project can see it. Entries follow
-- their task (moves, deletes) because they hang off task_id.

create table if not exists public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  -- A typo like "100h" shouldn't count; a single entry is at most a day.
  check (ended_at is null or ended_at - started_at <= interval '24 hours')
);

create index if not exists idx_time_entries_task on public.time_entries (task_id);
create unique index if not exists idx_time_entries_running on public.time_entries (user_id) where ended_at is null;

alter table public.time_entries enable row level security;

drop policy if exists "time read" on public.time_entries;
create policy "time read" on public.time_entries
  for select to authenticated using (public.is_member(public.task_project(task_id)));

-- Logged by hand (Add time). Timers go through start_timer().
drop policy if exists "time insert own" on public.time_entries;
create policy "time insert own" on public.time_entries
  for insert to authenticated
  with check (
    user_id = auth.uid() and public.can_edit(public.task_project(task_id))
    and ended_at is not null and ended_at <= now() + interval '5 minutes'
  );

drop policy if exists "time update own" on public.time_entries;
create policy "time update own" on public.time_entries
  for update to authenticated
  using (user_id = auth.uid() and public.can_edit(public.task_project(task_id)))
  with check (user_id = auth.uid());

revoke update on public.time_entries from authenticated;
grant update (started_at, ended_at, note) on public.time_entries to authenticated;

-- Your own entries, or anyone's if you're a project admin.
drop policy if exists "time delete" on public.time_entries;
create policy "time delete" on public.time_entries
  for delete to authenticated
  using (user_id = auth.uid() or public.is_owner(public.task_project(task_id)));

-- Start a timer on a task, stopping any you have running. Returns the new entry.
create or replace function public.start_timer(p_task uuid)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.time_entries;
begin
  if not public.can_edit(public.task_project(p_task)) then
    raise exception 'Only editors can track time on this task';
  end if;
  -- A timer left running over a day counts as a day (the entry limit).
  update public.time_entries set ended_at = least(now(), started_at + interval '24 hours')
  where user_id = auth.uid() and ended_at is null;
  insert into public.time_entries (task_id, user_id) values (p_task, auth.uid()) returning * into v_entry;
  return v_entry;
end;
$$;

-- Stop your running timer, if any.
create or replace function public.stop_timer()
returns void
language sql
security definer
set search_path = public
as $$
  update public.time_entries set ended_at = least(now(), started_at + interval '24 hours')
  where user_id = auth.uid() and ended_at is null;
$$;

revoke execute on function public.start_timer(uuid) from public, anon;
revoke execute on function public.stop_timer() from public, anon;
grant execute on function public.start_timer(uuid) to authenticated;
grant execute on function public.stop_timer() to authenticated;

alter table public.time_entries replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.time_entries; exception when duplicate_object then null; end;
end;
$$;
