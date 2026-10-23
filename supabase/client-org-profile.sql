-- Client organization profile + anniversary gifts (built hidden, preview flag).
-- Spec: docs/client-org-profile-spec.md (section 9 security resolutions are
-- binding). Self-test: supabase/client-org-profile-tests.sql (rolled back).
--
-- Applied to production 2026-10-23 (project xumsqmhccgfjnlmieqyu); save fix
-- (array_append, fiscal_year_end cap) re-applied the same day as
-- client_org_profile_save_fix. Self-test passed and rolled back.
--
-- What this adds (additive only; nothing is dropped or deleted):
--   client_org_profile   one row per client: the fields a full-access client
--                        fills in (card name, org type, established date, gift
--                        address, delivery contact, main contact, fiscal year
--                        end) plus the staff-set client_since date.
--   client_get_to_know   optional "get to know you" answers. WRITE-ONLY for
--                        clients: they are never returned to a client. Staff
--                        read them only as an admin, a permanently assigned
--                        staffer, the assigned bookkeeper or the account
--                        manager (never on a temporary access grant alone).
--   client_gifts         admin-only gift plan per anniversary; one gift per
--                        (client, occasion, year). A trigger stamps who
--                        planned and who marked it sent, and when.
--   RPCs                 client_org_profile_mine(), client_org_profile_save(p),
--                        staff_client_org_profile(p_client_id),
--                        staff_set_client_since(p_client_id, p_date),
--                        admin_upcoming_anniversaries(p_days),
--                        org_anniversaries_digest_count(p_today) (service_role).
--   tk__owner_only_key   now also protects 'org_profile_enabled'. No
--                        tk_settings row is written: a missing row means off.
--
-- No email, no notifications: nothing here sends anything, enqueues anything
-- (no tk__enqueue), or orders a gift. None of the three tables is added to a
-- realtime publication, and client_get_to_know has no row-change or activity
-- triggers. Audit records carry field names only, never values or answers.
--
-- The firm switch tk_settings.org_profile_enabled is read server-side only,
-- with coalesce(tk__jsonb_bool(...), false). Clients learn it through the
-- `enabled` key of client_org_profile_mine().
--
-- Get-to-know answer keys (each text, trimmed, 300 characters max, empty
-- dropped, unknown keys ignored):
--   favorite_treat, coffee_or_tea, allergies, hobbies, team_note
--
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.client_org_profile (
  client_id text primary key references public.clients(id) on delete cascade,
  card_name text check (card_name is null or char_length(card_name) <= 200),
  org_type text check (org_type is null or char_length(org_type) <= 120),
  established_date date check (established_date is null or established_date >= date '1800-01-01'),
  established_unknown boolean not null default false,
  gift_address text check (gift_address is null or char_length(gift_address) <= 500),
  gift_same_as_org boolean not null default false,
  receiver_name text check (receiver_name is null or char_length(receiver_name) <= 120),
  courier_phone text check (courier_phone is null or char_length(courier_phone) <= 40),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  fiscal_year_end text check (fiscal_year_end is null or fiscal_year_end ~ '^[0-9]{2}-[0-9]{2}$'),
  client_since date,
  client_since_set_by text,
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.client_get_to_know (
  client_id text primary key references public.clients(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb check (
    jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 4096
  ),
  submitted_by text,
  submitted_at timestamptz not null default now()
);

create table if not exists public.client_gifts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete restrict,
  occasion text not null check (occasion in ('client_since', 'established')),
  occasion_year int not null check (occasion_year between 1900 and 2200),
  occasion_date date not null,
  status text not null default 'planned' check (status in ('planned', 'sent', 'skipped')),
  item text check (item is null or char_length(item) <= 200),
  amount numeric(8,2) check (amount is null or (amount >= 0 and amount <= 500)),
  notes text check (notes is null or char_length(notes) <= 2000),
  planned_by text,
  sent_at timestamptz,
  sent_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_gifts_year_matches_date check (occasion_year = extract(year from occasion_date)::int),
  constraint client_gifts_one_per_occasion unique (client_id, occasion, occasion_year)
);
create index if not exists client_gifts_date_idx on public.client_gifts (occasion_date);

-- Stamps planned_by (insert, or a change back to planned), sent_by + sent_at
-- (on the change to sent; cleared if it moves off sent) and updated_at, all
-- from the JWT. created_at can't be rewritten.
create or replace function public.op__gifts_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(lower(auth.jwt() ->> 'email'), '');
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.planned_by := v_email;
    if new.status = 'sent' then
      new.sent_at := now();
      new.sent_by := v_email;
    else
      new.sent_at := null;
      new.sent_by := null;
    end if;
  else
    new.created_at := old.created_at;
    new.planned_by := case when new.status = 'planned' and old.status <> 'planned' then v_email
                           else old.planned_by end;
    if new.status = 'sent' and old.status <> 'sent' then
      new.sent_at := now();
      new.sent_by := v_email;
    elsif new.status = 'sent' then
      new.sent_at := old.sent_at;
      new.sent_by := old.sent_by;
    else
      new.sent_at := null;
      new.sent_by := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.op__gifts_stamp() from public, anon, authenticated;

drop trigger if exists client_gifts_stamp on public.client_gifts;
create trigger client_gifts_stamp
  before insert or update on public.client_gifts
  for each row execute function public.op__gifts_stamp();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Firm switch, server-side only. Internal.
create or replace function public.op__switch_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'org_profile_enabled')), false);
$$;
revoke all on function public.op__switch_on() from public, anon, authenticated;

