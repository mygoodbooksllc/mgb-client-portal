-- Weekly security fixes 2026-11-02 (report: weekly security audit 2026-11-02).
-- Written against the LIVE definitions read on 2026-11-02. Idempotent:
-- CREATE OR REPLACE / ALTER POLICY only, safe to run before or after the
-- code in the same PR is deployed. No data is changed or deleted.
--
--   W-20261019-4  client_file_download_ok: drive-files re-checks, at download
--                 time, that the person a link was made for may still open
--                 the file.
--   W-20261102-1  client_agreements_mine respects per-login tab limits.
--   W-20261102-2  cpd__docs_tab_rule respects an org's hidden Documents tab.
--   W-20261102-3  tk__rule_problem: rule save / enable / dry run need the
--                 caller's own access to the rule's client.
--   W-20261102-4  tk_rules read policy no longer bypasses client access for
--                 admins (internal company stays locked).
--   W-20261026-2  thread_hide: staff on a temporary access grant can't hide a
--                 client conversation for the whole firm.
--   W-20261026-1  usage_events: only admins (View as) may mark events view_as.

-- ---------------------------------------------------------------------------
-- W-20261019-4: may this email still open this client file? Mirrors the live
-- "client reads own files" policy with p_email in place of the JWT email.
-- Service role only (drive-files calls it with the email signed into the link).
-- ---------------------------------------------------------------------------
create or replace function public.client_file_download_ok(p_file_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.client_files f
      join public.client_users cu
        on lower(cu.email) = lower(btrim(p_email))
       and cu.client_id = f.client_id
       and cu.active
      join public.clients c
        on c.id = f.client_id
       and not c.is_internal
     where f.id = p_file_id
       and f.trashed_at is null
       and (
         (f.visibility = 'shared'
          and ((not public.cpd__on(f.client_id)) or public.cpd__docs_tab_rule(p_email, f.client_id))
          and (f.access_mode = 'everyone'
               or (f.access_mode = 'only' and exists (
                     select 1 from public.client_file_access a
                      where a.file_id = f.id and a.email = lower(btrim(p_email))))
               or (f.access_mode = 'except' and not exists (
                     select 1 from public.client_file_access a
                      where a.file_id = f.id and a.email = lower(btrim(p_email))))))
         or (f.visibility = 'request'
             and (cu.access = 'full'
                  or exists (
                    select 1 from public.client_requests r
                     where f.client_request_id is not null
                       and r.id = f.client_request_id
                       and r.client_id = f.client_id
                       and r.deleted_at is null
                       and lower(btrim(p_email)) in (
                         select lower(x.x) from unnest(coalesce(r.recipient_emails, '{}'::text[])) x(x)))))
         or (f.visibility = 'message' and f.participant_email = lower(btrim(p_email)))
       )
  );
