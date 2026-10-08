-- One-time import of the old Apps Script sheet (2026-10-08). Safe to re-run:
-- the Standard Setup list is updated in place (no deletes; missing items added),
-- and each asset/request row is skipped if it's already there.
-- The portal's staff list is the source of truth (owner 2026-10-08): a row only
-- imports when its person is in public.staff (matched by email, or by name for
-- Carmen, whose portal email isn't known yet). Haley and Naomi have left, so
-- their rows aren't here. Once Carmen is added in Team › Members, run this
-- file again to bring in her laptop.
with v(sort, item, essential, price, link) as (values
  (1,'Mac Neo',true,689,'https://www.amazon.com/dp/B0GR6F79MT'),
  (2,'Standing Desk',true,99,'https://www.amazon.com/dp/B0B41YV2WD'),
  (3,'Desk',true,99,'https://www.amazon.com/dp/B07KXBL861'),
  (4,'Desk Chair',true,45,'https://www.amazon.com/dp/B00FS3VJAO'),
  (5,'Chair Mat',true,45,'https://www.amazon.com/dp/B07BZCYM9X'),
  (6,'Monitor',true,94,'https://www.amazon.com/clp/B0H5FG8TL2'),
  (7,'Mount',true,36,'https://www.amazon.com/dp/B072QZ2XZ3'),
  (8,'USB Hub',true,16,'https://www.amazon.com/clp/B0D1XLNWP2'),
  (9,'Keyboard',true,34,'https://www.amazon.com/dp/B07WJ5D3H4'),
  (10,'Mouse',true,8,'https://www.amazon.com/clp/B0GC67NBMH'),
  (11,'Desk Pad',false,9,'https://www.amazon.com/clp/B0C5H7QSXD'),
  (12,'Surge Protector',false,10,'https://www.amazon.com/dp/B0GVF12YHQ'),
  (13,'Wrist Rest Support',false,13,'https://www.amazon.com/dp/B0872TX516')
), upd as (
  update public.tech_setup t
  set sort = v.sort, essential = v.essential, price = v.price, link = v.link
  from v where lower(t.item) = lower(v.item)
  returning lower(t.item) as item
)
insert into public.tech_setup (sort, item, essential, price, link)
select v.sort, v.item, v.essential, v.price, v.link from v
where lower(v.item) not in (select item from upd)
  and not exists (select 1 from public.tech_setup t where lower(t.item) = lower(v.item));

insert into public.tech_assets (created_at, staff_email, category, item, serial, condition, date_received, notes)
select v.ts::timestamptz, st.email, v.cat, v.item, v.serial, v.cond, v.dr::date, v.notes
from (values
('2026-09-19 00:25','gillian@mygoodbooks.org','Laptop','Mac Neo',null,'New','2026-10-09',null),
('2026-09-20 19:45','holden@mygoodbooks.org','Laptop','Macbook Pro','K2DNWYXDV4','New','2026-10-12',null),
('2026-09-25 11:02','debra@mygoodbooks.org','Laptop','Lenovo ideapad 3','PF4EE9Q3','Good','2024-01-05',null),
('2026-09-25 11:03','debra@mygoodbooks.org','Desk','Desk',null,'New','2026-02-01',null),
('2026-09-25 11:04','debra@mygoodbooks.org','Desk Chair','Desk Chair',null,'New','2026-02-01',null),
('2026-09-25 12:13','carmen delacruz','Laptop','HP',null,'Good',null,null),
('2026-09-25 14:27','nicole@mygoodbooks.org','Laptop','Lenovo- Intel Core',null,'Good','2024-01-01','Got this laptop when I started. Still working good for me, just a few times I have to restart it and then it works. Otherwise no issues.'),
('2026-09-25 14:28','nicole@mygoodbooks.org','Standing Desk','Standing Desk',null,'New',null,'Don''t remember when I got the standing desk sometime end of 2025 or begining 2026. I love my standing desk.'),
('2026-09-25 14:30','nicole@mygoodbooks.org','Monitor','Monitor',null,'Fair',null,'Don''t remember when I got this monitor. The monitor is very sensitive and will go black very easily. I am not sure if it is the cable or the monitor.'),
('2026-09-25 14:31','nicole@mygoodbooks.org','Mount','Mount',null,'Good',null,'Got the monitor mount when I got the standing desk. No issues with the desk/monitor mount.'),
('2026-09-25 14:32','nicole@mygoodbooks.org','Keyboard','Keyboard',null,'Good','2024-01-01','Got the keyboard when I started working. No issues with the keyboard.'),
('2026-09-25 14:33','nicole@mygoodbooks.org','Mouse','Mouse',null,'Good','2024-01-01','Got the mouse when I started. No issues with it.'),
('2026-09-25 15:15','nicole@mygoodbooks.org','USB Hub','USB Hub',null,'Good','2024-01-01','Got this when I started working. No issues at all.')
) v(ts,email,cat,item,serial,cond,dr,notes)
join lateral (select lower(email) as email from public.staff where lower(email) = v.email or lower(name) = v.email limit 1) st on true
where not exists (select 1 from public.tech_assets a
  where lower(a.staff_email) = st.email and a.item = v.item and a.created_at = v.ts::timestamptz);

-- The request email trigger skips rows older than a day, so these don't send emails.
insert into public.tech_requests (created_at, staff_email, item, reason, priority, status)
select v.ts::timestamptz, st.email, v.item, v.reason, v.pri, 'Open'
from (values
('2026-09-30 12:02','holden@mygoodbooks.org','Keyboard','My keyboard just died.','High'),
('2026-09-30 12:33','jesse@mygoodbooks.org','Second Monitor','Make my life easier','Low')
) v(ts,email,item,reason,pri)
join lateral (select lower(email) as email from public.staff where lower(email) = v.email limit 1) st on true
where not exists (select 1 from public.tech_requests r
  where lower(r.staff_email) = st.email and r.item = v.item and r.created_at = v.ts::timestamptz);

-- Check: 13 setup items, 12 assets (13 once Carmen is a portal staff member), 2 requests.
select (select count(*) from public.tech_setup) as setup, (select count(*) from public.tech_assets) as assets, (select count(*) from public.tech_requests) as requests;
