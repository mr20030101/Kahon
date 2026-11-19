-- Merge tasks (2026-11-19). Run once in Supabase -> SQL Editor; supabase/schema.sql includes the
-- same changes.
--
-- merge_tasks(source, target) folds a duplicate task into another task in the same project, then
-- deletes the duplicate. The target keeps its own title and settings:
--   - Comments (with their replies, reactions and files), attachments, subtasks, time entries and
--     notifications move to the target.
--   - Labels, extra assignees and custom field values are added; a field the target already has
--     a value for keeps it.
--   - Assignee, due date and priority fill in only where the target has none; a different main
--     assignee becomes an extra assignee.
--   - The duplicate's description is added under the target's.
-- Stored files keep their paths: those only need the project's folder, which doesn't change.

create or replace function public.merge_tasks(p_source uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.tasks;
  v_dst public.tasks;
  v_desc text;
  v_src_assignee uuid;
begin
  select * into v_src from public.tasks where id = p_source for update;
  select * into v_dst from public.tasks where id = p_target for update;
  if v_src.id is null or v_dst.id is null or not public.can_edit(v_src.project_id) then
    raise exception 'You can only merge tasks in a project you can edit';
  end if;
  if v_src.id = v_dst.id then
    raise exception 'Pick a different task to merge into';
  end if;
  if v_src.project_id <> v_dst.project_id then
    raise exception 'You can only merge tasks in the same project';
  end if;
  if v_dst.parent_id = v_src.id then
    raise exception 'A task can''t be merged into one of its own subtasks';
  end if;
  if v_dst.parent_id is not null and exists (select 1 from public.tasks where parent_id = v_src.id) then
    raise exception 'This task has subtasks, so merge it into a top-level task';
  end if;

  -- Someone who has since left the project can't be assigned.
  select m.user_id into v_src_assignee from public.project_members m
  where m.project_id = v_src.project_id and m.user_id = v_src.assignee_id;

  update public.tasks set parent_id = v_dst.id where parent_id = v_src.id;

  update public.comments set task_id = v_dst.id where task_id = v_src.id;
  update public.comment_reactions set task_id = v_dst.id where task_id = v_src.id;
  update public.task_attachments set task_id = v_dst.id where task_id = v_src.id;
  update public.drive_uploads set task_id = v_dst.id where task_id = v_src.id;
  update public.time_entries set task_id = v_dst.id where task_id = v_src.id;
  update public.notifications set task_id = v_dst.id where task_id = v_src.id;
  update public.ai_requests set task_id = v_dst.id where task_id = v_src.id;

  insert into public.task_labels (task_id, label_id)
  select v_dst.id, label_id from public.task_labels where task_id = v_src.id
  on conflict do nothing;

  insert into public.task_assignees (task_id, user_id)
  select v_dst.id, u.user_id
  from (
    select user_id from public.task_assignees where task_id = v_src.id
    union select v_src_assignee where v_src_assignee is not null and v_dst.assignee_id is not null
  ) u
  where u.user_id is distinct from v_dst.assignee_id
    and exists (select 1 from public.project_members m where m.project_id = v_dst.project_id and m.user_id = u.user_id)
  on conflict do nothing;

  insert into public.task_field_values (task_id, field_id, value)
  select v_dst.id, field_id, value from public.task_field_values where task_id = v_src.id
  on conflict do nothing;

  v_desc := v_dst.description;
  if btrim(v_src.description) <> '' then
    v_desc := case when btrim(v_desc) = '' then v_src.description
                   else v_desc || E'\n\n---\n\n**Merged from "' || v_src.title || E'":**\n\n' || v_src.description end;
  end if;

  update public.tasks set
    description = v_desc,
    assignee_id = coalesce(v_dst.assignee_id, v_src_assignee),
    due_date = coalesce(v_dst.due_date, v_src.due_date),
    priority = coalesce(v_dst.priority, v_src.priority)
  where id = v_dst.id;

  insert into public.task_activity (task_id, project_id, actor_id, field, new_value)
  values (v_dst.id, v_dst.project_id, auth.uid(), 'merged', v_src.title);

  delete from public.tasks where id = v_src.id;
end;
$$;

revoke execute on function public.merge_tasks(uuid, uuid) from public, anon;
grant execute on function public.merge_tasks(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
