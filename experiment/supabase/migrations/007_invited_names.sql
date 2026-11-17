-- The Pipeline Experiment — inviter-provided names, confirmed by the recipient.
--
-- Run after 006. Additive: existing participants, links and answers are kept;
-- existing participants get confirmed_name = their current name.
--
--   invitations.invited_name        the first name the inviter typed (mirrors
--                                   recipient_label, so moderation hide/replace
--                                   applies automatically)
--   participants.invited_name       what they were invited as (if anything)
--   participants.confirmed_name     what they confirmed or typed themselves
--   participants.name_was_corrected true if they changed the suggestion
--                                   (computed by the server, not the browser)
--
-- An inviter's suggestion is never treated as a verified identity: the
-- recipient must confirm it or type their own, and both go through the name
-- moderation rules. Someone who received a forwarded link can say so; that
-- doesn't accept the invitation, it stays open for the intended person.

alter table public.invitations
  add column if not exists invited_name text generated always as (recipient_label) stored,
  add column if not exists misdirected_count integer not null default 0,
  add column if not exists last_misdirected_at timestamptz;

alter table public.participants
  add column if not exists invited_name text,
  add column if not exists confirmed_name text,
  add column if not exists name_was_corrected boolean;

-- Existing participants: they typed their own name.
update public.participants p set
  confirmed_name = coalesce(p.confirmed_name, p.display_name),
  invited_name = coalesce(p.invited_name, i.recipient_label),
  name_was_corrected = case when i.recipient_label is not null and p.display_name is not null
    then lower(public.px_tidy_name(p.display_name)) <> lower(public.px_tidy_name(i.recipient_label)) end
from public.invitations i
where i.id = p.invitation_id and p.confirmed_name is null and p.deleted_at is null;

update public.experiment_settings
  set value = value || '{"misdirects_per_ip_hour": 30}'::jsonb
  where key = 'rate_limits';

-- ---------------------------------------------------------------------------
-- Landing: who the invitation is for (approved name only, open links only)
-- ---------------------------------------------------------------------------

alter function public.open_invitation(text) rename to px_open_invitation_v5;

create or replace function public.open_invitation(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb := public.px_open_invitation_v5(p_token);
  inv public.invitations;
begin
  if v ->> 'state' <> 'ok' then return v; end if;
  select * into inv from public.invitations where token = p_token;
  return v || jsonb_build_object('invited_name',
    case when inv.label_status = 'ok' then public.px_tidy_name(inv.invited_name) end);
end $$;

-- ---------------------------------------------------------------------------
-- Join: record invited vs confirmed name
-- ---------------------------------------------------------------------------

alter function public.accept_invitation(text, text, boolean, boolean, text) rename to px_accept_invitation_v5;

create or replace function public.accept_invitation(
  p_token text,
  p_display_name text,
  p_research_consent boolean,
  p_marketing_consent boolean default false,
  p_device text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb := public.px_accept_invitation_v5(p_token, p_display_name, p_research_consent, p_marketing_consent, p_device);
  inv public.invitations;
begin
  if v ->> 'state' = 'joined' then
    select * into inv from public.invitations where token = p_token;
    update public.participants p set
      invited_name = public.px_tidy_name(inv.invited_name),
      confirmed_name = p.display_name,
      name_was_corrected = case when inv.invited_name is not null
        then lower(p.display_name) <> lower(public.px_tidy_name(inv.invited_name)) end
    where p.user_id = auth.uid() and p.invitation_id = inv.id and p.deleted_at is null and p.confirmed_name is null;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Forwarded links: "this wasn't meant for me"
-- ---------------------------------------------------------------------------

create or replace function public.report_wrong_recipient(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
begin
  perform public.px_rate_limit('misdirect', public.px_client_ip(), 'misdirects_per_ip_hour', interval '1 hour');
  select * into inv from public.invitations where token = p_token for update;
  if not found or inv.status not in ('created', 'opened') then
    return jsonb_build_object('ok', false);
  end if;
  -- Their answer described a different relationship than the one invited: drop it.
  delete from public.classifications where invitation_id = inv.id and direction = 'inbound' and rater_id is null;
  update public.invitations set
    misdirected_count = misdirected_count + 1,
    last_misdirected_at = now(),
    answered_at = null
  where id = inv.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Erasure and admin
-- ---------------------------------------------------------------------------

alter function public.delete_my_data() rename to px_delete_my_data_v5;

create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if me.id is not null then
    update public.participants set invited_name = null, confirmed_name = null where id = me.id;
  end if;
  return public.px_delete_my_data_v5();
end $$;

alter function public.admin_account_stats() rename to px_admin_account_stats_v4;

create or replace function public.admin_account_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return public.px_admin_account_stats_v4() || jsonb_build_object(
    'joined_with_invited_name', (select count(*) from public.participants where invited_name is not null and deleted_at is null),
    'names_confirmed', (select count(*) from public.participants where name_was_corrected = false and deleted_at is null),
    'names_corrected', (select count(*) from public.participants where name_was_corrected = true and deleted_at is null),
    'misdirected_reports', (select coalesce(sum(misdirected_count), 0) from public.invitations)
  );
end $$;

alter function public.admin_export(text) rename to px_admin_export_v5;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_admin_export_v5(p_kind);
begin
  if p_kind = 'participants' then
    return coalesce((
      select jsonb_agg(r.row || jsonb_build_object(
        'user_id', p.user_id, 'invitation_id', p.invitation_id,
        'invited_name', p.invited_name, 'confirmed_name', p.confirmed_name,
        'name_was_corrected', p.name_was_corrected) order by r.ord)
      from jsonb_array_elements(v) with ordinality as r(row, ord)
      left join public.participants p on p.id = (r.row ->> 'participant_id')::uuid), '[]'::jsonb);
  elsif p_kind = 'invitations' then
    return coalesce((
      select jsonb_agg(r.row || jsonb_build_object(
        'invited_name', i.invited_name, 'misdirected_count', i.misdirected_count) order by r.ord)
      from jsonb_array_elements(v) with ordinality as r(row, ord)
      left join public.invitations i on i.id = (r.row ->> 'invitation_id')::uuid), '[]'::jsonb);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'px\_%' or p.proname like 'admin\_%' or p.proname in (
        'open_invitation', 'accept_invitation', 'report_wrong_recipient', 'delete_my_data'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.open_invitation(text) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean, boolean, text) to authenticated;
grant execute on function public.report_wrong_recipient(text) to anon, authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
grant execute on function public.admin_account_stats() to authenticated;
grant execute on function public.admin_names() to authenticated;
grant execute on function public.admin_moderate(text, uuid, text, text, text) to authenticated;
grant execute on function public.admin_method_stats() to authenticated;
