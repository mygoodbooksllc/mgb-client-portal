-- §171: server-side groundwork for per-person scoping of a client's own
-- financial data. APPLIED LIVE via Supabase MCP apply_migration
-- (`client_scope_view_and_helper`). Kept here so the repo records it.
--
-- Today, "Sarah only sees the Youth Ministry category" is enforced entirely
-- in the browser: resolveAccess() + scopeClientData() in app.jsx narrow the
-- client object before it's rendered. That's fine while every number on
-- screen comes from data.js's mock CLIENTS_MOCK_DATA — there is no server
-- to enforce anything against. It stops being fine the moment real ledger
-- rows land in Postgres (the qbo_* tables now being built), because a
-- scoped client contact with devtools open could then read every category
-- of their org's books straight from the API, exactly the way
-- audit-hardening-client-scoping.sql found bookkeepers could read every
-- client's notes.
--
-- So: no financial table is touched here (deliberately — the qbo_* tables
-- are another agent's work in flight). This only puts the two pieces the
-- future policies need in place, so adding them later is a one-line change
-- per table rather than a schema design.
--
-- ============================================================================
-- HOW TO USE THIS WHEN THE REAL TABLES LAND
-- ============================================================================
-- Every new client-readable financial table (qbo_accounts, qbo_transactions,
-- qbo_report_rows, ... and anything that replaces data.js's budget/
-- bankAccounts/contributions) should get a CLIENT-TIER select policy shaped
-- like this:
--
--   create policy "client reads own scoped rows" on <table> for select
--     using (
--       exists (
--         select 1 from client_users cu
--         where cu.email = auth.jwt() ->> 'email'
--           and cu.client_id = <table>.client_id
--           and cu.active
--       )
--       and public.client_can_see_category(<table>.client_id, <table>.account_name)
--     );
--
-- ...where <account_name> is whatever column on that table carries the
-- category/ministry-area dimension the app scopes on (the same strings as
-- client.budget[].category today). A full-access contact passes the helper
-- unconditionally, so the clause is a no-op for them.
--
-- The STAFF policy on those tables stays can_access_client(client_id) and
-- must NOT get this clause — staff scoping is by client assignment, never
-- by category.
--
-- Funds (client.funds[].name) scope the same way; add a
-- client_can_see_fund() sibling when a real fund-dimensioned table exists.
-- There isn't one yet, so it isn't guessed at here.
-- ============================================================================

-- SECURITY INVOKER (the default for a view in PG15+; spelled out because
-- this one's correctness depends on it) — the view is just a convenience
-- wrapper over client_users, whose own "client reads own row" policy
-- (client-auth-phase2.sql) is what limits it to the caller. A SECURITY
-- DEFINER view here would hand every caller every contact's scope.
drop view if exists public.my_client_scope;
create view public.my_client_scope
with (security_invoker = true)
as
  select cu.client_id,
         cu.access,
         cu.tabs,
         cu.categories,
         cu.funds
  from client_users cu
  where cu.email = auth.jwt() ->> 'email'
    and cu.active;

grant select on public.my_client_scope to authenticated;

-- True when the signed-in client contact may see p_category for p_client_id.
-- SECURITY INVOKER (not DEFINER) on purpose: it reads client_users through
-- the caller's own RLS, which already exposes exactly their own row, so
-- there's nothing to elevate. STABLE so the planner can call it once per
-- row-group rather than per row.
--
-- Fails CLOSED for anyone with no active client_users row for that client
-- (an unknown email, a deactivated contact, or a staff session — staff read
-- these tables through their own can_access_client() policy, not this one).
create or replace function public.client_can_see_category(p_client_id text, p_category text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from client_users cu
    where cu.email = auth.jwt() ->> 'email'
      and cu.client_id = p_client_id
      and cu.active
      and (
        cu.access = 'full'
        or cu.categories is null
        or p_category = any (cu.categories)
      )
  );
$$;

grant execute on function public.client_can_see_category(text, text) to authenticated;