$$;
revoke all on function public.client_file_download_ok(uuid, text) from public, anon, authenticated;
grant execute on function public.client_file_download_ok(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- W-20261102-2: an org that hides its Documents tab hides documents from its
-- logins on the server too (live body + the hidden_tabs line).
-- ---------------------------------------------------------------------------
create or replace function public.cpd__docs_tab_rule(p_email text, p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from client_users cu
      join clients c on c.id = cu.client_id
     where lower(cu.email) = lower(btrim(p_email))
       and cu.client_id = p_client_id
       and cu.active
       and not ('documents' = any (coalesce(c.hidden_tabs, '{}'::text[])))
       and (c.plan = 'basic'
            or coalesce(cu.access, 'full') = 'full'
            or cu.tabs is null
            or 'documents' = any (cu.tabs)));
$$;

-- ---------------------------------------------------------------------------
-- W-20261102-1: client agreements follow the same Documents-tab rule as
-- shared files (live body; only the v_member line changes).
-- ---------------------------------------------------------------------------
create or replace function public.client_agreements_mine(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := public.agreements__client_enabled();
  v_member boolean;
  v_staff boolean;
  v_rows jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or p_client_id is null then
    return jsonb_build_object('enabled', false, 'agreements', '[]'::jsonb);
  end if;
  v_member := public.is_client_member(p_client_id) and public.client_docs_tab_ok(p_client_id);
  v_staff := not public.is_client_member(p_client_id) and public.is_active_staff() and public.can_access_client(p_client_id);
  if not v_member and not v_staff then
    return jsonb_build_object('enabled', false, 'agreements', '[]'::jsonb);
  end if;
  if v_member and not v_enabled then
    return jsonb_build_object('enabled', false, 'agreements', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'title', a.title,
           'agreement_type', a.agreement_type,
           'status', a.status,
           'signed_on', a.signed_on,
           'effective_on', a.effective_on,
           'expires_on', a.expires_on,
           'document_url', a.document_url,
           'client_file_id', a.client_file_id
         ) order by coalesce(a.signed_on, a.effective_on, a.created_at::date) desc, a.created_at desc), '[]'::jsonb)
    into v_rows
    from public.client_agreements a
   where a.client_id = p_client_id
     and a.visible_to_client
     and a.trashed_at is null
     and not exists (select 1 from public.clients ic where ic.id = a.client_id and ic.is_internal);
  return jsonb_build_object('enabled', v_enabled, 'preview', v_staff, 'agreements', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- W-20261026-2: hiding a client conversation (for everyone) needs an admin or
-- a permanent assignment to the client, not a temporary access grant
-- (live body + the assignment check).
-- ---------------------------------------------------------------------------
create or replace function public.thread_hide(p_client_id text, p_email text)
returns client_thread_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
  v_old timestamptz;
  v_m uuid;
begin
  if not (public.is_active_staff_admin()
          or exists (select 1 from staff_client_access sca
                      where lower(sca.staff_email) = v_me and sca.client_id = p_client_id)) then
    raise exception 'no_client_access' using errcode = '42501';
  end if;
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.hidden_at;
  v_m := public.thread__mark_no_reply(p_client_id, v_email);
  update client_thread_state
     set hidden_at = now(), hidden_by = v_me, hide_marker_id = coalesce(v_m, hide_marker_id),
         updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
  returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, 'hide', to_jsonb(v_old), to_jsonb(v_row.hidden_at), v_m);
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- W-20261026-1: only admins (View as) may mark a usage event view_as, so
-- nobody else can hide their own activity from Last seen / Usage Stats.
-- ---------------------------------------------------------------------------
alter policy "signed-in users can log their own usage" on public.usage_events
  with check (
    (actor_email = (auth.jwt() ->> 'email'))
    and (actor_role = case when public.is_active_staff() then 'staff' else 'client' end)
    and (not coalesce(view_as, false) or public.is_active_staff_admin())
    and ((client_id is null)
         or public.can_access_client(client_id)
         or exists (select 1 from public.client_users cu
                     where cu.email = (auth.jwt() ->> 'email')
                       and cu.client_id = usage_events.client_id
                       and cu.active)));

-- ---------------------------------------------------------------------------
-- W-20261102-4: rules are readable by staff who can see the project or the
-- client; admins no longer bypass client access (so the internal company's
-- rules stay internal).
-- ---------------------------------------------------------------------------
alter policy "tk rules staff read" on public.tk_rules
  using (
    public.is_active_staff()
    and (
      (scope_kind = 'project'
       and public.tk_can_see_project(project_id)
       and not exists (select 1 from public.tk_projects p
                        where p.id = tk_rules.project_id
                          and p.client_id is not null
                          and not public.can_access_client(p.client_id)))
      or (scope_kind = 'client' and public.can_access_client(client_id))
    )
  );

-- ---------------------------------------------------------------------------
-- W-20261102-3: tk_rule_save, tk_rule_set_enabled (on) and tk_rule_dry_run
-- all validate through this function; it now also refuses a rule on a client
-- the caller can't open (live body + the caller check). The rule executor
-- does not call it, so running rules are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.tk__rule_problem(r public.tk_rules)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p record;
  v_client text;
  v_s text;
  v_n int;
  v_e text;
