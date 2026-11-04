-- Files on comments (2026-11-04). Run once in Supabase -> SQL Editor.
-- supabase/schema.sql includes the same changes for fresh installs.
--
-- An image (or any allowed file) pasted, dropped or picked in the comment box belongs to that
-- comment, not to the task's Attachments. They're task_attachments rows with a comment_id, so
-- moving a task, auto delete, Google Drive and Ask AI treat them like any other attachment, and
-- they go when their comment does. Commenters may add files, but only to their own comments.
-- In Supabase Storage they're kept at <project_id>/<task_id>/comments/<file>.

-- A comment can be just an image, so its text may be empty (the app needs text or a file).
alter table public.comments drop constraint if exists comments_body_check;
alter table public.comments add constraint comments_body_check check (char_length(body) <= 5000);

alter table public.task_attachments add column if not exists comment_id uuid references public.comments (id) on delete cascade;
create index if not exists idx_attachments_comment on public.task_attachments (comment_id) where comment_id is not null;

-- Which comment a Drive upload is for, so api/files.js adds the row to it.
alter table public.drive_uploads add column if not exists comment_id uuid references public.comments (id) on delete cascade;

-- Is p_comment the caller's own comment on p_task, in a project where they may comment?
create or replace function public.can_attach_to_comment(p_comment uuid, p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comments c join public.tasks t on t.id = c.task_id
    where c.id = p_comment and c.task_id = p_task and c.author_id = auth.uid() and public.can_comment(t.project_id)
  );
$$;

revoke execute on function public.can_attach_to_comment(uuid, uuid) from public, anon;
grant execute on function public.can_attach_to_comment(uuid, uuid) to authenticated;

drop policy if exists "attachments insert" on public.task_attachments;
create policy "attachments insert" on public.task_attachments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and project_id = (select t.project_id from public.tasks t where t.id = task_id)
    and path like project_id::text || '/' || task_id::text || '/%'
    and case when comment_id is null then public.can_edit(project_id)
             else public.can_attach_to_comment(comment_id, task_id) end
  );

drop policy if exists "attachments delete" on public.task_attachments;
create policy "attachments delete" on public.task_attachments
  for delete to authenticated
  using (
    (created_by = auth.uid() and (public.can_edit(project_id) or (comment_id is not null and public.can_comment(project_id))))
    or public.is_owner(project_id)
  );

-- Commenters may store files only in a task's comments folder, and remove only their own.
drop policy if exists "attachments objects insert" on storage.objects;
create policy "attachments objects insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments' and (
      public.can_edit(public.path_project(name))
      or ((storage.foldername(name))[3] = 'comments' and public.can_comment(public.path_project(name)))
    )
  );

drop policy if exists "attachments objects delete" on storage.objects;
create policy "attachments objects delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments' and (
      public.can_edit(public.path_project(name))
      or ((storage.foldername(name))[3] = 'comments' and owner_id = auth.uid()::text
          and public.can_comment(public.path_project(name)))
    )
  );
