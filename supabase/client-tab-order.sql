-- Org tab order on the server (README "Data and access gaps": the Finances
-- tab order lived only in each browser's localStorage, so it didn't carry
-- across devices or people).
-- NOT APPLIED until the owner runs it. Safe either way: until this column
-- exists, index.html sets window.TAB_ORDER_COL_OK = false and the app keeps
-- the old per-browser order exactly as before.
--
-- clients.tab_order is { "<section label>": ["<tab key>", ...] }, e.g.
-- { "Finances": ["giving", "bank", "budget", "receivables", "payroll"] }.
-- '{}' = none saved; the sidebar uses its default order (or, for a client
-- with nothing saved, the browser's old order). The app normalizes what it
-- reads (unknown labels and keys are dropped), so this check only keeps the
-- value small and the right shape.
--
-- Who writes it: admins only, through the existing "admins can update
-- clients" policy, from Manage access › Organization tabs (drag ⠿), the same
-- path as clients.hidden_tabs. Everyone who can read the client row reads it.
-- An admin's browser copies its old local order up once, only while the
-- server value is still '{}'.
--
-- Re-runnable. Roll back: alter table public.clients drop column tab_order;

alter table public.clients
  add column if not exists tab_order jsonb not null default '{}'::jsonb;

alter table public.clients drop constraint if exists clients_tab_order_shape;
alter table public.clients
  add constraint clients_tab_order_shape check (
    jsonb_typeof(tab_order) = 'object'
    and pg_column_size(tab_order) <= 4096
  );

comment on column public.clients.tab_order is
  'Org tab order per sidebar section, { section label: [tab keys] }. Set by admins in Manage access › Organization tabs; {} = default order.';
