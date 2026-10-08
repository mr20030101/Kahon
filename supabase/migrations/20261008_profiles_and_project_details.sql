-- Profiles, avatars and project details (2026-10-08). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.

-- ------------------------------------------------------------
-- Profile fields
-- ------------------------------------------------------------
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists job_title   text;
alter table public.profiles add column if not exists department  text;
alter table public.profiles add column if not exists bio         text;
alter table public.profiles add column if not exists location    text;
alter table public.profiles add column if not exists timezone    text;

alter table public.profiles drop constraint if exists profiles_details_check;
alter table public.profiles add constraint profiles_details_check check (
  char_length(coalesce(full_name, '')) <= 120
  and char_length(coalesce(job_title, '')) <= 100
  and char_length(coalesce(department, '')) <= 100
  and char_length(coalesce(bio, '')) <= 1000
  and char_length(coalesce(location, '')) <= 100
  and char_length(coalesce(timezone, '')) <= 64
  and color ~ '^#[0-9A-Fa-f]{6}$'
  -- Avatars live in the avatars bucket under the owner's own folder.
  and (avatar_path is null or avatar_path like id::text || '/%')
);

-- People may edit these columns of their own profile, and nothing else. In particular not
-- email: add_member_by_email finds people by it, so a changeable email would let someone
-- take a teammate's place when an owner adds them.
revoke update on public.profiles from authenticated;
grant update (full_name, color, avatar_path, job_title, department, bio, location, timezone, email_notifications)
  on public.profiles to authenticated;

-- A wider palette for new accounts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, color)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    (array['#2E6F73','#B4532A','#5B4BB7','#2F7D32','#C2185B','#1565C0',
           '#8D6E00','#6D4C41','#00838F','#7B1FA2','#D84315','#455A64'])[1 + floor(random() * 12)::int]
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Give everyone a fresh color, spread across the palette so (up to 12 people) nobody shares one.
with shuffled as (
  select id, row_number() over (order by random()) as n from public.profiles
)
update public.profiles p
set color = (array['#2E6F73','#B4532A','#5B4BB7','#2F7D32','#C2185B','#1565C0',
                   '#8D6E00','#6D4C41','#00838F','#7B1FA2','#D84315','#455A64'])[1 + ((s.n - 1) % 12)::int]
from shuffled s
where s.id = p.id;

-- ------------------------------------------------------------
-- Avatars: public bucket (avatars are shown to teammates and in emails), one folder per
-- person, and only you can write to your folder.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading your own folder is needed to replace or remove a photo; everyone else sees
-- avatars through the bucket's public URLs.
drop policy if exists "avatars read own" on storage.objects;
create policy "avatars read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- Project details
-- ------------------------------------------------------------
alter table public.projects add column if not exists description text not null default '';
alter table public.projects add column if not exists status      text not null default 'on_track';
alter table public.projects add column if not exists start_date  date;
alter table public.projects add column if not exists due_date    date;
alter table public.projects add column if not exists links       jsonb not null default '[]'::jsonb;

alter table public.projects drop constraint if exists projects_details_check;
alter table public.projects add constraint projects_details_check check (
  char_length(description) <= 5000
  and status in ('on_track', 'at_risk', 'off_track', 'on_hold', 'complete')
  and (start_date is null or due_date is null or due_date >= start_date)
  and jsonb_typeof(links) = 'array'
  and jsonb_array_length(links) <= 20
  -- Each link is {label, url} with a web URL, so nothing like javascript: can be stored.
  and not jsonb_path_exists(links, '$[*] ? (!(@.url like_regex "^https?://"))')
);
