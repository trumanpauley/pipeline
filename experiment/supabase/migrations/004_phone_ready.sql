-- The Pipeline Experiment — ready for optional phone verification.
--
-- Run after 003. Additive; changes no data.
--
-- Phone numbers live only in Supabase Auth (auth.users.phone). A participant
-- who verifies a phone keeps the same auth user id, so their participant row,
-- links and answers are untouched. This migration only makes the app and the
-- admin stats aware that "has no email" no longer means "anonymous".
--
-- Phone verification itself is switched on in the Supabase dashboard (see
-- README → Optional phone verification) and in the app with VITE_PHONE_AUTH=1.

-- The waitlist's consent wording is now an explicit checkbox shown to the
-- participant; the stored text matches it word for word.
update public.experiment_settings
  set value = '"Email me Pipeline updates and early-access news. Unsubscribe anytime."',
      description = 'Exact consent checkbox text shown on the waitlist screen and stored with each signup.',
      updated_at = now()
  where key = 'waitlist_consent_text';

-- Anonymous = no verified email and no verified phone.
create or replace function public.px_is_anonymous()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select u.email is null and u.phone is null from auth.users u where u.id = auth.uid()), true)
$$;

alter function public.get_my_account() rename to px_get_my_account_core;

create or replace function public.get_my_account()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  u auth.users;
begin
  select * into u from auth.users where id = auth.uid();
  return public.px_get_my_account_core() || jsonb_build_object(
    'is_anonymous', u.email is null and u.phone is null,
    'linked_phone', case when u.phone_confirmed_at is not null then u.phone end,
    'waitlist_consent_text', public.px_setting('waitlist_consent_text') #>> '{}'
  );
end $$;

alter function public.admin_account_stats() rename to px_admin_account_stats_v3;

create or replace function public.admin_account_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return public.px_admin_account_stats_v3() || jsonb_build_object(
    'anonymous', (select count(*) from public.participants p left join auth.users u on u.id = p.user_id
                  where p.deleted_at is null and u.email is null and u.phone is null),
    'linked_phones', (select count(*) from public.participants p join auth.users u on u.id = p.user_id
                      where p.deleted_at is null and u.phone_confirmed_at is not null)
  );
end $$;

alter function public.admin_export(text) rename to px_admin_export_v3;

-- Participants export: correct the anonymous flag and say whether a phone is
-- verified (the number itself is not exported).
create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_admin_export_v3(p_kind);
begin
  if p_kind <> 'participants' then return v; end if;
  return coalesce((
    select jsonb_agg(r.row || jsonb_build_object(
      'is_anonymous', p.deleted_at is null and u.email is null and u.phone is null,
      'has_verified_phone', u.phone_confirmed_at is not null) order by r.ord)
    from jsonb_array_elements(v) with ordinality as r(row, ord)
    left join public.participants p on p.id = (r.row ->> 'participant_id')::uuid
    left join auth.users u on u.id = p.user_id), '[]'::jsonb);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'px\_%' or p.proname like 'admin\_%' or p.proname = 'get_my_account')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.get_my_account() to authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
grant execute on function public.admin_account_stats() to authenticated;
