-- Email notifications (2026-10-08). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.

-- Per-person opt-out, toggled from the bell in the sidebar.
alter table public.profiles add column if not exists email_notifications boolean not null default true;

-- What the notify Edge Function has sent, so repeat events within a few minutes
-- don't send repeat emails. Only the function (service role) touches it: RLS is on
-- and there are deliberately no policies.
create table if not exists public.email_log (
  id            bigint generated always as identity primary key,
  kind          text not null,
  ref_id        uuid not null,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  sent_at       timestamptz not null default now()
);

create index if not exists idx_email_log_lookup on public.email_log (kind, ref_id, recipient_id, sent_at desc);

alter table public.email_log enable row level security;
