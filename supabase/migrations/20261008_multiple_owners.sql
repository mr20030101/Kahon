-- Multiple project owners (2026-10-08). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same function for fresh installs.

-- ------------------------------------------------------------
-- RPC: an owner makes a member an owner, or an owner a member.
-- A project always keeps at least one owner.
-- ------------------------------------------------------------
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
    raise exception 'Only a project owner can change roles';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'Role must be owner or member';
  end if;

  -- Serialize role changes per project so two owners can't demote each other at once.
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
    raise exception 'A project needs at least one owner. Make someone else an owner first.';
  end if;

  update public.project_members set role = p_role
  where project_id = p_project and user_id = p_user;
end;
$$;

grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
