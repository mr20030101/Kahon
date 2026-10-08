-- Completing a task completes its subtasks (2026-10-08). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same trigger for fresh installs.

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

-- Catch up existing data: subtasks of tasks that are already completed.
update public.tasks c set completed = true
from public.tasks p
where c.parent_id = p.id and p.completed and not c.completed;
