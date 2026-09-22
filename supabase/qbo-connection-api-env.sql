-- Which Intuit API environment this connection's tokens actually belong to.
-- The edge secret QBO_ENV is a single global default, but a connection made
-- under one set of Intuit keys keeps working against that environment — a
-- realm authorized in production returns 403 against the sandbox host and
-- vice versa. qbo-callback stamps this at connect time; qbo-sync probes and
-- backfills it for connections made before this column existed.
alter table qbo_connections
  add column if not exists api_env text check (api_env in ('sandbox','production'));
