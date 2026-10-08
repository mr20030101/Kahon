-- Allow documents, spreadsheets and presentations as task attachments (2026-10-08).
-- Run once in Supabase -> SQL Editor if your database already has task_attachments.
-- supabase/schema.sql includes the same changes for fresh installs.

-- Images, PDFs, docs, sheets and slides up to 25 MB. Keep in sync with FILE_TYPES
-- in src/components/Attachments.jsx and the bucket below.
alter table public.task_attachments drop constraint if exists task_attachments_mime_type_check;
alter table public.task_attachments add constraint task_attachments_mime_type_check check (mime_type in (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/rtf', 'text/plain', 'text/markdown',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'
  ));
alter table public.task_attachments drop constraint if exists task_attachments_size_bytes_check;
alter table public.task_attachments add constraint task_attachments_size_bytes_check check (size_bytes between 1 and 26214400);

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/rtf', 'text/plain', 'text/markdown',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'
  ]
where id = 'attachments';
