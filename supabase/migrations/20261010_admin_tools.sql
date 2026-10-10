-- Super admin tools (2026-10-10): Errors, Ask AI usage, Emails sent, Security overview, and
-- resending a sign-up confirmation. Run once in Supabase -> SQL Editor, after
-- 20261010_admin_workspaces.sql. supabase/schema.sql includes the same changes for fresh installs.
--
-- Every function here refuses anyone who isn't a super admin (is_superadmin() also requires
-- two-factor when it's on). They report on accounts and activity, never on what's inside a
-- workspace's projects and tasks.

-- ------------------------------------------------------------
-- Audit log: every action a super admin takes. Written only by admin_log_action(), read only
-- through admin_security_overview(). RLS on with no policies, so the API can't touch it.
-- ------------------------------------------------------------
create table if not exists public.admin_audit (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null check (action in ('resend_confirmation')),
  target_user  uuid references public.profiles (id) on delete set null,
  target_email text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_admin_audit_created on public.admin_audit (created_at desc);

alter table public.admin_audit enable row level security;

-- Records an action before the app performs it. Only actions in the check above are allowed,
-- and the target must be a real, still-unconfirmed account for a confirmation resend.
create or replace function public.admin_log_action(p_action text, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can do that';
  end if;
  if p_action = 'resend_confirmation' then
    select u.email into v_email from auth.users u where u.id = p_user and u.email_confirmed_at is null;
    if v_email is null then
      raise exception 'That account is already confirmed, or no longer exists';
    end if;
  else
    raise exception 'Unknown action';
  end if;

  insert into public.admin_audit (actor_id, action, target_user, target_email)
  values (auth.uid(), p_action, p_user, v_email);
  return v_email;
end;
$$;

revoke execute on function public.admin_log_action(text, uuid) from public, anon;
grant execute on function public.admin_log_action(text, uuid) to authenticated;

-- ------------------------------------------------------------
-- Errors: browser errors from client_errors, grouped by message, newest first.
-- ------------------------------------------------------------
create or replace function public.admin_list_errors(p_days integer default 7)
returns table (
  message text,
  occurrences bigint,
  people bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  last_url text,
  last_version text,
  last_user text,
  sample_stack text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view errors';
  end if;
  return query
    select g.message, g.occurrences, g.people, g.first_seen, g.last_seen,
           l.url, l.app_version, coalesce(p.full_name, p.email), l.stack
    from (
      select e.message, count(*) as occurrences, count(distinct e.user_id) as people,
             min(e.created_at) as first_seen, max(e.created_at) as last_seen, max(e.id) as last_id
      from public.client_errors e
      where e.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
      group by e.message
    ) g
    join public.client_errors l on l.id = g.last_id
    left join public.profiles p on p.id = l.user_id
    order by g.last_seen desc
    limit 200;
end;
$$;

revoke execute on function public.admin_list_errors(integer) from public, anon;
grant execute on function public.admin_list_errors(integer) to authenticated;

-- ------------------------------------------------------------
-- Ask AI usage: requests and tokens per day, per person and per workspace.
-- ------------------------------------------------------------
create or replace function public.admin_ai_usage(p_days integer default 30)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view Ask AI usage';
  end if;
  return json_build_object(
    'daily', coalesce((
      select json_agg(d order by d.day) from (
        select r.created_at::date as day, count(*) as requests,
               coalesce(sum(r.input_tokens), 0) as input_tokens, coalesce(sum(r.output_tokens), 0) as output_tokens
        from public.ai_requests r where r.created_at >= v_since
        group by 1
      ) d), '[]'),
    'people', coalesce((
      select json_agg(x order by x.requests desc) from (
        select r.user_id, coalesce(p.full_name, p.email) as name, p.email, count(*) as requests,
               coalesce(sum(r.input_tokens), 0) as input_tokens, coalesce(sum(r.output_tokens), 0) as output_tokens,
               (select max(c) from (
                  select count(*) as c from public.ai_requests r2
                  where r2.user_id = r.user_id and r2.created_at >= v_since group by r2.created_at::date
               ) busiest) as busiest_day,
               max(r.created_at) as last_used
        from public.ai_requests r left join public.profiles p on p.id = r.user_id
        where r.created_at >= v_since
        group by r.user_id, p.full_name, p.email
        order by requests desc
        limit 100
      ) x), '[]'),
    'workspaces', coalesce((
      select json_agg(x order by x.requests desc) from (
        select w.id, w.name, w.color, count(*) as requests,
               coalesce(sum(r.input_tokens), 0) + coalesce(sum(r.output_tokens), 0) as tokens
        from public.ai_requests r
        join public.tasks t on t.id = r.task_id
        join public.projects pr on pr.id = t.project_id
        join public.workspaces w on w.id = pr.workspace_id
        where r.created_at >= v_since
        group by w.id, w.name, w.color
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_ai_usage(integer) from public, anon;
grant execute on function public.admin_ai_usage(integer) to authenticated;

-- ------------------------------------------------------------
-- Emails sent: totals by kind and day, and who sends the most invitations (logged against
-- the sender) — the early warning for spam now that anyone can sign up.
-- ------------------------------------------------------------
create or replace function public.admin_email_stats(p_days integer default 30)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view email activity';
  end if;
  return json_build_object(
    'kinds', coalesce((
      select json_agg(k order by k.sent desc) from (
        select l.kind, count(*) as sent, max(l.sent_at) as last_sent
        from public.email_log l where l.sent_at >= v_since group by l.kind
      ) k), '[]'),
    'daily', coalesce((
      select json_agg(d order by d.day) from (
        select l.sent_at::date as day, count(*) as sent
        from public.email_log l where l.sent_at >= v_since group by 1
      ) d), '[]'),
    'inviters', coalesce((
      select json_agg(x order by x.invites desc) from (
        select l.recipient_id as user_id, coalesce(p.full_name, p.email) as name, p.email, count(*) as invites,
               count(*) filter (where l.sent_at >= now() - interval '1 day') as last_day,
               max(l.sent_at) as last_sent
        from public.email_log l left join public.profiles p on p.id = l.recipient_id
        where l.kind = 'invited' and l.sent_at >= v_since
        group by l.recipient_id, p.full_name, p.email
        order by invites desc
        limit 50
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_email_stats(integer) from public, anon;
grant execute on function public.admin_email_stats(integer) to authenticated;

-- ------------------------------------------------------------
-- Security overview: accounts without two-factor, unconfirmed sign-ups, new accounts,
-- workspaces with no admin, super admins, and the latest super admin actions.
-- ------------------------------------------------------------
create or replace function public.admin_security_overview()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only a super admin can view the security overview';
  end if;
  return json_build_object(
    'accounts', (select count(*) from auth.users),
    'no_2fa', coalesce((
      select json_agg(x order by x.is_superadmin desc, x.created_at desc) from (
        select u.id, coalesce(p.full_name, u.email::text) as name, u.email, coalesce(p.is_superadmin, false) as is_superadmin,
               u.created_at, u.last_sign_in_at
        from auth.users u left join public.profiles p on p.id = u.id
        where u.email_confirmed_at is not null
          and not exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
      ) x), '[]'),
    'unconfirmed', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select u.id, coalesce(p.full_name, u.email::text) as name, u.email, u.created_at
        from auth.users u left join public.profiles p on p.id = u.id
        where u.email_confirmed_at is null
      ) x), '[]'),
    'new_accounts', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select u.id, coalesce(p.full_name, u.email::text) as name, u.email, u.created_at,
               u.email_confirmed_at is not null as confirmed,
               (select count(*) from public.workspace_members m where m.user_id = u.id) as workspaces
        from auth.users u left join public.profiles p on p.id = u.id
        where u.created_at >= now() - interval '7 days'
      ) x), '[]'),
    'workspaces_without_admin', coalesce((
      select json_agg(x order by x.name) from (
        select w.id, w.name, w.color,
               (select count(*) from public.workspace_members m where m.workspace_id = w.id) as members
        from public.workspaces w
        where not exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.role = 'admin')
      ) x), '[]'),
    'superadmins', coalesce((
      select json_agg(x order by x.name) from (
        select p.id, coalesce(p.full_name, p.email) as name, p.email,
               exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') as mfa_enabled
        from public.profiles p where p.is_superadmin
      ) x), '[]'),
    'audit', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select a.action, a.target_email, a.created_at, coalesce(p.full_name, p.email) as actor
        from public.admin_audit a left join public.profiles p on p.id = a.actor_id
        order by a.created_at desc limit 50
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_security_overview() from public, anon;
grant execute on function public.admin_security_overview() to authenticated;
