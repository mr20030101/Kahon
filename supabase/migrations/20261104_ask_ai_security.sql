-- Ask AI security (2026-11-04). Run once in Supabase -> SQL Editor; supabase/schema.sql includes it.
--
-- ask-ai now hides passwords, keys, tokens, connection strings, database and server settings and
-- IP addresses from what the model sees and from its answers (supabase/functions/_shared/redact.ts).
-- Each request keeps the question (with those values hidden) and how many values were hidden, and
-- admin_ai_usage() lists the latest requests for super admins.

alter table public.ai_requests add column if not exists question text check (char_length(question) <= 2000);
alter table public.ai_requests add column if not exists hidden_count integer;

-- Questions are for super admins only: still RLS on with no policies, read through admin_ai_usage().
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
      ) x), '[]'),
    -- The latest requests, with the question as asked (secrets already hidden by ask-ai).
    'recent', coalesce((
      select json_agg(x order by x.created_at desc) from (
        select r.id, r.created_at, r.kind, r.question, r.hidden_count,
               coalesce(p.full_name, p.email) as name, p.email,
               t.id as task_id, t.title as task_title, pr.id as project_id, pr.name as project_name
        from public.ai_requests r
        left join public.profiles p on p.id = r.user_id
        left join public.tasks t on t.id = r.task_id
        left join public.projects pr on pr.id = t.project_id
        where r.created_at >= v_since
        order by r.created_at desc
        limit 200
      ) x), '[]')
  );
end;
$$;

revoke execute on function public.admin_ai_usage(integer) from public, anon;
grant execute on function public.admin_ai_usage(integer) to authenticated;