begin
  if r.name is null or char_length(r.name) > 80 then return 'Give the rule a name (up to 80 characters).'; end if;
  if r.scope_kind = 'project' then
    select p.id, p.client_id, p.sections, p.trashed_at into v_p from public.tk_projects p where p.id = r.project_id;
    if not found then return 'Pick a project.'; end if;
    if v_p.trashed_at is not null then return 'That project is in the trash.'; end if;
    v_client := v_p.client_id;
  elsif r.scope_kind = 'client' then
    if r.client_id is null or not exists (select 1 from public.clients c where c.id = r.client_id) then return 'Pick a client.'; end if;
    v_client := r.client_id;
  else
    return 'Pick a project or a client.';
  end if;
  if v_client is not null and not public.can_access_client(v_client) then
    return 'You can''t open this client.';
  end if;
  if r.trigger_kind is null or r.trigger_kind not in ('section_moved', 'done', 'overdue', 'assigned') then return 'Pick when the rule runs.'; end if;
  if r.action_kind is null or r.action_kind not in ('assign', 'set_due', 'move_section', 'comment', 'follow_up') then return 'Pick what the rule does.'; end if;
  if not public.tk__rule_pair_ok(r.trigger_kind, r.action_kind) then return 'That action does not go with that trigger.'; end if;
  if r.trigger_kind = 'section_moved' then
    if r.scope_kind <> 'project' then return 'Section rules need a project.'; end if;
    v_s := r.trigger_config ->> 'section';
    if v_s is null or not (v_s = any (v_p.sections)) then return 'Pick a section of the project.'; end if;
  end if;
  if r.trigger_kind = 'assigned' and (r.trigger_config ->> 'email') is not null
     and not exists (select 1 from public.staff s where lower(s.email) = r.trigger_config ->> 'email' and s.active) then
    return 'Pick an active teammate (or anyone).';
  end if;
  if r.action_kind = 'assign' then
    v_e := r.action_config ->> 'email';
    if v_e is null or not exists (select 1 from public.staff s where lower(s.email) = v_e and s.active) then return 'Pick an active teammate to assign.'; end if;
    if v_client is not null and not public.tk_staff_has_client(v_e, v_client) then return 'That person can''t open this client.'; end if;
  elsif r.action_kind = 'set_due' then
    v_n := public.tk__rule_int(r.action_config -> 'days');
    if v_n is null or v_n < 0 or v_n > 365 then return 'Days must be 0 to 365.'; end if;
  elsif r.action_kind = 'move_section' then
    if r.scope_kind <> 'project' then return 'Moving to a section needs a project.'; end if;
    v_s := r.action_config ->> 'section';
    if v_s is null or not (v_s = any (v_p.sections)) then return 'Pick a section of the project.'; end if;
  elsif r.action_kind = 'comment' then
    v_s := r.action_config ->> 'text';
    if v_s is null or char_length(v_s) > 1000 then return 'Write the comment (up to 1000 characters).'; end if;
  elsif r.action_kind = 'follow_up' then
    v_s := r.action_config ->> 'title';
    if v_s is null or char_length(v_s) > 200 then return 'Write the follow-up title (up to 200 characters).'; end if;
    if r.action_config ? 'days' and r.action_config -> 'days' <> 'null'::jsonb then
      v_n := public.tk__rule_int(r.action_config -> 'days');
      if v_n is null or v_n < 0 or v_n > 365 then return 'Days must be 0 to 365.'; end if;
    end if;
    v_e := coalesce(r.action_config ->> 'assignee', 'same');
    if v_e <> 'same' then
      if not exists (select 1 from public.staff s where lower(s.email) = v_e and s.active) then return 'Pick an active teammate for the follow-up.'; end if;
      if v_client is not null and not public.tk_staff_has_client(v_e, v_client) then return 'That person can''t open this client.'; end if;
    end if;
  end if;
  return null;
end $$;
