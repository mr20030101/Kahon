-- Custom fields (2026-11-04). Run once in Supabase -> SQL Editor; supabase/schema.sql includes it.
--
-- A project can define its own fields for tasks, like "Task type", "Reporter" or "Site", and
-- every task in it can have a value for each. Editors and project admins define fields and set
-- values; every member sees them. Values are jsonb, shaped by the field's type:
--   select       "option-id"            (options: [{ "id", "name", "color" }])
--   multi_select ["option-id", ...]
--   person       "user-uuid"
--   text         "words"
--   number       12.5
--   date         "2026-11-04"
-- A task moved to another project loses its values (that project has its own fields).

create table if not exists public.project_fields (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  type        text not null check (type in ('select', 'multi_select', 'person', 'text', 'number', 'date')),
  options     jsonb not null default '[]' check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 50),
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists idx_project_fields_project on public.project_fields (project_id);

create table if not exists public.task_field_values (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  field_id    uuid not null references public.project_fields (id) on delete cascade,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (task_id, field_id)
);

create index if not exists idx_task_field_values_field on public.task_field_values (field_id);

-- A value belongs to a field of the task's own project, and has the field's shape.
create or replace function public.check_field_value()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_field public.project_fields;
  v_kind text := jsonb_typeof(new.value);
  v_fits boolean;
begin
  select * into v_field from public.project_fields where id = new.field_id;
  if v_field.project_id is distinct from (select project_id from public.tasks where id = new.task_id) then
    raise exception 'That field belongs to another project';
  end if;
  -- Worked out first: inside "if ... then", the first "then" (here, the case's) would end the condition.
  v_fits := case v_field.type
    when 'select' then v_kind = 'string'
    when 'multi_select' then v_kind = 'array' and jsonb_array_length(new.value) <= 50
    when 'person' then v_kind = 'string' and exists (
      select 1 from public.project_members m where m.project_id = v_field.project_id and m.user_id::text = new.value #>> '{}')
    when 'text' then v_kind = 'string' and char_length(new.value #>> '{}') <= 500
    when 'number' then v_kind = 'number'
    when 'date' then v_kind = 'string' and (new.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
    else false
  end;
  if not coalesce(v_fits, false) then
    raise exception 'That value doesn''t fit the "%" field', v_field.name;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists check_field_value on public.task_field_values;
create trigger check_field_value before insert or update on public.task_field_values
  for each row execute function public.check_field_value();

-- Moved to another project: that project has its own fields.
create or replace function public.clear_moved_field_values()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.task_field_values v using public.project_fields f
  where v.task_id = new.id and f.id = v.field_id and f.project_id <> new.project_id;
  return null;
end;
$$;

drop trigger if exists clear_moved_field_values on public.tasks;
create trigger clear_moved_field_values after update of project_id on public.tasks
  for each row when (new.project_id is distinct from old.project_id) execute function public.clear_moved_field_values();

alter table public.project_fields enable row level security;
alter table public.task_field_values enable row level security;

drop policy if exists "fields read" on public.project_fields;
create policy "fields read" on public.project_fields
  for select to authenticated using (public.is_member(project_id));
drop policy if exists "fields write" on public.project_fields;
create policy "fields write" on public.project_fields
  for all to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id));

drop policy if exists "field values read" on public.task_field_values;
create policy "field values read" on public.task_field_values
  for select to authenticated using (public.is_member(public.task_project(task_id)));
drop policy if exists "field values write" on public.task_field_values;
create policy "field values write" on public.task_field_values
  for all to authenticated
  using (public.can_edit(public.task_project(task_id))) with check (public.can_edit(public.task_project(task_id)));

alter table public.project_fields replica identity full;
alter table public.task_field_values replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.project_fields; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_field_values; exception when duplicate_object then null; end;
end;
$$;

-- Tell the API about the new tables now, rather than when it next refreshes.
notify pgrst, 'reload schema';
