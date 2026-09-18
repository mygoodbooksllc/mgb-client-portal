-- Applied live via Supabase MCP apply_migration (name: qbo_disconnect).
-- qbo_tokens has no RLS policies at all (only the Edge Function's
-- service_role key can touch it), so a staff-facing Disconnect button needs
-- a security-definer function to reach it. Authorization is checked inside
-- the function body (is_active_staff()) rather than relying on grants alone.
create or replace function qbo_disconnect(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_active_staff() then
    raise exception 'not authorized';
  end if;
  delete from qbo_tokens where client_id = p_client_id;
  update qbo_connections
  set status = 'disconnected', realm_id = null, connected_at = null, last_error = null, updated_at = now()
  where client_id = p_client_id;
end;
$$;

revoke all on function qbo_disconnect from public, anon;
grant execute on function qbo_disconnect to authenticated;
