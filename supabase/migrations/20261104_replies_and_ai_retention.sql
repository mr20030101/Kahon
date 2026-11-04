-- Replies in the Inbox, and Ask AI questions kept for 30 days (2026-11-04). Run once in Supabase ->
-- SQL Editor, after 20261104_comment_threads.sql and 20261104_ask_ai_security.sql.
-- supabase/schema.sql includes the same changes.

-- A reply notifies as 'reply', so the Inbox can say "replied to a comment on …".
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned', 'comment', 'reply', 'mention', 'added_to_project', 'due_soon', 'overdue', 'updated'));

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
  -- Replies say so in the Inbox ("replied to a comment on …").
  v_kind text := case when new.parent_id is null then 'comment' else 'reply' end;
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
    perform public.notify_user(v_user, v_kind, v_task.project_id, v_task.id, new.id);
  end loop;
  return null;
end;
$$;

-- Ask AI questions are kept for 30 days, then cleared every night at 01:30 UTC. The rest of the
-- row stays, for the daily limit and the usage numbers on the Ask AI usage page.
create or replace function public.clear_old_ai_questions()
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_requests set question = null
  where question is not null and created_at < now() - interval '30 days';
$$;

revoke execute on function public.clear_old_ai_questions() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kahon-ai-question-cleanup';
select cron.schedule('kahon-ai-question-cleanup', '30 1 * * *', $job$ select public.clear_old_ai_questions(); $job$);
