-- Deleting a section (column) can move its tasks to another section first (2026-10-16).
-- Run once in Supabase -> SQL Editor. supabase/schema.sql includes the same changes for fresh installs.

-- Moves every task in p_section (subtasks included) to p_target, after the tasks already there
-- and in their current order, then deletes p_section. One transaction: if the move fails the
-- section isn't deleted, so its tasks can't be lost by a cascade.
--
-- Runs as the caller (security invoker), so RLS decides who may move the tasks and delete the
-- section, exactly as if they did each step themselves.
create or replace function public.delete_section_move_tasks(p_section uuid, p_target uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project uuid;
  v_last double precision;
begin
  select project_id into v_project from public.sections where id = p_section;
  if v_project is null then
    raise exception 'That section no longer exists';
  end if;
  if p_target is null or p_target = p_section
     or not exists (select 1 from public.sections where id = p_target and project_id = v_project) then
    raise exception 'Choose another section in this project to move the tasks to';
  end if;

  select coalesce(max(position), 0) into v_last
  from public.tasks where section_id = p_target and parent_id is null;

  -- Top-level tasks go to the end of the target, keeping their order.
  update public.tasks t set section_id = p_target, position = v_last + o.rn * 1000
  from (
    select id, row_number() over (order by position, created_at) as rn
    from public.tasks where section_id = p_section and parent_id is null
  ) o
  where t.id = o.id;

  -- Subtasks keep their place under their parent.
  update public.tasks set section_id = p_target where section_id = p_section;

  -- Anything left (rows the caller isn't allowed to change) would be deleted with the section,
  -- so stop instead.
  if exists (select 1 from public.tasks where section_id = p_section) then
    raise exception 'Some tasks could not be moved, so the section was not deleted';
  end if;

  delete from public.sections where id = p_section;
  if not found then
    raise exception 'You can''t delete sections in this project';
  end if;
end;
$$;

revoke execute on function public.delete_section_move_tasks(uuid, uuid) from public, anon;
grant execute on function public.delete_section_move_tasks(uuid, uuid) to authenticated;
