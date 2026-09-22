-- Audit hardening, batch 3: finish binding telemetry to the caller, and
-- bound the free text it carries.
--
-- Background
-- ----------
-- audit-hardening-telemetry-and-rpcs.sql (batch 2c) bound actor_email on
-- usage_events and feature_feedback to the JWT, which closed the "any
-- signed-in user can write rows attributed to any email" hole. Two things
-- it did not close:
--
--   actor_role was still whatever the browser sent. A client-tier user —
--   the lowest-privilege principal in the system — could still write their
--   own email with actor_role = 'staff', which is exactly the field the
--   admin-only Usage Stats page segments on.
--
--   client_id was still whatever the browser sent, so a user with access to
--   one org could attribute their activity (and their feedback text) to a
--   different org's rows on an admin's screen.
--
-- And the free-text columns had no length bound at all, so a single insert
-- could carry megabytes of attacker-chosen text straight onto an admin's
-- feedback screen. request_enterprise_upgrade already bounds its equivalent
-- field at 200; the 2000-char limits below are the same idea sized for a
-- multi-sentence answer rather than a name.
--
-- The role expression is derived, never trusted: is_active_staff() reads the
-- JWT email against the staff table, so 'staff' can only be written by
-- someone who actually is staff.

drop policy if exists "signed-in users can log their own usage" on usage_events;
create policy "signed-in users can log their own usage"
  on usage_events for insert
  with check (
    actor_email = auth.jwt() ->> 'email'
    and actor_role = case when public.is_active_staff() then 'staff' else 'client' end
    and (
      client_id is null
      or public.can_access_client(client_id)
      or exists (
        select 1 from client_users cu
        where cu.email = auth.jwt() ->> 'email'
          and cu.client_id = usage_events.client_id
          and cu.active
      )
    )
  );

drop policy if exists "signed-in users can submit feedback" on feature_feedback;
create policy "signed-in users can submit feedback"
  on feature_feedback for insert
  with check (
    actor_email = auth.jwt() ->> 'email'
    and actor_role = case when public.is_active_staff() then 'staff' else 'client' end
    and (
      client_id is null
      or public.can_access_client(client_id)
      or exists (
        select 1 from client_users cu
        where cu.email = auth.jwt() ->> 'email'
          and cu.client_id = feature_feedback.client_id
          and cu.active
      )
    )
  );

-- Length bounds. Named constraints, added only if absent, so this file is
-- re-runnable (`add constraint` has no `if not exists` form).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'feature_feedback_friction_text_len'
  ) then
    alter table feature_feedback
      add constraint feature_feedback_friction_text_len
      check (length(friction_text) <= 2000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'feature_feedback_comments_len'
  ) then
    alter table feature_feedback
      add constraint feature_feedback_comments_len
      check (length(comments) <= 2000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'feature_feedback_favorite_feature_len'
  ) then
    alter table feature_feedback
      add constraint feature_feedback_favorite_feature_len
      check (length(favorite_feature) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'usage_events_page_len'
  ) then
    alter table usage_events
      add constraint usage_events_page_len
      check (length(page) <= 100);
  end if;

  -- submit_access_request() already caps the people array at 50 entries, but
  -- an entry itself is unbounded jsonb — 50 objects with megabyte-long string
  -- values passes that check. 64 KB of JSON is far more than 50 names and
  -- email addresses ever need.
  if not exists (
    select 1 from pg_constraint where conname = 'access_requests_people_bytes'
  ) then
    alter table access_requests
      add constraint access_requests_people_bytes
      check (pg_column_size(people) < 65536);
  end if;
end
$$;
