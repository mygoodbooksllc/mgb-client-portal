-- Security audit finding L13: any active staffer could join any private
-- Realtime topic, including other people's inbox, reminder and chat channels.
-- Topics are now scoped to the person, or to conversation membership for
-- typing; "staff-presence" stays open to all active staff. The Tasks and
-- Workbench channels carry only postgres_changes, which table RLS filters.
-- Clients keep only their own client-msgs-<email> topic (unchanged policy).
--
-- Topics in use (app.jsx, components/): staff-chat-<email>, staff-presence,
-- conv-typing-<conversation id>, staff-reminders-<email>, client-notes-<email>,
-- client-sops-<email>, access-grants-<email>, si-inbox-<email>-<n>,
-- wb-<email>-<n>, tk-tasks-<tab>, tk-core-<tab>. A new private channel needs
-- a line here, or it silently fails to join.

create or replace function public.realtime_topic_allowed(p_topic text)
returns boolean
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_topic text := lower(coalesce(p_topic, ''));
  v_conv uuid;
begin
  if v_email is null or not public.is_active_staff() then
    return false;
  end if;
  if v_topic = 'staff-presence'
     or v_topic = 'staff-chat-' || v_email
     or v_topic = 'access-grants-' || v_email
     or v_topic = 'staff-reminders-' || v_email
     or v_topic = 'client-notes-' || v_email
     or v_topic = 'client-sops-' || v_email
     or starts_with(v_topic, 'si-inbox-' || v_email || '-')
     or starts_with(v_topic, 'wb-' || v_email || '-')
     or starts_with(v_topic, 'tk-tasks-')
     or starts_with(v_topic, 'tk-core-') then
    return true;
  end if;
  if starts_with(v_topic, 'conv-typing-') then
    begin
      v_conv := substr(v_topic, length('conv-typing-') + 1)::uuid;
    exception when others then
      return false;
    end;
    return public.is_conversation_member(v_conv);
  end if;
  return false;
end;
$$;
grant execute on function public.realtime_topic_allowed(text) to authenticated;

alter policy "staff read realtime" on realtime.messages
  using (public.realtime_topic_allowed(realtime.topic()));

alter policy "staff write realtime" on realtime.messages
  with check (public.realtime_topic_allowed(realtime.topic()));
