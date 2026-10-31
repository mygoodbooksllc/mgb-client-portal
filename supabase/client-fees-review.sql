-- Price check flags on client_fees (additive). A flagged fee shows a "check price"
-- pill on the Team profitability screens until an admin saves a new fee or taps
-- "Price checked". Applied 2026-10-28.
alter table public.client_fees add column if not exists needs_review boolean not null default false;
alter table public.client_fees add column if not exists review_note text;
