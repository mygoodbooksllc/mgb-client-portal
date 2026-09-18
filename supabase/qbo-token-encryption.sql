-- Applied live via Supabase MCP apply_migration (names: encrypt_qbo_tokens,
-- encrypt_qbo_tokens_v2). Required by Intuit's OAuth token management review
-- checklist: refresh tokens (and access tokens) must be AES-encrypted at
-- rest, not just access-restricted. pgcrypto lives in the `extensions`
-- schema on Supabase, not `public` — both functions set search_path to
-- include it explicitly.
create extension if not exists pgcrypto;

alter table qbo_tokens
  alter column access_token type bytea using extensions.pgp_sym_encrypt(access_token, 'placeholder-rotate-me')::bytea,
  alter column refresh_token type bytea using extensions.pgp_sym_encrypt(refresh_token, 'placeholder-rotate-me')::bytea;

-- security definer + revoked from anon/authenticated: only the Edge
-- Function's service_role key can ever call these, and the encryption key
-- itself is passed in per call from QBO_TOKEN_ENCRYPTION_KEY — it is never
-- stored in the database.
create or replace function qbo_store_tokens(
  p_client_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_key text
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into qbo_tokens (client_id, access_token, refresh_token, expires_at, updated_at)
  values (
    p_client_id,
    extensions.pgp_sym_encrypt(p_access_token, p_key)::bytea,
    extensions.pgp_sym_encrypt(p_refresh_token, p_key)::bytea,
    p_expires_at,
    now()
  )
  on conflict (client_id) do update set
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at = excluded.expires_at,
    updated_at = now();
$$;

create or replace function qbo_get_tokens(p_client_id text, p_key text)
returns table (access_token text, refresh_token text, expires_at timestamptz)
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.pgp_sym_decrypt(access_token, p_key), extensions.pgp_sym_decrypt(refresh_token, p_key), expires_at
  from qbo_tokens
  where client_id = p_client_id;
$$;

revoke all on function qbo_store_tokens from public, anon, authenticated;
revoke all on function qbo_get_tokens from public, anon, authenticated;
grant execute on function qbo_store_tokens to service_role;
grant execute on function qbo_get_tokens to service_role;
