-- staff-guide-fee-now.sql
--
-- Master Data sync reads "Bookkeeping fee now" (owner decision 2026-11-02). Matches the edits in
-- docs/staff-guide/profitability.md and docs/staff-guide/mgb-home.md. Targeted replace() only; each
-- update writes only when the live md5 still equals the md5 read on 2026-11-02, and raises otherwise.
-- body_plain is generated, never updated.
--
-- Applied to production 2026-11-02.
do $$
declare n int;
begin
  update public.staff_guide set body_md = replace(replace(body_md,
    $a$column **Bookkeeping fee 2027**). The portal only reads the sheet; it never writes to it.$a$,
    $b$column **Bookkeeping fee now**, today's fee). The portal only reads the sheet; it never writes to it. When fees change (for example in January), update **Bookkeeping fee now** in the sheet and the portal follows. The portal does not hold a 2027 fee; to see next year's prices next to today's, use **2027 fee change review** in MGB Home › Pricing & fees.$b$),
    $c$To read **Bookkeeping fee now** instead of 2027, ask the developer to switch the fee column; the nightly sync then waits for a new **Sync now**.$c$,
    $d$The column is set by the developer. If it is ever switched, the nightly sync waits for a new **Sync now** on the new column.$d$),
    updated_at = now()
  where slug = 'profitability' and md5(body_md) = 'ad6e0fe9d5a90e1532db7209f574e5a6';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'profitability changed since it was read (md5 mismatch)'; end if;
  if (select body_md like '%Bookkeeping fee 2027**)%' or body_md like '%instead of 2027, ask the developer%' from public.staff_guide where slug = 'profitability') then
    raise exception 'profitability: replace did not apply';
  end if;

  update public.staff_guide set body_md = replace(body_md,
    $a$from the MGB_Master_Data sheet (Clients tab). It is read only: it never changes a fee in the portal or the sheet.$a$,
    $b$from the MGB_Master_Data sheet (Clients tab). **Now** is the fee the portal uses (the Master Data sync reads that column); **2027** is the coming price, shown here only. It is read only: it never changes a fee in the portal or the sheet.$b$),
    updated_at = now()
  where slug = 'mgb-home' and md5(body_md) = '6ede8f4fd53403c6885f6914ba303692';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'mgb-home changed since it was read (md5 mismatch)'; end if;
  if (select body_md not like '%**Now** is the fee the portal uses%' from public.staff_guide where slug = 'mgb-home') then
    raise exception 'mgb-home: replace did not apply';
  end if;
end $$;
