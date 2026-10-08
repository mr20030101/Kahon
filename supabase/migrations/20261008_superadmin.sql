-- Super admins (2026-10-08). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.
--
-- Grant someone with:   update public.profiles set is_superadmin = true where email = '...';
-- (Only from the SQL Editor: people can't change this column through the app, because
-- profile updates are limited to the columns granted in the profiles migration.)

alter table public.profiles add column if not exists is_superadmin boolean not null default false;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and coalesce((select is_superadmin from public.profiles where id = auth.uid()), false);
$$;

-- Every account, for the super admin's "All users" page. Refuses anyone else.
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  job_title text,
  department text,
  color text,
  avatar_path text,
  is_superadmin boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  mfa_enabled boolean,
  projects bigint,
  projects_owned bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can list all users';
  end if;
  return query
    select u.id, coalesce(p.email, u.email::text), p.full_name, p.job_title, p.department, p.color, p.avatar_path,
           coalesce(p.is_superadmin, false), u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
           (select count(*) from public.project_members m where m.user_id = u.id),
           (select count(*) from public.project_members m where m.user_id = u.id and m.role = 'owner')
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.is_superadmin() to authenticated;
