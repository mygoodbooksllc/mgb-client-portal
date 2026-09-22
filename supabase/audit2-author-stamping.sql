-- Audit hardening, batch 3: stamp authorship server-side instead of
-- trusting the browser.
--
-- Background
-- ----------
-- Five tables carry a "who did this" column that the browser filled in on
-- every insert and could overwrite on every update:
--
--   client_private_notes.author_email / author_name
--   client_documents.added_by
--   access_request_links.created_by
--   client_notes.updated_by
--   client_status_overrides.set_by
--
-- Every one of those is a plain text column with no relationship to the
-- session. RLS decides *whether* a staffer may write the row, never *whose
-- name goes on it* — so any staffer could file a private note, a document
-- link, an access-request link, a client note or a red/yellow/green status
-- override under a colleague's name, and nothing in the schema or the audit
-- log would contradict it. These columns are read back as fact on the
-- bookkeeper-facing screens, so this is attribution forgery inside the tool
-- that exists to record who said what about a client.
--
-- staff_messages already solved this the right way
-- (staff_messages_set_author_from_staff, see staff-chat-v2.sql). This is the
-- same pattern generalized: one trigger function branching on TG_TABLE_NAME,
-- rather than five near-identical ones.
--
-- security definer + a pinned search_path, matching every other trigger
-- function in this project. EXECUTE is revoked at the bottom for the reason
-- spelled out in audit-hardening-function-grants.sql: a trigger function
-- runs as part of the firing statement and never consults the caller's
-- EXECUTE privilege, so the revoke removes reachable PostgREST surface
-- (/rest/v1/rpc/stamp_author_from_jwt) and changes nothing about how the
-- triggers behave.

create or replace function public.stamp_author_from_jwt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_name text;
begin
  case tg_table_name
    when 'client_private_notes' then
      -- author_name is a display label shown next to the note; look it up
      -- from `staff` rather than taking the browser's word for it. Falls
      -- back to the email so a note is never nameless.
      select s.name into v_name from staff s where s.email = v_email;
      new.author_email := v_email;
      new.author_name := coalesce(v_name, v_email);
    when 'client_documents' then
      new.added_by := v_email;
    when 'access_request_links' then
      new.created_by := v_email;
    when 'client_notes' then
      new.updated_by := v_email;
    when 'client_status_overrides' then
      new.set_by := v_email;
    when 'qbo_connect_state' then
      -- See audit2-qbo-state-hardening.sql, which adds the column and the
      -- trigger; the branch lives here so there is one stamping function.
      new.created_by := v_email;
    else
      null;
  end case;
  return new;
end;
$$;

drop trigger if exists stamp_author on client_private_notes;
create trigger stamp_author
  before insert or update on client_private_notes
  for each row execute function public.stamp_author_from_jwt();

drop trigger if exists stamp_author on client_documents;
create trigger stamp_author
  before insert or update on client_documents
  for each row execute function public.stamp_author_from_jwt();

drop trigger if exists stamp_author on access_request_links;
create trigger stamp_author
  before insert or update on access_request_links
  for each row execute function public.stamp_author_from_jwt();

drop trigger if exists stamp_author on client_notes;
create trigger stamp_author
  before insert or update on client_notes
  for each row execute function public.stamp_author_from_jwt();

drop trigger if exists stamp_author on client_status_overrides;
create trigger stamp_author
  before insert or update on client_status_overrides
  for each row execute function public.stamp_author_from_jwt();

revoke all on function public.stamp_author_from_jwt() from public, anon, authenticated;
