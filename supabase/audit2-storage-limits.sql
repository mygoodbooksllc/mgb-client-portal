-- Audit hardening, batch 3: bound the staff chat attachment bucket.
--
-- The bucket was created private (audit finding C1) but with no
-- file_size_limit and no allowed_mime_types, so any signed-in staffer could
-- push a file of any size and any type into it — a storage-cost denial of
-- service, and a way to park executable or HTML content on the project's
-- storage origin and hand someone a signed URL to it.
--
-- 26214400 = 25 MiB. Mirrors MAX_ATTACHMENT_BYTES / ALLOWED_ATTACHMENT_TYPES
-- in app.jsx's StaffMessagesPage; both must be changed together. The
-- client-side check is only the friendly error message — this is the
-- enforcement, since the browser check is trivially bypassed.

update storage.buckets
set
  file_size_limit = 26214400,
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
where id = 'staff-chat-attachments';
