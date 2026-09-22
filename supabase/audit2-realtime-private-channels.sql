-- Audit hardening, batch 3: lock down Supabase Realtime.
--
-- !! MANUAL STEP REQUIRED ALONGSIDE THIS FILE !!
-- These policies only take effect once the project dashboard toggle
--   Realtime > Settings > "Private channels only"
-- is flipped by hand. Until it is, public channels remain joinable by
-- anyone holding the publishable key regardless of what is written here.
-- The matching client-side change (config: { private: true } on all three
-- channels) is in app.jsx's StaffMessagesPage.
--
-- Background
-- ----------
-- The three Realtime channels the app opens — "staff-chat-<email>" (the
-- per-user inbox), "staff-presence" (who's online) and
-- "conv-typing-<conversation id>" (typing broadcasts) — were all public
-- topics. A public topic needs no authorization at all: anyone with the
-- publishable key, which ships in auth-config.js, could join any of them.
-- Topic names are guessable (a staff email; a conversation uuid leaked
-- anywhere), so that meant watching postgres_changes payloads for
-- staff_messages go by, enumerating the staff roster from presence, and
-- broadcasting forged "typing" events into any conversation.
--
-- Scope: staff-only, deliberately not per-conversation. realtime.topic()
-- would let us decode the conversation id out of "conv-typing-<uuid>" and
-- check is_conversation_member() on it, but that is string-parsing a topic
-- name into an authorization decision, and every current channel is staff
-- surface anyway. If client-tier users ever get Realtime, this needs the
-- per-topic check rather than a wider `using` clause.

drop policy if exists "staff read realtime" on realtime.messages;
create policy "staff read realtime"
  on realtime.messages for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists "staff write realtime" on realtime.messages;
create policy "staff write realtime"
  on realtime.messages for insert
  to authenticated
  with check (public.is_active_staff());
