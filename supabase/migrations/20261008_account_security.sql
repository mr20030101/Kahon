-- Account security (2026-10-08): two-factor enforcement, email-change sync and leaving all
-- projects. Run once in Supabase -> SQL Editor. supabase/schema.sql includes the same changes.

-- ------------------------------------------------------------
-- Two-factor authentication: once someone has a verified authenticator, their session must
-- have passed it (aal2) before any project data is readable or writable. Every project
-- policy goes through these three helpers, so this one check covers them all.
-- ------------------------------------------------------------
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

create or replace function public.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.shares_project_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1
    from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ------------------------------------------------------------
-- Keep profiles.email in step with the sign-in email once a change is confirmed.
-- ------------------------------------------------------------
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();

-- ------------------------------------------------------------
-- RPC: leave every project. Refuses (and changes nothing) while you're the only owner of a
-- project, since that would leave it with no one able to manage it.
-- ------------------------------------------------------------
create or replace function public.leave_all_projects()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocked text;
  v_left integer;
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'Sign in to leave projects';
  end if;

  select string_agg(p.name, ', ' order by p.name) into v_blocked
  from public.project_members m
  join public.projects p on p.id = m.project_id
  where m.user_id = auth.uid() and m.role = 'owner'
    and not exists (
      select 1 from public.project_members o
      where o.project_id = m.project_id and o.role = 'owner' and o.user_id <> auth.uid()
    );
  if v_blocked is not null then
    raise exception 'You are the only owner of: %. Make someone else an owner or delete those projects first.', v_blocked;
  end if;

  delete from public.project_members where user_id = auth.uid();
  get diagnostics v_left = row_count;
  return v_left;
end;
$$;

grant execute on function public.leave_all_projects() to authenticated;
