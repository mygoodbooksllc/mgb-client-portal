-- =====================================================================
-- Asana import, 2026-10-16: the 61 client rows of the owner-approved roster
-- (docs/asana-import-proposed-roster.md). Run once by Claude through the
-- Supabase MCP (postgres role) on the owner's go, right before the Asana
-- apply. Recorded here as run; it is NOT a migration to re-run (it stops on
-- any existing id).
--
-- Same shape as Admin > Client orgs > Add org (app.jsx addOrg): id = slug of
-- the name, plan 'basic', no payroll add-on, account manager = the column
-- default (Jesse), test_only false, is_internal false. Bookkeeper = the
-- roster's Asana team bookkeeper; the 31 clients with no team bookkeeper
-- (No team yet, All Team, Illumination group) get NONE, the owner assigns
-- them in the app (Tasks > No team yet, tk_import_assign_team).
-- org_type ('Church' when the name says church, else 'Organization') and
-- entity_type (for_profit only for the four clearly commercial names) are
-- placeholders for the owner to correct on each client.
--
-- Triggers fired (checked 2026-10-16, none sends anything): audit_log
-- 'client.created'; clients_bookkeeper_* (display JSON + staff_client_access
-- for the bookkeeper); clients_account_manager_* (no access row: Jesse is an
-- admin); seed_document_folders (5 default folder rows). No client users,
-- contacts, invites, QBO connections or Drive folders are created.
--
-- QuickBooks: links QBO customers to these clients only by the same exact
-- name rule as qbo_firm_auto_match (which the qbo-firm-sync cron would run
-- within 10 minutes anyway), limited to the 61 new ids. Roster matches whose
-- QuickBooks name differs (first-word matches) stay for the owner to map in
-- Team > QuickBooks.
-- =====================================================================
begin;

do $$
begin
  if exists (select 1 from public.clients where id in ('99-network', 'ascension-of-anglican', 'ascent-church', 'believing-church', 'careerspring', 'christ-church-murrells-inlet', 'church-at-the-shores', 'cistern-church', 'city-church-lufkin', 'city-church-of-lancaster', 'city-house-church', 'citymark-church', 'collective-church', 'compassion-church', 'creative-academy', 'creative-church', 'crossings-community-church', 'doxa-church', 'dreamraise', 'e320-cadency', 'eternal-rock-church', 'fade', 'faith-family-church-baytown', 'fervent-church', 'fresh-start-network', 'gabriel-photography', 'glory-church', 'golden-city-church', 'good-land-church', 'grace-city-church', 'grace-reformed-baptist-church', 'happy-horizons-childrens-ranch', 'highpoint-church', 'hilltop-church', 'hosanna-la', 'hosanna-woodlands', 'illumination-health-home', 'life-church', 'life-on-mission-church-inc', 'life-west', 'lifot-faith', 'limitless-church', 'manna-church', 'manna-church-clarksville', 'manna-retreat-center', 'myrtle-beach-therapeutic-riding-vaulting-club', 'new-circle-church', 'p23-church', 'pathway-community-church', 'pink-parcels-llc', 'renaissance-church', 'space-city-church', 'tampa-design-company', 'the-plant-california-initiative', 'the-way', 'tree-city-church', 'unco-church', 'vida-church', 'vivid-church', 'voice-church-oc', 'zeal-church')) then
    raise exception 'roster client id already exists; stop';
  end if;
end $$;

