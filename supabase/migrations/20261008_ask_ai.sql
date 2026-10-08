-- Ask AI (2026-10-08). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same table for fresh installs.

-- One row per Ask AI request, for the per-person daily limit and to see token spend.
-- Only the ask-ai Edge Function (service role) touches it: RLS on, no policies.
create table if not exists public.ai_requests (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  task_id        uuid references public.tasks (id) on delete set null,
  kind           text not null,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ai_requests_user on public.ai_requests (user_id, created_at desc);

alter table public.ai_requests enable row level security;
