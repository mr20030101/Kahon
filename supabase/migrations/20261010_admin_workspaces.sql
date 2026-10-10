-- All workspaces page for super admins (2026-10-10). Run once in Supabase -> SQL Editor, after
-- 20261010_workspaces.sql. supabase/schema.sql includes the same changes for fresh installs.

-- Every workspace with its admins and how much is in it. Read-only, and refuses anyone who
-- isn't a super admin (who must also have passed two-factor when it's on).
create or replace function public.admin_list_workspaces()
returns table (
  id uuid,
  name text,
  color text,
  created_at timestamptz,
  created_by_name text,
  members bigint,
  admins bigint,
  admin_names text,
  projects bigint,
  archived_projects bigint,
  open_tasks bigint,
  pending_invites bigint,
  last_activity timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can list all workspaces';
  end if;
  return query
    select w.id, w.name, w.color, w.created_at, coalesce(c.full_name, c.email),
           (select count(*) from public.workspace_members m where m.workspace_id = w.id),
           (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.role = 'admin'),
           (select string_agg(coalesce(p.full_name, p.email), ', ' order by coalesce(p.full_name, p.email))
              from public.workspace_members m join public.profiles p on p.id = m.user_id
              where m.workspace_id = w.id and m.role = 'admin'),
           (select count(*) from public.projects pr where pr.workspace_id = w.id and pr.archived_at is null),
           (select count(*) from public.projects pr where pr.workspace_id = w.id and pr.archived_at is not null),
           (select count(*) from public.tasks t join public.projects pr on pr.id = t.project_id
              where pr.workspace_id = w.id and not t.completed),
           (select count(*) from public.workspace_invitations i where i.workspace_id = w.id),
           (select max(a.created_at) from public.task_activity a join public.projects pr on pr.id = a.project_id
              where pr.workspace_id = w.id)
    from public.workspaces w
    left join public.profiles c on c.id = w.created_by
    order by w.created_at desc;
end;
$$;

revoke execute on function public.admin_list_workspaces() from public, anon;
grant execute on function public.admin_list_workspaces() to authenticated;
