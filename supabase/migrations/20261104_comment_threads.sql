-- Comment replies, reactions, pins and notifications (2026-11-04). Run once in Supabase -> SQL
-- Editor, after 20261104_comment_files.sql. supabase/schema.sql includes the same changes.
--
--   Replies:    comments.parent_id, one level deep: a reply to a reply answers the same comment.
--   Pins:       comments.pinned_at/pinned_by, set by editors and project admins with pin_comment().
--   Reactions:  comment_reactions, one row per person, comment and emoji.
--   Following:  comment_followers, people who asked to hear about replies to a comment. A reply
--               notifies the comment's author, its followers and everyone else who replied.

alter table public.comments add column if not exists parent_id uuid references public.comments (id) on delete cascade;
alter table public.comments add column if not exists pinned_at timestamptz;
-- No foreign key on pinned_by: a second link from comments to profiles would make the app's
-- author:profiles(...) lookups ambiguous, and comments would fail to load.
alter table public.comments add column if not exists pinned_by uuid;
alter table public.comments drop constraint if exists comments_pinned_by_fkey;
create index if not exists idx_comments_parent on public.comments (parent_id) where parent_id is not null;

-- A reply answers a top-level comment on the same task.
create or replace function public.check_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.comments p where p.id = new.parent_id and p.task_id = new.task_id and p.parent_id is null
  ) then
    raise exception 'You can only reply to a comment on this task';
  end if;
  return new;
end;
$$;

drop trigger if exists check_comment_parent on public.comments;
create trigger check_comment_parent before insert on public.comments
  for each row execute function public.check_comment_parent();

-- The project a comment is in.
create or replace function public.comment_project(p_comment uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.project_id from public.comments c join public.tasks t on t.id = c.task_id where c.id = p_comment;
$$;

grant execute on function public.comment_project(uuid) to authenticated;

-- Pin (or unpin) a top-level comment. Editors and project admins only.
create or replace function public.pin_comment(p_comment uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.comments where id = p_comment and parent_id is null)
     or not public.can_edit(public.comment_project(p_comment)) then
    raise exception 'Only editors can pin comments';
  end if;
  update public.comments
  set pinned_at = case when p_pinned then now() end, pinned_by = case when p_pinned then auth.uid() end
  where id = p_comment;
end;
$$;

revoke execute on function public.pin_comment(uuid, boolean) from public, anon;
grant execute on function public.pin_comment(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- Reactions. task_id is kept on the row so the task panel can follow them live.
-- ------------------------------------------------------------
create table if not exists public.comment_reactions (
  comment_id  uuid not null references public.comments (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 16),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);

create index if not exists idx_comment_reactions_task on public.comment_reactions (task_id);

alter table public.comment_reactions enable row level security;

drop policy if exists "reactions read" on public.comment_reactions;
create policy "reactions read" on public.comment_reactions
  for select to authenticated using (public.is_member(public.task_project(task_id)));

drop policy if exists "reactions insert" on public.comment_reactions;
create policy "reactions insert" on public.comment_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and task_id = (select c.task_id from public.comments c where c.id = comment_id)
    and public.can_comment(public.task_project(task_id))
  );

drop policy if exists "reactions delete own" on public.comment_reactions;
create policy "reactions delete own" on public.comment_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Following a comment: hear about its replies. Each person sees and changes only their own.
-- ------------------------------------------------------------
create table if not exists public.comment_followers (
  comment_id  uuid not null references public.comments (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_followers enable row level security;

drop policy if exists "comment followers read own" on public.comment_followers;
create policy "comment followers read own" on public.comment_followers
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "comment followers insert own" on public.comment_followers;
create policy "comment followers insert own" on public.comment_followers
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(public.comment_project(comment_id)));

drop policy if exists "comment followers delete own" on public.comment_followers;
create policy "comment followers delete own" on public.comment_followers
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Comment notifications: as before, plus for a reply the comment's author, its followers and
-- the others who replied (if they're still in the project).
-- ------------------------------------------------------------
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
      union select p.author_id from public.comments p where p.id = new.parent_id
      union select f.user_id from public.comment_followers f where f.comment_id = new.parent_id
      union select r.author_id from public.comments r where new.parent_id is not null and r.parent_id = new.parent_id
    ) s
    where u is not null and not (u = any (v_mentioned))
      and exists (select 1 from public.project_members m where m.project_id = v_task.project_id and m.user_id = s.u)
  loop
    perform public.notify_user(v_user, 'comment', v_task.project_id, v_task.id, new.id);
  end loop;
  return null;
end;
$$;

alter table public.comment_reactions replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.comment_reactions; exception when duplicate_object then null; end;
end;
$$;
