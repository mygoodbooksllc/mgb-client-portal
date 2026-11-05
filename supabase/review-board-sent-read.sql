-- Review board follow-up (review 2026-11-05): the email draft extras must show
-- "Marked sent" (who, when) when a draft is reopened. rb_draft_recipients gains
-- one key, `sent`: {by, by_name, at} from rb_email_sent, or null. Everything
-- else (access rule, other keys, grants) is exactly as in review-board.sql.
-- Additive: CREATE OR REPLACE of one function, same signature. Nothing sends email.
--
-- Applied to production 2026-11-05 (project xumsqmhccgfjnlmieqyu, migration reviewboard_4_sent_read).
-- Self-test: review-board-sent-read-tests.sql (rolls back).

create or replace function public.rb_draft_recipients(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_client text;
begin
  if not coalesce(public.is_active_staff(), false) then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
  select r.client_id into v_client
    from staff_reminders r
   where r.id = p_task_id and r.deleted_at is null and r.client_id is not null;
  if v_client is null then
    raise exception 'rb_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.can_access_client(v_client), false) then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'client_id', v_client,
    'contact',   public.rb__main_contact(v_client),
    'contacts',  coalesce((select jsonb_agg(jsonb_build_object('name', k.name, 'email', lower(k.email),
                                                               'role', k.role, 'can_answer', k.can_answer_requests)
                                            order by k.can_answer_requests desc, k.name, lower(k.email))
                             from client_contacts k
                            where k.client_id = v_client and k.deleted_at is null
                              and nullif(btrim(k.email), '') is not null), '[]'::jsonb),   -- never notes
    'logins',    coalesce((select jsonb_agg(jsonb_build_object('name', u.name, 'email', lower(u.email),
                                                               'opted_out', exists (
                                                                 select 1 from client_email_recipients x
                                                                  where x.client_id = u.client_id
                                                                    and lower(x.email) = lower(u.email)
                                                                    and x.opted_out_at is not null))
                                            order by u.name, lower(u.email))
                             from client_users u
                            where u.client_id = v_client and u.active), '[]'::jsonb),
    'staff',     coalesce((select jsonb_agg(jsonb_build_object('role', p.role, 'email', p.email, 'name', p.name))
                             from public.tk__client_people(v_client) p
                            where p.role in ('bookkeeper', 'account_manager')), '[]'::jsonb),
    'sent',      (select jsonb_build_object('by', e.sent_by, 'at', e.sent_at,
                                            'by_name', (select st.name from staff st
                                                         where lower(st.email) = e.sent_by
                                                         order by st.active desc limit 1))
                    from rb_email_sent e where e.task_id = p_task_id));
end $$;
revoke all on function public.rb_draft_recipients(uuid) from public, anon;
grant execute on function public.rb_draft_recipients(uuid) to authenticated;

notify pgrst, 'reload schema';
