-- The Pipeline Experiment — Pipeline Community signup.
--
-- Run after 008. Additive only: no existing rows, links or research data change.
--
-- After the mission reveal, participants can optionally leave an email and choose
-- either or both of two independent consents:
--   * research_invites — "Invite me to future Pipeline experiments."
--   * updates          — "Send me Pipeline updates and early access."
-- Each consent keeps its own exact wording, timestamp and withdrawal timestamp.
--
-- Privacy
--   * community_signups has RLS on and NO table grants: emails are never readable
--     through the REST API. Participants see their own row only via
--     get_my_account(); admins via admin_* RPCs (CSV export).
--   * One row per participant and one per email (unique). Submitting an email that
--     already belongs to someone else changes nothing and reveals nothing.
--   * delete_my_data() erases the row.
--
-- Experiment 2 readiness: admin_export('research_pool') lists only participants
-- with an active research_invites consent (participant id, email, generation),
-- without any relationship data.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.community_signups (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
                             and char_length(email) <= 254),
  research_invites boolean not null default false,
  research_invites_text text,
  research_invites_at timestamptz,
  research_invites_withdrawn_at timestamptz,
  updates boolean not null default false,
  updates_text text,
  updates_at timestamptz,
  updates_withdrawn_at timestamptz,
  source text not null default 'reveal',
  signed_up_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

create unique index if not exists community_signups_email_idx on public.community_signups (email);

alter table public.community_signups enable row level security;
-- No policies and no grants: only SECURITY DEFINER functions below can touch it.
revoke all on public.community_signups from anon, authenticated;

-- "Maybe later" is remembered on the server so the screen isn't shown again on
-- another device either.
alter table public.participants
  add column if not exists community_prompt_dismissed_at timestamptz;

insert into public.experiment_settings (key, value, description) values
  ('community_consent_texts', '{
      "research_invites": "Invite me to future Pipeline experiments.",
      "updates": "Send me Pipeline updates and early access."
    }'::jsonb,
    'Exact checkbox wording for the Pipeline Community signup, stored with each consent.')
on conflict (key) do nothing;

update public.experiment_settings
  set value = value || '{"community_per_ip_hour": 20}'::jsonb
  where key = 'rate_limits' and not value ? 'community_per_ip_hour';

-- Existing early-access waitlist entries already consented to updates: carry them
-- over (the waitlist table itself is kept untouched).
insert into public.community_signups
  (participant_id, email, updates, updates_text, updates_at, source, signed_up_at)
select distinct on (w.email) w.participant_id, w.email, true, w.consent_text, w.consent_at, 'waitlist', w.consent_at
from public.waitlist w
join public.participants p on p.id = w.participant_id and p.deleted_at is null
where w.withdrawn_at is null
order by w.email, w.consent_at
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Participant RPCs
-- ---------------------------------------------------------------------------

create or replace function public.px_community_texts()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(public.px_setting('community_consent_texts'), '{}'::jsonb)
$$;