-- Who may read get-to-know answers: active staff who can open the client AND
-- are an admin, permanently assigned (staff_client_access), the assigned
-- bookkeeper or the account manager. A temporary access grant alone is not
-- enough. Used by the RLS policy, so it is executable by authenticated; it
-- only answers a yes/no about the caller.
create or replace function public.op__can_read_gtk(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
     and public.can_access_client(p_client_id)
     and (
       public.is_active_staff_admin()
       or exists (
         select 1 from staff_client_access sca
         where lower(sca.staff_email) = lower(auth.jwt() ->> 'email')
           and sca.client_id = p_client_id
       )
       or exists (
         select 1 from clients c
         where c.id = p_client_id
           and lower(auth.jwt() ->> 'email') in (lower(c.assigned_bookkeeper_email), lower(c.account_manager_email))
       )
     );
$$;
revoke all on function public.op__can_read_gtk(text) from public, anon;
grant execute on function public.op__can_read_gtk(text) to authenticated;

-- Next occurrence of an anniversary on or after p_from, and how many years.
-- Uses base + make_interval(years => n) so Feb 29 lands on Feb 28 in other
-- years (never make_date). Internal.
create or replace function public.op__next_occurrence(p_base date, p_from date)
returns table (occ date, years int)
language plpgsql
immutable
set search_path = public
as $$
declare
  n int;
  d date;
begin
  if p_base is null or p_from is null then
    return;
  end if;
  n := extract(year from p_from)::int - extract(year from p_base)::int;
  d := (p_base + make_interval(years => n))::date;
  if d < p_from then
    n := n + 1;
    d := (p_base + make_interval(years => n))::date;
  end if;
  occ := d;
  years := n;
  return next;
end;
$$;
revoke all on function public.op__next_occurrence(date, date) from public, anon, authenticated;

-- Anniversaries in [p_from, p_from + p_days], real clients only (no test_only,
-- no is_internal). Effective client-since = coalesce(client_org_profile.
-- client_since, client_profile.launch_date). Gift matched on (client,
-- occasion, year of the occurrence). Presence flags only. Internal.
create or replace function public.op__anniversaries(p_from date, p_days int)
returns table (
  client_id text, client_name text, occasion text, occasion_date date, years int,
  profile_complete boolean, has_get_to_know boolean,
  gift_id uuid, gift_status text, gift_amount numeric, gift_item text
)
language sql
stable
security definer
set search_path = public
as $$
  with bases as (
    select c.id, c.name, 'client_since'::text as occ,
           coalesce(op.client_since, cp.launch_date) as base,
           op.completed_at is not null as complete
    from clients c
    left join client_org_profile op on op.client_id = c.id
    left join client_profile cp on cp.client_id = c.id
    where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)
    union all
    select c.id, c.name, 'established'::text,
           op.established_date,
           op.completed_at is not null
    from clients c
    join client_org_profile op on op.client_id = c.id
    where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)
      and not op.established_unknown
  )
  select b.id, b.name, b.occ, n.occ, n.years,
         b.complete,
         exists (select 1 from client_get_to_know k where k.client_id = b.id),
         g.id, g.status, g.amount, g.item
  from bases b
  cross join lateral public.op__next_occurrence(b.base, p_from) n
  left join client_gifts g
    on g.client_id = b.id and g.occasion = b.occ and g.occasion_year = extract(year from n.occ)::int
  where b.base is not null
    and n.years >= 1
    and n.occ <= p_from + p_days
  order by n.occ, b.name, b.occ;