insert into public.clients (id, name, org_type, entity_type, plan, payroll_add_on, test_only, is_internal, assigned_bookkeeper_email)
values
  ('99-network', '99 Network', 'Organization', 'nonprofit', 'basic', false, false, false, 'debra@mygoodbooks.org'),
  ('ascension-of-anglican', 'Ascension of Anglican', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('ascent-church', 'Ascent Church', 'Church', 'nonprofit', 'basic', false, false, false, 'sonya@mygoodbooks.org'),
  ('believing-church', 'Believing Church', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org'),
  ('careerspring', 'CareerSpring', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('christ-church-murrells-inlet', 'Christ Church Murrells Inlet', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('church-at-the-shores', 'Church at the Shores', 'Church', 'nonprofit', 'basic', false, false, false, 'debra@mygoodbooks.org'),
  ('cistern-church', 'Cistern Church', 'Church', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('city-church-lufkin', 'City Church Lufkin', 'Church', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('city-church-of-lancaster', 'CITY CHURCH OF LANCASTER', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('city-house-church', 'City House Church', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org'),
  ('citymark-church', 'Citymark Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('collective-church', 'Collective Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('compassion-church', 'Compassion Church', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org'),
  ('creative-academy', 'Creative Academy', 'Organization', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('creative-church', 'Creative Church', 'Church', 'nonprofit', 'basic', false, false, false, 'sonya@mygoodbooks.org'),
  ('crossings-community-church', 'Crossings Community Church', 'Church', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('doxa-church', 'Doxa Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('dreamraise', 'Dreamraise', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('e320-cadency', 'E320 (Cadency)', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('eternal-rock-church', 'Eternal Rock Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('fade', 'Fade', 'Organization', 'for_profit', 'basic', false, false, false, null),
  ('faith-family-church-baytown', 'Faith Family Church - Baytown', 'Church', 'nonprofit', 'basic', false, false, false, 'debra@mygoodbooks.org'),
  ('fervent-church', 'Fervent Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('fresh-start-network', 'Fresh Start Network', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('gabriel-photography', 'Gabriel Photography', 'Organization', 'for_profit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('glory-church', 'Glory Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('golden-city-church', 'Golden City Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('good-land-church', 'Good Land Church', 'Church', 'nonprofit', 'basic', false, false, false, 'sonya@mygoodbooks.org'),
  ('grace-city-church', 'Grace City Church', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org'),
  ('grace-reformed-baptist-church', 'Grace Reformed Baptist Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('happy-horizons-childrens-ranch', 'Happy Horizons Children''s Ranch', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('highpoint-church', 'Highpoint Church', 'Church', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('hilltop-church', 'Hilltop Church', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org'),
  ('hosanna-la', 'Hosanna LA', 'Church', 'nonprofit', 'basic', false, false, false, 'debra@mygoodbooks.org'),
  ('hosanna-woodlands', 'Hosanna Woodlands', 'Church', 'nonprofit', 'basic', false, false, false, 'debra@mygoodbooks.org'),
  ('illumination-health-home', 'Illumination Health + Home', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('life-church', 'Life Church', 'Church', 'nonprofit', 'basic', false, false, false, 'sonya@mygoodbooks.org'),
  ('life-on-mission-church-inc', 'Life on Mission Church, Inc.', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('life-west', 'Life West', 'Organization', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('lifot-faith', 'Lifot Faith', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('limitless-church', 'Limitless Church', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org'),
  ('manna-church', 'Manna Church', 'Church', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('manna-church-clarksville', 'Manna Church- Clarksville', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('manna-retreat-center', 'Manna Retreat Center', 'Organization', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('myrtle-beach-therapeutic-riding-vaulting-club', 'Myrtle Beach Therapeutic Riding + Vaulting Club', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('new-circle-church', 'New Circle Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('p23-church', 'P23 Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('pathway-community-church', 'Pathway Community Church', 'Church', 'nonprofit', 'basic', false, false, false, 'debra@mygoodbooks.org'),
  ('pink-parcels-llc', 'Pink Parcels LLC', 'Organization', 'for_profit', 'basic', false, false, false, null),
  ('renaissance-church', 'Renaissance Church', 'Church', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('space-city-church', 'Space City Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('tampa-design-company', 'Tampa Design Company', 'Organization', 'for_profit', 'basic', false, false, false, null),
  ('the-plant-california-initiative', 'The Plant California Initiative', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('the-way', 'The Way Bookkeeping', 'Organization', 'nonprofit', 'basic', false, false, false, null),
  ('tree-city-church', 'Tree City Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('unco-church', 'UNCO Church', 'Church', 'nonprofit', 'basic', false, false, false, null),
  ('vida-church', 'Vida Church', 'Church', 'nonprofit', 'basic', false, false, false, 'debra@mygoodbooks.org'),
  ('vivid-church', 'Vivid Church', 'Church', 'nonprofit', 'basic', false, false, false, 'nicole@mygoodbooks.org'),
  ('voice-church-oc', 'Voice Church OC', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org'),
  ('zeal-church', 'Zeal Church', 'Church', 'nonprofit', 'basic', false, false, false, 'gillian@mygoodbooks.org');

with names as (
  select lower(btrim(name)) nm, min(id) id, count(*) n
    from public.clients
   where coalesce(test_only, false) = false and name is not null
   group by lower(btrim(name))
)
update public.qbo_customer_client_map m
   set client_id = x.id, auto_matched = true, updated_at = now()
  from (
    select m2.realm_id, m2.qbo_customer_id, coalesce(a.id, b.id) as id
      from public.qbo_customer_client_map m2
      left join names a on a.n = 1 and a.nm = lower(btrim(m2.customer_name))
      left join names b on b.n = 1 and b.nm = lower(btrim(m2.company_name))
  ) x
 where m.realm_id = x.realm_id and m.qbo_customer_id = x.qbo_customer_id
   and x.id in ('99-network', 'ascension-of-anglican', 'ascent-church', 'believing-church', 'careerspring', 'christ-church-murrells-inlet', 'church-at-the-shores', 'cistern-church', 'city-church-lufkin', 'city-church-of-lancaster', 'city-house-church', 'citymark-church', 'collective-church', 'compassion-church', 'creative-academy', 'creative-church', 'crossings-community-church', 'doxa-church', 'dreamraise', 'e320-cadency', 'eternal-rock-church', 'fade', 'faith-family-church-baytown', 'fervent-church', 'fresh-start-network', 'gabriel-photography', 'glory-church', 'golden-city-church', 'good-land-church', 'grace-city-church', 'grace-reformed-baptist-church', 'happy-horizons-childrens-ranch', 'highpoint-church', 'hilltop-church', 'hosanna-la', 'hosanna-woodlands', 'illumination-health-home', 'life-church', 'life-on-mission-church-inc', 'life-west', 'lifot-faith', 'limitless-church', 'manna-church', 'manna-church-clarksville', 'manna-retreat-center', 'myrtle-beach-therapeutic-riding-vaulting-club', 'new-circle-church', 'p23-church', 'pathway-community-church', 'pink-parcels-llc', 'renaissance-church', 'space-city-church', 'tampa-design-company', 'the-plant-california-initiative', 'the-way', 'tree-city-church', 'unco-church', 'vida-church', 'vivid-church', 'voice-church-oc', 'zeal-church')
   and not m.manual and not m.ignored and m.client_id is null;

commit;
