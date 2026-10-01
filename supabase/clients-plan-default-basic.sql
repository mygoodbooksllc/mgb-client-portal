-- Applied to production 2026-10-01 (migration clients_plan_default_basic).
-- Plus is off for now (owner decision 2026-09-30): new client rows default
-- to Basic instead of Plus ('standard').
alter table public.clients alter column plan set default 'basic';