$$;
revoke all on function public.op__anniversaries(date, int) from public, anon, authenticated;

-- Read one optional text key from a jsonb object. Null/missing -> null; a
-- non-string -> 22023; trimmed, empty -> null; over p_max -> 22023. Error
-- messages name the field and never echo the value. Internal.
create or replace function public.op__txt(p jsonb, p_key text, p_max int, p_label text default null)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v jsonb := p -> p_key;
  t text;
  lbl text := coalesce(p_label, p_key);
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception '% must be text', lbl using errcode = '22023';
  end if;
  t := nullif(btrim(v #>> '{}'), '');
  if t is not null and char_length(t) > p_max then
    raise exception '% is too long (max % characters)', lbl, p_max using errcode = '22023';
  end if;
  return t;
end;
$$;
revoke all on function public.op__txt(jsonb, text, int, text) from public, anon, authenticated;

create or replace function public.op__bool(p jsonb, p_key text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v jsonb := p -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return false;
  end if;
  if jsonb_typeof(v) <> 'boolean' then
    raise exception '% must be true or false', p_key using errcode = '22023';
  end if;
  return (v #>> '{}')::boolean;
end;
$$;
revoke all on function public.op__bool(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS + table grants (spec 9.1). No client policies; writes by RPC,
--    except client_gifts, which admins write directly.
-- ---------------------------------------------------------------------------
alter table public.client_org_profile enable row level security;
alter table public.client_get_to_know enable row level security;
alter table public.client_gifts enable row level security;

drop policy if exists "staff read org profile" on public.client_org_profile;
create policy "staff read org profile" on public.client_org_profile
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff read get to know" on public.client_get_to_know;
create policy "staff read get to know" on public.client_get_to_know
  for select to authenticated
  using (public.op__can_read_gtk(client_id));

drop policy if exists "admins manage client gifts" on public.client_gifts;
create policy "admins manage client gifts" on public.client_gifts
  for all to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

revoke all on public.client_org_profile from public, anon, authenticated;
revoke all on public.client_get_to_know from public, anon, authenticated;
revoke all on public.client_gifts from public, anon, authenticated;
grant select on public.client_org_profile to authenticated;
grant select on public.client_get_to_know to authenticated;
grant select, insert, update, delete on public.client_gifts to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Client RPCs
-- ---------------------------------------------------------------------------
-- The signed-in client's own profile. Full-access members only; anyone else
-- (no client_users row, inactive, scoped, or a staff JWT) gets
-- {eligible:false} and no data. Whitelisted fields only (spec 9.4).
create or replace function public.client_org_profile_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me client_users;
  c clients;
  op client_org_profile;
  v_fye text;
  v_has_gtk boolean;
begin
  if public.is_active_staff()
     or exists (select 1 from staff s where lower(s.email) = lower(auth.jwt() ->> 'email')) then
    return jsonb_build_object('eligible', false);
  end if;
  me := st_my_client_user();
  if me.email is null or coalesce(me.access, 'full') <> 'full' then
    return jsonb_build_object('eligible', false);
  end if;

  select * into c from clients where id = me.client_id;
  if c.id is null then
    return jsonb_build_object('eligible', false);
  end if;
  select * into op from client_org_profile where client_id = me.client_id;
  select cp.fiscal_year_end into v_fye from client_profile cp where cp.client_id = me.client_id;
  v_has_gtk := exists (select 1 from client_get_to_know k where k.client_id = me.client_id);

  return jsonb_build_object(
    'eligible', true,
    'enabled', public.op__switch_on(),
    'profile', case when op.client_id is null then null else jsonb_build_object(
      'card_name', op.card_name,
      'org_type', op.org_type,
      'established_date', op.established_date,
      'established_unknown', op.established_unknown,
      'gift_address', op.gift_address,
      'gift_same_as_org', op.gift_same_as_org,
      'receiver_name', op.receiver_name,
      'courier_phone', op.courier_phone,
      'contact_name', op.contact_name,
      'contact_email', op.contact_email,
      'contact_phone', op.contact_phone,
      'fiscal_year_end', op.fiscal_year_end,
      'completed_at', op.completed_at,
      'updated_at', op.updated_at
    ) end,
    'prefill', jsonb_build_object(
      'name', c.name,
      'entity_type', c.entity_type,
      'org_type', c.org_type,
      'org_address', c.org_address,
      'fiscal_year_end', v_fye,
      'user_name', me.name,
      'user_email', lower(me.email)
    ),
    'complete', op.completed_at is not null,
    'has_get_to_know', v_has_gtk
  );
end;
$$;
revoke all on function public.client_org_profile_mine() from public, anon;
grant execute on function public.client_org_profile_mine() to authenticated;

-- Save the caller's own profile (client_id always from st_my_client_user(),
-- never the payload). Reads known keys explicitly; unknown keys are ignored.
-- Partial saves are allowed; completed_at is set when every required field is
-- valid and cleared otherwise. Get-to-know is replaced only when supplied with
-- at least one non-empty answer. Never touches client_since. Returns mine().
create or replace function public.client_org_profile_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me client_users;
  v_old client_org_profile;
  v_card text; v_type text; v_est_txt text; v_est date; v_unknown boolean;
  v_same boolean; v_gift text; v_recv text; v_cphone text;
  v_cname text; v_cemail text; v_ctel text; v_fye text;
  v_gtk_in jsonb; v_gtk jsonb;
  v_complete boolean;
  v_completed_at timestamptz; v_completed_by text;
  v_changed text[] := '{}';
  v_phone_re text := '^[0-9+().\-\s x]+$';
begin
  if public.is_active_staff()
     or exists (select 1 from staff s where lower(s.email) = lower(auth.jwt() ->> 'email')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  me := st_my_client_user();
  if me.email is null or coalesce(me.access, 'full') <> 'full' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'payload must be an object' using errcode = '22023';
  end if;
  if octet_length(p::text) > 16384 then
    raise exception 'payload is too large' using errcode = '22023';
  end if;

  v_card   := public.op__txt(p, 'card_name', 200);
  v_type   := public.op__txt(p, 'org_type', 120);
  v_unknown := public.op__bool(p, 'established_unknown');
  v_est_txt := public.op__txt(p, 'established_date', 10);
  if v_est_txt is not null then
    if v_est_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'established_date must be a date (YYYY-MM-DD)' using errcode = '22023';
    end if;
    begin
      v_est := v_est_txt::date;
    exception when others then
      raise exception 'established_date must be a date (YYYY-MM-DD)' using errcode = '22023';
    end;
    if v_est < date '1800-01-01' or v_est > current_date then
      raise exception 'established_date must be between 1800-01-01 and today' using errcode = '22023';
    end if;
  end if;
  if v_unknown then
    v_est := null;
  end if;

  v_same := public.op__bool(p, 'gift_same_as_org');
  if v_same then
    select nullif(btrim(c.org_address), '') into v_gift from clients c where c.id = me.client_id;
    if v_gift is null then
      raise exception 'gift_address: the organization address is empty, so it cannot be copied' using errcode = '22023';
    end if;
    v_gift := left(v_gift, 500);
  else
    v_gift := public.op__txt(p, 'gift_address', 500);
  end if;

  v_recv   := public.op__txt(p, 'receiver_name', 120);
  v_cphone := public.op__txt(p, 'courier_phone', 40);
  if v_cphone is not null and v_cphone !~ v_phone_re then
    raise exception 'courier_phone has characters a phone number cannot have' using errcode = '22023';
  end if;
  v_cname  := public.op__txt(p, 'contact_name', 120);
  v_cemail := lower(public.op__txt(p, 'contact_email', 254));
  if v_cemail is not null and v_cemail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'contact_email is not a valid email address' using errcode = '22023';
  end if;
  v_ctel   := public.op__txt(p, 'contact_phone', 40);
  if v_ctel is not null and v_ctel !~ v_phone_re then
    raise exception 'contact_phone has characters a phone number cannot have' using errcode = '22023';
  end if;
  v_fye    := public.op__txt(p, 'fiscal_year_end', 10);
  if v_fye is not null then
    if v_fye !~ '^[0-9]{2}-[0-9]{2}$' then
      raise exception 'fiscal_year_end must be MM-DD' using errcode = '22023';
    end if;
    begin
      perform ('2024-' || v_fye)::date;   -- 2024 is a leap year: 02-29 ok, 02-30 not
    exception when others then
      raise exception 'fiscal_year_end must be a real month and day (MM-DD)' using errcode = '22023';
    end;
  end if;

  v_gtk_in := p -> 'get_to_know';
  if v_gtk_in is not null and jsonb_typeof(v_gtk_in) <> 'null' then
    if jsonb_typeof(v_gtk_in) <> 'object' then
      raise exception 'get_to_know must be an object' using errcode = '22023';
    end if;
    v_gtk := jsonb_strip_nulls(jsonb_build_object(
      'favorite_treat', public.op__txt(v_gtk_in, 'favorite_treat', 300, 'get_to_know.favorite_treat'),
      'coffee_or_tea',  public.op__txt(v_gtk_in, 'coffee_or_tea', 300, 'get_to_know.coffee_or_tea'),
      'allergies',      public.op__txt(v_gtk_in, 'allergies', 300, 'get_to_know.allergies'),
      'hobbies',        public.op__txt(v_gtk_in, 'hobbies', 300, 'get_to_know.hobbies'),
      'team_note',      public.op__txt(v_gtk_in, 'team_note', 300, 'get_to_know.team_note')
    ));
    if v_gtk = '{}'::jsonb then
      v_gtk := null;
    end if;
  end if;

  v_complete := v_card is not null and v_type is not null
    and (v_est is not null or v_unknown)
    and v_gift is not null and v_recv is not null and v_cphone is not null
    and v_cname is not null and (v_cemail is not null or v_ctel is not null)
    and v_fye is not null;

  select * into v_old from client_org_profile where client_id = me.client_id for update;
  v_completed_at := case when not v_complete then null else coalesce(v_old.completed_at, now()) end;
  v_completed_by := case when not v_complete then null
                         when v_old.completed_at is not null then v_old.completed_by
                         else lower(me.email) end;

  if v_old.card_name is distinct from v_card then v_changed := array_append(v_changed, 'card_name'); end if;
  if v_old.org_type is distinct from v_type then v_changed := array_append(v_changed, 'org_type'); end if;
  if v_old.established_date is distinct from v_est then v_changed := array_append(v_changed, 'established_date'); end if;
  if v_old.established_unknown is distinct from v_unknown then v_changed := array_append(v_changed, 'established_unknown'); end if;
  if v_old.gift_address is distinct from v_gift then v_changed := array_append(v_changed, 'gift_address'); end if;
  if v_old.gift_same_as_org is distinct from v_same then v_changed := array_append(v_changed, 'gift_same_as_org'); end if;
  if v_old.receiver_name is distinct from v_recv then v_changed := array_append(v_changed, 'receiver_name'); end if;
  if v_old.courier_phone is distinct from v_cphone then v_changed := array_append(v_changed, 'courier_phone'); end if;
  if v_old.contact_name is distinct from v_cname then v_changed := array_append(v_changed, 'contact_name'); end if;
  if v_old.contact_email is distinct from v_cemail then v_changed := array_append(v_changed, 'contact_email'); end if;
  if v_old.contact_phone is distinct from v_ctel then v_changed := array_append(v_changed, 'contact_phone'); end if;
  if v_old.fiscal_year_end is distinct from v_fye then v_changed := array_append(v_changed, 'fiscal_year_end'); end if;

  insert into client_org_profile (
    client_id, card_name, org_type, established_date, established_unknown,
    gift_address, gift_same_as_org, receiver_name, courier_phone,
    contact_name, contact_email, contact_phone, fiscal_year_end,
    completed_at, completed_by, updated_at, updated_by
  ) values (
    me.client_id, v_card, v_type, v_est, v_unknown,
    v_gift, v_same, v_recv, v_cphone,
    v_cname, v_cemail, v_ctel, v_fye,
    v_completed_at, v_completed_by, now(), lower(me.email)
  )
  on conflict (client_id) do update set
    card_name = excluded.card_name,
    org_type = excluded.org_type,
    established_date = excluded.established_date,
    established_unknown = excluded.established_unknown,
    gift_address = excluded.gift_address,
    gift_same_as_org = excluded.gift_same_as_org,
    receiver_name = excluded.receiver_name,
    courier_phone = excluded.courier_phone,
    contact_name = excluded.contact_name,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    fiscal_year_end = excluded.fiscal_year_end,
    completed_at = excluded.completed_at,
    completed_by = excluded.completed_by,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  if v_gtk is not null then
    insert into client_get_to_know (client_id, answers, submitted_by, submitted_at)
    values (me.client_id, v_gtk, lower(me.email), now())
    on conflict (client_id) do update set
      answers = excluded.answers,
      submitted_by = excluded.submitted_by,
      submitted_at = excluded.submitted_at;
  end if;

  perform audit_write('client.org_profile_updated', me.client_id, 'client', me.client_id,
    jsonb_build_object(
      'changed', to_jsonb(v_changed),
      'completed', v_complete,
      'gtk_replaced', v_gtk is not null
    ));

  return public.client_org_profile_mine();
end;
$$;
revoke all on function public.client_org_profile_save(jsonb) from public, anon;
grant execute on function public.client_org_profile_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Staff + admin RPCs
-- ---------------------------------------------------------------------------
-- The staff "Organization profile" card for one client. Active staff who can
-- open the client. Get-to-know answers only for op__can_read_gtk().
create or replace function public.staff_client_org_profile(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  op client_org_profile;
  v_launch date;
  v_fye text;
  k client_get_to_know;
  v_gtk_ok boolean;
begin
  if not (public.is_active_staff() and public.can_access_client(p_client_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  select * into op from client_org_profile where client_id = p_client_id;
  select cp.launch_date, cp.fiscal_year_end into v_launch, v_fye from client_profile cp where cp.client_id = p_client_id;
  select * into k from client_get_to_know where client_id = p_client_id;
  v_gtk_ok := public.op__can_read_gtk(p_client_id);

  return jsonb_build_object(
    'client_id', p_client_id,
    'profile', case when op.client_id is null then null else to_jsonb(op) - 'client_id' end,
    'complete', op.completed_at is not null,
    'client_since', coalesce(op.client_since, v_launch),
    'client_since_source', case when op.client_since is not null then 'staff'
                                when v_launch is not null then 'launch_date' end,
    'client_since_set_by', op.client_since_set_by,
    'launch_date', v_launch,
    'staff_fiscal_year_end', v_fye,
    'fiscal_year_mismatch', coalesce(op.fiscal_year_end is not null and nullif(btrim(v_fye), '') is not null
                                     and op.fiscal_year_end <> btrim(v_fye), false),
    'has_get_to_know', k.client_id is not null,
    'can_see_get_to_know', v_gtk_ok,
    'get_to_know', case when v_gtk_ok then k.answers end,
    'get_to_know_submitted_by', case when v_gtk_ok then k.submitted_by end,
    'get_to_know_submitted_at', case when v_gtk_ok then k.submitted_at end
  );
end;
$$;
revoke all on function public.staff_client_org_profile(text) from public, anon;
grant execute on function public.staff_client_org_profile(text) to authenticated;

-- Staff set (or, with null, reset to launch_date) the Client since date.
-- Upserts only client_since + client_since_set_by. Returns the staff card.
create or replace function public.staff_set_client_since(p_client_id text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date;
begin
  if not (public.is_active_staff() and public.can_access_client(p_client_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  if p_date is not null and (p_date < date '1900-01-01' or p_date > current_date) then
    raise exception 'client since must be between 1900-01-01 and today' using errcode = '22023';
  end if;

  select client_since into v_from from client_org_profile where client_id = p_client_id for update;

  insert into client_org_profile (client_id, client_since, client_since_set_by)
  values (p_client_id, p_date, case when p_date is null then null else lower(auth.jwt() ->> 'email') end)
  on conflict (client_id) do update set
    client_since = excluded.client_since,
    client_since_set_by = excluded.client_since_set_by;

  perform audit_write('client.since_set', p_client_id, 'client', p_client_id,
    jsonb_build_object('from', v_from, 'to', p_date));

  return public.staff_client_org_profile(p_client_id);
end;
$$;
revoke all on function public.staff_set_client_since(text, date) from public, anon;
grant execute on function public.staff_set_client_since(text, date) to authenticated;

-- Team › Client gifts list. Admin only. Days clamped to 1..366 (null -> 30).
create or replace function public.admin_upcoming_anniversaries(p_days int default 30)
returns table (
  client_id text, client_name text, occasion text, occasion_date date, years int,
  profile_complete boolean, has_get_to_know boolean,
  gift_id uuid, gift_status text, gift_amount numeric, gift_item text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select * from public.op__anniversaries(current_date, greatest(1, least(366, coalesce(p_days, 30))));
end;
$$;
revoke all on function public.admin_upcoming_anniversaries(int) from public, anon;
grant execute on function public.admin_upcoming_anniversaries(int) to authenticated;

-- Weekly digest: clients with an anniversary in the next 30 days. Null when
-- the firm switch is off (the digest then adds no line). service_role only.
create or replace function public.org_anniversaries_digest_count(p_today date)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.op__switch_on() then
    return null;
  end if;
  return (select count(distinct a.client_id)::int
          from public.op__anniversaries(coalesce(p_today, current_date), 30) a);
end;
$$;
revoke all on function public.org_anniversaries_digest_count(date) from public, anon, authenticated;
grant execute on function public.org_anniversaries_digest_count(date) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Owner-only switch: every live key kept (re-read with pg_get_functiondef
--    on 2026-10-23 just before applying) plus org_profile_enabled.
-- ---------------------------------------------------------------------------
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from',
                   'wb_enabled', 'desk_app_enabled', 'nav_enabled', 'lato_enabled',
                   'month_rhythm_enabled', 'slate_app_enabled',
                   'brand_enabled', 'hovernav_enabled',
                   'org_profile_enabled');
$$;

commit;

notify pgrst, 'reload schema';
