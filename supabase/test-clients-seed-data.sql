-- Fake sample data for the two test clients (basic-test, grace-community), so
-- every feature can be tried before it reaches real clients. Both are
-- clients.test_only = true, which every digest, report, alert, usage stat and
-- performance score already skips. Idempotent: safe to re-run.
-- No real emails live in this file: the Pro Test contact is derived from the
-- existing Basic Test contact (same inbox, "+pro" address) so signing in works.

-- Pro Test contact (login) so the Pro client experience can be previewed.
insert into public.client_users (email, client_id, name, role, active, access)
select split_part(u.email, '@', 1) || '+pro@' || split_part(u.email, '@', 2),
       'grace-community', 'Pro (test client)', 'Contact', true, 'full'
from public.client_users u
where u.client_id = 'basic-test'
order by u.created_at limit 1
on conflict do nothing;

-- Monthly fees (fake).
insert into public.client_fees (client_id, monthly_fee) values
  ('basic-test', 150), ('grace-community', 450)
on conflict (client_id) do nothing;

-- Open document requests.
insert into public.client_doc_requests (client_id, title, details, due_date, status)
select v.client_id, v.title, v.details, current_date + 7, 'open'
from (values
  ('basic-test', 'September bank statement (sample)', 'Sample request for testing.'),
  ('grace-community', 'Signed engagement letter (sample)', 'Sample request for testing.')
) v(client_id, title, details)
where not exists (select 1 from public.client_doc_requests d
                  where d.client_id = v.client_id and d.title = v.title);

-- Month-end close in progress for September 2026 (never 'done', so no
-- reports-ready email can fire).
insert into public.month_close (client_id, period, status, notes) values
  ('basic-test', '2026-09-01', 'in_progress', 'Sample close for testing.'),
  ('grace-community', '2026-09-01', 'in_progress', 'Sample close for testing.')
on conflict (client_id, period_kind, period) do nothing;   -- period_kind defaults to 'month' (tasks-p2-2-periods.sql)

insert into public.client_close_items (client_id, period, item_key, done)
select c, '2026-09', k, true
from (values ('basic-test'), ('grace-community')) cl(c),
     (values ('bank_feed'), ('bank_rec')) it(k)
on conflict do nothing;

-- Pro only: next year's budget draft with a comment.
insert into public.client_budget_drafts (client_id, fiscal_year, status, lines, version)
select 'grace-community', 2027, 'draft',
  '[{"category":"Payroll","proposed":120000,"months":null,"owner_email":null},
    {"category":"Facilities","proposed":36000,"months":null,"owner_email":null},
    {"category":"Programs","proposed":24000,"months":null,"owner_email":null}]'::jsonb, 1
where not exists (select 1 from public.client_budget_drafts
                  where client_id = 'grace-community' and fiscal_year = 2027);

insert into public.client_budget_comments (client_id, fiscal_year, category, body, author_name)
select 'grace-community', 2027, 'Facilities', 'Sample comment: rent goes up 3% in March.', 'Sample staff'
where not exists (select 1 from public.client_budget_comments
                  where client_id = 'grace-community' and body like 'Sample comment:%');

-- GL review flags are not seeded: the Pro Test client's QuickBooks sandbox pull
-- produces real ones.
