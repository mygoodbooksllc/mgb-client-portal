-- Staff training guide ("Help", #/help) — owner request 2026-09-30.
--
-- Applied to production 2026-09-30 as migration staff_guide.
-- Safe to re-run. Depends on is_active_staff() / is_active_staff_admin()
-- (staff-schema.sql / staff-admin-policies.sql).
--
-- Why a table and not a static file: Vercel serves the app folder as-is, so a
-- markdown or JSON file next to index.html (or text embedded in a .jsx file)
-- would be a public URL. The source of truth is markdown in
-- docs/staff-guide/*.md (kept out of the deploy by .vercelignore); the sync
-- script docs/staff-guide/sync.mjs turns it into an idempotent upsert that is
-- run in the SQL editor or through the Supabase MCP.
--
-- staff_guide           one row per article.
--   RLS: active staff read audience='staff'; active admins read
--   audience='admin' too. No client or anon access. No insert/update/delete
--   grants or policies: only the SQL editor / MCP (postgres role) writes.
-- search_staff_guide(q) full-text search (websearch_to_tsquery, ts_rank,
--   ts_headline snippets) with an ILIKE fallback for short/partial words.
--   SECURITY INVOKER, so the same RLS audience rules apply.
--   Snippet highlights are wrapped in ⟦ ⟧ (the UI turns them into <mark>).

-- Immutable join so keywords (text[]) can feed a generated column
-- (array_to_string itself is only STABLE).
create or replace function public.staff_guide_kw_text(kw text[])
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$ select coalesce(array_to_string(kw, ' '), '') $$;

create table if not exists public.staff_guide (
  slug        text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title       text not null,
  section     text not null,
  audience    text not null default 'staff' check (audience in ('staff', 'admin')),
  body_md     text not null default '',
  keywords    text[] not null default '{}',
  sort        integer not null default 0,
  updated_at  timestamptz not null default now(),
  -- Markdown with link targets and syntax characters removed, for snippets.
  body_plain  text generated always as (
    regexp_replace(
      regexp_replace(body_md, '\]\([^)]*\)', ']', 'g'),
      '[#*_`>|\[\]]+', ' ', 'g')
  ) stored,
  search_tsv  tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, public.staff_guide_kw_text(keywords)), 'B') ||
    setweight(to_tsvector('english'::regconfig,
      regexp_replace(
        regexp_replace(coalesce(body_md, ''), '\]\([^)]*\)', ']', 'g'),
        '[#*_`>|\[\]]+', ' ', 'g')), 'C')
  ) stored
);

create index if not exists staff_guide_search_idx on public.staff_guide using gin (search_tsv);
create index if not exists staff_guide_section_sort_idx on public.staff_guide (section, sort);

alter table public.staff_guide enable row level security;

revoke all on public.staff_guide from anon, authenticated;
grant select on public.staff_guide to authenticated;

drop policy if exists staff_guide_read_staff on public.staff_guide;
create policy staff_guide_read_staff on public.staff_guide
  for select to authenticated
  using (audience = 'staff' and public.is_active_staff());

drop policy if exists staff_guide_read_admin on public.staff_guide;
create policy staff_guide_read_admin on public.staff_guide
  for select to authenticated
  using (audience = 'admin' and public.is_active_staff_admin());

-- Search. Full-text first (title A > keywords B > body C); rows that only
-- match by substring (a short or half-typed word such as "qb" or "onboa")
-- come after, ranked by where the text was found.
create or replace function public.search_staff_guide(q text)
returns table (
  slug      text,
  title     text,
  section   text,
  audience  text,
  snippet   text,
  rank      real
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with input as (
    select btrim(coalesce(q, '')) as raw,
           websearch_to_tsquery('english'::regconfig, btrim(coalesce(q, ''))) as tsq
  ),
  terms as (
    -- Each word, with LIKE wildcards escaped, for the substring fallback.
    select array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%') as pats,
           (array_agg(w order by length(w) desc))[1] as longest
    from input,
         regexp_split_to_table(lower(raw), '[^[:alnum:]]+') as w
    where w <> ''
  ),
  fts as (
    select g.slug, g.title, g.section, g.audience, g.sort,
           ts_headline('english'::regconfig, g.body_plain, i.tsq,
             'StartSel=⟦, StopSel=⟧, MaxWords=26, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "') as snippet,
           ts_rank(g.search_tsv, i.tsq) + 1.0 as rank
    from staff_guide g, input i
    where length(i.raw) >= 2
      and numnode(i.tsq) > 0
      and g.search_tsv @@ i.tsq
  ),
  fallback as (
    select g.slug, g.title, g.section, g.audience, g.sort,
           (case
              when p.pos > 0 then
                (case when p.pos > 60 then '… ' else '' end) ||
                substr(g.body_plain, greatest(p.pos - 60, 1), least(p.pos, 61) - 1) ||
                '⟦' || substr(g.body_plain, p.pos, length(t.longest)) || '⟧' ||
                substr(g.body_plain, p.pos + length(t.longest), 100) || ' …'
              else left(g.body_plain, 160) || ' …'
            end) as snippet,
           (case when g.title ilike all (t.pats) then 0.6
                 when public.staff_guide_kw_text(g.keywords) ilike any (t.pats) then 0.4
                 else 0.2 end)::real as rank
    from staff_guide g
    cross join terms t
    cross join input i
    cross join lateral (select strpos(lower(g.body_plain), t.longest) as pos) p
    where length(i.raw) >= 2
      and t.pats is not null
      and (g.title || ' ' || public.staff_guide_kw_text(g.keywords) || ' ' || g.body_plain) ilike all (t.pats)
      and not exists (select 1 from fts f where f.slug = g.slug)
  )
  select slug, title, section, audience,
         regexp_replace(snippet, '\s+', ' ', 'g') as snippet,
         rank::real
  from (select * from fts union all select * from fallback) r
  order by rank desc, sort, title
  limit 25
$$;

-- staff_guide_kw_text is called by search_staff_guide as the invoker, so
-- authenticated keeps EXECUTE on it (it reads nothing).
revoke execute on function public.staff_guide_kw_text(text[]) from public, anon;
grant execute on function public.staff_guide_kw_text(text[]) to authenticated;
revoke execute on function public.search_staff_guide(text) from public, anon;
grant execute on function public.search_staff_guide(text) to authenticated;
