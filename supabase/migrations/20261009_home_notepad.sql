-- Home page notepad (2026-10-09). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same table for fresh installs.

-- One private note per person, shown on Home. Only its owner can read or change it.
create table if not exists public.user_notes (
  user_id     uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  body        text not null default '' check (char_length(body) <= 20000),
  updated_at  timestamptz not null default now()
);

alter table public.user_notes enable row level security;

drop policy if exists "user notes own" on public.user_notes;
create policy "user notes own" on public.user_notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