-- Sets both preferences at once, recording timestamps only when one changes.
create or replace function public.px_community_apply(p_row public.community_signups,
                                                     p_research boolean, p_updates boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t jsonb := public.px_community_texts();
begin
  update public.community_signups set
    research_invites = p_research,
    research_invites_text = case when p_research and not p_row.research_invites
                                 then t ->> 'research_invites' else research_invites_text end,
    research_invites_at = case when p_research and not p_row.research_invites then now() else research_invites_at end,
    research_invites_withdrawn_at = case when p_research then null
                                         when p_row.research_invites then now() else research_invites_withdrawn_at end,
    updates = p_updates,
    updates_text = case when p_updates and not p_row.updates then t ->> 'updates' else updates_text end,
    updates_at = case when p_updates and not p_row.updates then now() else updates_at end,
    updates_withdrawn_at = case when p_updates then null
                                when p_row.updates then now() else updates_withdrawn_at end,
    unsubscribed_at = case when p_research or p_updates then null else coalesce(unsubscribed_at, now()) end,
    updated_at = now()
  where id = p_row.id;
end $$;

create or replace function public.join_community(p_email text, p_research_invites boolean, p_updates boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_email text := lower(btrim(coalesce(p_email, '')));
  r public.community_signups;
  other uuid;
begin
  if me.id is null then
    return jsonb_build_object('error', 'not_participant');
  end if;
  -- Neither box ticked means no subscription: nothing is stored.
  if not coalesce(p_research_invites, false) and not coalesce(p_updates, false) then
    return jsonb_build_object('error', 'no_preference');
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_email) > 254 then
    return jsonb_build_object('error', 'invalid_email');
  end if;
  perform public.px_rate_limit('community', public.px_client_ip(), 'community_per_ip_hour', interval '1 hour');

  select participant_id into other from public.community_signups
    where email = v_email and participant_id <> me.id;
  if other is not null then
    -- Already someone else's address: don't change their consents and don't
    -- reveal that it exists. Record that this participant has seen the prompt.
    update public.participants set community_prompt_dismissed_at = coalesce(community_prompt_dismissed_at, now())
      where id = me.id;
    return jsonb_build_object('ok', true);
  end if;

  insert into public.community_signups (participant_id, email)
  values (me.id, v_email)
  on conflict (participant_id) do update set email = excluded.email, updated_at = now()
  returning * into r;
  -- A fresh row starts with both consents off, so apply() stamps each one chosen.
  perform public.px_community_apply(r, coalesce(p_research_invites, false), coalesce(p_updates, false));
  return jsonb_build_object('ok', true);
end $$;

-- Change either preference later; turning both off unsubscribes (row kept with
-- withdrawal timestamps as the consent record).
create or replace function public.update_community_preferences(p_research_invites boolean, p_updates boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  r public.community_signups;
begin
  if me.id is null then
    return jsonb_build_object('error', 'not_participant');
  end if;
  select * into r from public.community_signups where participant_id = me.id;
  if r.id is null then
    return jsonb_build_object('error', 'not_subscribed');
  end if;
  perform public.px_community_apply(r, coalesce(p_research_invites, false), coalesce(p_updates, false));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dismiss_community_prompt()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  update public.participants set community_prompt_dismissed_at = coalesce(community_prompt_dismissed_at, now())
    where id = me.id;
  return jsonb_build_object('ok', true);
end $$;

alter function public.get_my_account() rename to px_get_my_account_v4;

create or replace function public.get_my_account()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  r public.community_signups;
begin
  if me.id is not null then
    select * into r from public.community_signups where participant_id = me.id;
  end if;
  return public.px_get_my_account_v4() || jsonb_build_object(
    'community', case when r.id is null then null else jsonb_build_object(
      'email', r.email,
      'research_invites', r.research_invites,
      'updates', r.updates,
      'subscribed', r.unsubscribed_at is null,
      'signed_up_at', r.signed_up_at) end,
    'community_prompt_dismissed', me.community_prompt_dismissed_at is not null,
    'community_consent_texts', public.px_community_texts()
  );
end $$;

alter function public.delete_my_data() rename to px_delete_my_data_v8;

create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if me.id is not null then
    delete from public.community_signups where participant_id = me.id;
  end if;
  return public.px_delete_my_data_v8();
end $$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

create or replace function public.admin_community_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_eligible bigint;
begin
  perform public.px_require_admin();
  select count(*) into v_eligible from public.participants where deleted_at is null and reveal_level >= 2;
  return (
    with s as (
      select c.*, p.depth from public.community_signups c
      join public.participants p on p.id = c.participant_id and p.deleted_at is null
      where c.unsubscribed_at is null)
    select jsonb_build_object(
      'total', (select count(*) from s),
      'research_invites', (select count(*) from s where research_invites),
      'updates', (select count(*) from s where updates),
      'both', (select count(*) from s where research_invites and updates),
      'unsubscribed', (select count(*) from public.community_signups c
                       join public.participants p on p.id = c.participant_id and p.deleted_at is null
                       where c.unsubscribed_at is not null),
      'dismissed', (select count(*) from public.participants
                    where deleted_at is null and community_prompt_dismissed_at is not null
                      and id not in (select participant_id from s)),
      'eligible', v_eligible,
      'participants', (select count(*) from public.participants where deleted_at is null),
      'by_generation', coalesce((
        select jsonb_agg(jsonb_build_object('depth', g.depth, 'eligible', g.eligible, 'signups', g.signups)
                         order by g.depth)
        from (
          select p.depth,
            count(*) filter (where p.reveal_level >= 2) as eligible,
            count(s.id) as signups
          from public.participants p left join s on s.participant_id = p.id
          where p.deleted_at is null
          group by p.depth) g), '[]'::jsonb)
    ));
end $$;

alter function public.admin_export(text) rename to px_admin_export_v7;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'community' then
    select jsonb_agg(row_to_json(r) order by r.signed_up_at) into v from (
      select c.id, c.participant_id, p.depth, c.email,
        c.research_invites, c.research_invites_text, c.research_invites_at, c.research_invites_withdrawn_at,
        c.updates, c.updates_text, c.updates_at, c.updates_withdrawn_at,
        c.source, c.signed_up_at, c.updated_at, c.unsubscribed_at
      from public.community_signups c
      join public.participants p on p.id = c.participant_id and p.deleted_at is null) r;
    return coalesce(v, '[]'::jsonb);
  elsif p_kind = 'research_pool' then
    -- Experiment 2 contact list: active research consent only, no relationship data.
    select jsonb_agg(row_to_json(r) order by r.research_invites_at) into v from (
      select c.participant_id, c.email, p.depth, c.research_invites_at
      from public.community_signups c
      join public.participants p on p.id = c.participant_id and p.deleted_at is null
      where c.research_invites and c.unsubscribed_at is null) r;
    return coalesce(v, '[]'::jsonb);
  end if;
  return public.px_admin_export_v7(p_kind);
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
        'join_community', 'update_community_preferences', 'dismiss_community_prompt',
        'get_my_account', 'delete_my_data'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.join_community(text, boolean, boolean) to authenticated;
grant execute on function public.update_community_preferences(boolean, boolean) to authenticated;
grant execute on function public.dismiss_community_prompt() to authenticated;
grant execute on function public.get_my_account() to authenticated;
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
grant execute on function public.admin_community_stats() to authenticated;
