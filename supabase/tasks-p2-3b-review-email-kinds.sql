-- =====================================================================
-- Tasks Phase 2, slice S3b: allow the task email kinds in the outbox and
-- the email log (critique M11).
--
-- ORDER: deploy the notification-emails edge function that knows these
-- kinds FIRST, then run this file. Until then tk__enqueue (tasks-p2-3-
-- review.sql) skips the new kinds quietly, so nothing piles up unread.
--
-- Safe to re-run. Each CHECK is restated in full; the same lists live in
-- notification-emails.sql, client-emails.sql, tech-inventory-v2.sql,
-- staff-handbook.sql and gl-review-1-core.sql (kept in step).
-- client_request / client_request_nudge are listed now for S5.
-- =====================================================================

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'staff_client_message', 'staff_doc_upload', 'staff_task_assigned', 'staff_feedback_status',
  'client_message', 'client_reports_ready', 'staff_tech_request',
  'handbook_sign_needed', 'handbook_countersign_needed',
  'staff_task_review_ready', 'staff_task_sent_back', 'staff_task_mention',
  'staff_task_client_answered', 'staff_task_batch'
));

alter table public.client_email_log drop constraint if exists client_email_log_feature_check;
alter table public.client_email_log add constraint client_email_log_feature_check check (feature in (
  'doc_chaser', 'value_report', 'staff_client_message', 'staff_doc_upload', 'staff_task_assigned',
  'staff_task_due', 'staff_feedback_status', 'client_message', 'client_reports_ready',
  'staff_tech_request', 'handbook_sign_needed', 'handbook_countersign_needed',
  'gl_review_question', 'gl_review_summary',
  'staff_task_review_ready', 'staff_task_sent_back', 'staff_task_mention',
  'staff_task_client_answered', 'staff_task_batch',
  'client_request', 'client_request_nudge'
));
