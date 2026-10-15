-- Short task IDs and task search (2026-10-16). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.

-- ------------------------------------------------------------
-- Short task IDs like "866b1c2jx": 9 random lowercase letters and digits, unique across Kahon.
-- What people copy, paste and search for; the uuid stays the real key behind the scenes.
-- ------------------------------------------------------------
create or replace function public.gen_task_short_id()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_chars constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_bytes bytea;
  v_byte int;
  v_id text;
begin
  loop
    v_id := '';
    v_bytes := gen_random_bytes(32);
    for i in 0..31 loop
      v_byte := get_byte(v_bytes, i);
      -- 252 is the largest multiple of 36 under 256: skipping bytes above it keeps every
      -- character equally likely.
      if v_byte < 252 then
        v_id := v_id || substr(v_chars, (v_byte % 36) + 1, 1);
      end if;
      exit when char_length(v_id) = 9;
    end loop;
    -- At least one letter, so an ID never looks like a plain number.
    exit when char_length(v_id) = 9 and v_id ~ '[a-z]'
      and not exists (select 1 from public.tasks where short_id = v_id);
  end loop;
  return v_id;
end;
$$;

revoke execute on function public.gen_task_short_id() from public, anon, authenticated;

alter table public.tasks add column if not exists short_id text;

-- Fill in existing tasks without firing the task triggers (no "updated" notifications,
-- activity entries or updated_at changes for what isn't a real edit).
alter table public.tasks disable trigger user;
update public.tasks set short_id = public.gen_task_short_id() where short_id is null;
alter table public.tasks enable trigger user;

alter table public.tasks alter column short_id set not null;
alter table public.tasks drop constraint if exists tasks_short_id_check;
alter table public.tasks add constraint tasks_short_id_check check (short_id ~ '^[0-9a-z]{9}$');
-- text_pattern_ops so "starts with" searches use the index too.
create unique index if not exists idx_tasks_short_id on public.tasks (short_id text_pattern_ops);

-- Every new task gets one (whatever the app sent), and it never changes afterwards.
-- Security definer so it can call gen_task_short_id(), which the API can't.
create or replace function public.set_task_short_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.short_id := public.gen_task_short_id();
  else
    new.short_id := old.short_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_short_id on public.tasks;
create trigger tasks_short_id
  before insert or update of short_id on public.tasks
  for each row execute function public.set_task_short_id();

-- ------------------------------------------------------------
-- Search: tasks in one workspace whose title contains p_query, or whose short ID starts with
-- it (4+ characters, a leading # is ignored). Security invoker: RLS limits it to projects the
-- caller is in, the same as reading tasks directly.
-- ------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;
create index if not exists idx_tasks_title_trgm on public.tasks using gin (title extensions.gin_trgm_ops);

drop function if exists public.search_tasks(text, uuid);
create or replace function public.search_tasks(p_query text, p_workspace uuid)
returns table (
  id uuid,
  short_id text,
  title text,
  completed boolean,
  due_date date,
  parent_title text,
  project_id uuid,
  project_name text,
  project_color text,
  project_archived boolean,
  section_name text,
  id_match boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
  v_id_prefix text;
begin
  if char_length(v_q) < 2 or char_length(v_q) > 200 then
    return;
  end if;
  -- Typed text is matched literally: % and _ aren't wildcards.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if lower(ltrim(v_q, '#')) ~ '^[0-9a-z]{4,9}$' then
    v_id_prefix := lower(ltrim(v_q, '#')) || '%';
  end if;

  return query
    select t.id, t.short_id, t.title, t.completed, t.due_date, parent.title,
           p.id, p.name, p.color, p.archived_at is not null, s.name,
           coalesce(t.short_id like v_id_prefix, false)
    from public.tasks t
    join public.projects p on p.id = t.project_id
    left join public.sections s on s.id = t.section_id
    left join public.tasks parent on parent.id = t.parent_id
    where p.workspace_id = p_workspace
      and (t.title ilike v_like or t.short_id like v_id_prefix)
    order by coalesce(t.short_id like v_id_prefix, false) desc,
             t.completed, p.archived_at is not null, t.updated_at desc
    limit 30;
end;
$$;

revoke execute on function public.search_tasks(text, uuid) from public, anon;
grant execute on function public.search_tasks(text, uuid) to authenticated;
