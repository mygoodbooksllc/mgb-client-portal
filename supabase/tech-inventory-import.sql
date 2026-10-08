-- One-time import of the old Apps Script sheet (2026-10-08). Safe to re-run:
-- assets/requests only insert when the table is empty. Matches people by name in public.staff.
delete from public.tech_setup;
insert into public.tech_setup (sort, item, essential, price, link) values
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
(13,'Wrist Rest Support',false,13,'https://www.amazon.com/dp/B0872TX516');

insert into public.tech_assets (created_at, staff_email, category, item, serial, condition, date_received, notes)
select v.ts::timestamptz, lower(s.email), v.cat, v.item, v.serial, v.cond, v.dr::date, v.notes
from (values
('2026-09-19 00:25','Gillian Gray','Laptop','Mac Neo',null,'New','2026-10-09',null),
('2026-09-20 19:45','Holden Gray','Laptop','Macbook Pro','K2DNWYXDV4','New','2026-10-12',null),
('2026-09-25 11:02','Debra Ruffin','Laptop','Lenovo ideapad 3','PF4EE9Q3','Good','2024-01-05',null),
('2026-09-25 11:03','Debra Ruffin','Desk','Desk',null,'New','2026-02-01',null),
('2026-09-25 11:04','Debra Ruffin','Desk Chair','Desk Chair',null,'New','2026-02-01',null),
('2026-09-25 12:13','Carmen Delacruz','Laptop','HP',null,'Good',null,null),
('2026-09-25 14:27','Nicole Hempel','Laptop','Lenovo- Intel Core',null,'Good','2024-01-01','Got this laptop when I started. Still working good for me, just a few times I have to restart it and then it works. Otherwise no issues.'),
('2026-09-25 14:28','Nicole Hempel','Standing Desk','Standing Desk',null,'New',null,'Don''t remember when I got the standing desk sometime end of 2025 or begining 2026. I love my standing desk.'),
('2026-09-25 14:30','Nicole Hempel','Monitor','Monitor',null,'Fair',null,'Don''t remember when I got this monitor. The monitor is very sensitive and will go black very easily. I am not sure if it is the cable or the monitor.'),
('2026-09-25 14:31','Nicole Hempel','Mount','Mount',null,'Good',null,'Got the monitor mount when I got the standing desk. No issues with the desk/monitor mount.'),
('2026-09-25 14:32','Nicole Hempel','Keyboard','Keyboard',null,'Good','2024-01-01','Got the keyboard when I started working. No issues with the keyboard.'),
('2026-09-25 14:33','Nicole Hempel','Mouse','Mouse',null,'Good','2024-01-01','Got the mouse when I started. No issues with it.'),
('2026-09-25 15:15','Nicole Hempel','USB Hub','USB Hub',null,'Good','2024-01-01','Got this when I started working. No issues at all.'),
('2026-09-29 19:24','Haley Dick','Laptop','Asus CX1700CK Chromebook','R8NXCV06T963329','Good','2023-12-15','Tends to run slow/laggy when multiple webpages are open or apps are running.'),
('2026-09-29 19:25','Haley Dick','Mouse','Mouse',null,'Good','2023-12-15',null),
('2026-09-29 19:26','Haley Dick','Keyboard','Keyboard',null,'Good','2023-12-15',null)
) v(ts,name,cat,item,serial,cond,dr,notes)
join lateral (select email from public.staff st where lower(st.name) = lower(v.name) or lower(st.name) like lower(v.name)||' %' order by st.active desc limit 1) s on true
where not exists (select 1 from public.tech_assets);

insert into public.tech_requests (created_at, staff_email, item, reason, priority, status)
select v.ts::timestamptz, lower(s.email), v.item, v.reason, v.pri, 'Open'
from (values
('2026-09-30 12:02','Holden Gray','Keyboard','My keyboard just died.','High'),
('2026-09-30 12:33','Jesse','Second Monitor','Make my life easier','Low')
) v(ts,name,item,reason,pri)
join lateral (select email from public.staff st where lower(st.name) = lower(v.name) or lower(st.name) like lower(v.name)||' %' order by st.active desc limit 1) s on true
where not exists (select 1 from public.tech_requests);

-- Check: anyone the name match missed shows up as fewer rows than 16 assets / 2 requests.
select (select count(*) from public.tech_assets) as assets, (select count(*) from public.tech_requests) as requests;
