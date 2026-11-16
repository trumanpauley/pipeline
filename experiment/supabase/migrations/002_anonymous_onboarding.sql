-- The Pipeline Experiment — frictionless onboarding.
--
-- Run after 001. Fully backward compatible:
--   * existing invitation links, participants and classifications are untouched
--   * accept_invitation still accepts the old 4-argument call
--   * participants created with email (old flow) keep working and can sign in
--
-- What changes
--   * participants join with Supabase *anonymous* auth (no email up front)
--   * optional early-access waitlist, stored separately from research consent
--   * optional email linking happens in Supabase Auth (same user id), so the
--     participant row needs no change; emails are read live from auth.users
--   * abuse protections: per-IP rate limits (hashed), per-browser duplicate and
--     self-referral checks, per-participant invite rate limit, and a
--     same-network flag for admin review

-- ---------------------------------------------------------------------------
-- New columns / tables
-- ---------------------------------------------------------------------------

alter table public.participants
  add column if not exists device_hash text,
  add column if not exists ip_hash text,
  add column if not exists flagged_same_network boolean not null default false;

create index if not exists participants_device_idx on public.participants (device_hash)
  where deleted_at is null;

create table public.waitlist (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  consent_text text not null,
  consent_at timestamptz not null default now(),
  source text not null default 'reveal',
  withdrawn_at timestamptz
);

-- Short-lived counters for rate limiting. Keys are salted hashes, never raw IPs.
create table public.rate_events (
  id bigint generated always as identity primary key,
  kind text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (kind, key_hash, created_at);

insert into public.experiment_settings (key, value, description) values
  ('rate_limits', '{
      "joins_per_ip_hour": 20,
      "opens_per_ip_hour": 300,
      "waitlist_per_ip_hour": 10,
      "invites_per_participant_hour": 4
    }', 'Abuse limits. IPs are stored only as salted hashes and purged after 2 days.'),
  ('block_same_device', 'true',
    'Reject a second participant from the same browser, and self-referrals from the sender''s browser.'),
  ('hash_salt', to_jsonb(replace(gen_random_uuid()::text, '-', '')),
    'Secret salt for hashing IPs and device ids. Do not expose.'),
  ('waitlist_consent_text', '"Email me about Pipeline early access. Unsubscribe anytime."',
    'Exact wording stored with each waitlist signup.')
on conflict (key) do nothing;

alter table public.waitlist enable row level security;
alter table public.rate_events enable row level security;
create policy "Read own waitlist row" on public.waitlist for select to authenticated
  using (participant_id = (select id from public.px_me()) or public.is_admin());
revoke all on public.waitlist, public.rate_events from anon, authenticated;
grant select on public.waitlist to authenticated;

-- Nobody but admins may read the hash salt.
drop policy if exists "Admins read settings" on public.experiment_settings;
create policy "Admins read settings" on public.experiment_settings for select to authenticated
  using (public.is_admin() and key <> 'hash_salt');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.px_hash(p_value text)
returns text language sql stable security definer set search_path = public as $$
  select case when nullif(p_value, '') is null then null else
    encode(sha256(convert_to(p_value || (public.px_setting('hash_salt') #>> '{}'), 'UTF8')), 'hex') end
$$;

-- Caller IP from the request headers PostgREST forwards (null when unknown).
create or replace function public.px_client_ip()
returns text language sql stable as $$
  select nullif(btrim(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
    nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
    ''), ',', 1)), '')
$$;

create or replace function public.px_rate_limit(p_kind text, p_key text, p_limit_key text, p_window interval)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_hash text := public.px_hash(p_key);
  v_limit integer := (public.px_setting('rate_limits') ->> p_limit_key)::int;
begin
  if v_hash is null or v_limit is null then return; end if;
  if (select count(*) from public.rate_events
      where kind = p_kind and key_hash = v_hash and created_at > now() - p_window) >= v_limit then
    raise exception 'rate_limited' using errcode = '22023';
  end if;
  insert into public.rate_events (kind, key_hash) values (p_kind, v_hash);
  if random() < 0.02 then
    delete from public.rate_events where created_at < now() - interval '2 days';
  end if;
end $$;

create or replace function public.px_is_anonymous()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select u.email is null from auth.users u where u.id = auth.uid()), true)
$$;

-- ---------------------------------------------------------------------------
-- Participant RPCs (replaced; same behaviour plus protections)
-- ---------------------------------------------------------------------------

create or replace function public.open_invitation(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  me public.participants;
  sender public.participants;
begin
  begin
    perform public.px_rate_limit('open', public.px_client_ip(), 'opens_per_ip_hour', interval '1 hour');
  exception when others then
    if sqlerrm = 'rate_limited' then return jsonb_build_object('state', 'rate_limited'); end if;
    raise;
  end;

  select * into inv from public.invitations where token = p_token for update;
  if not found or inv.status = 'revoked' then
    return jsonb_build_object('state', 'invalid');
  end if;

  me := public.px_me();
  if inv.sender_id is not null then
    select * into sender from public.participants where id = inv.sender_id;
  end if;

  if me.id is not null and inv.sender_id = me.id then
    return jsonb_build_object('state', 'own');
  end if;

  if inv.status in ('accepted', 'duplicate') then
    return jsonb_build_object('state',
      case when me.id is not null and inv.accepted_by = me.id then 'joined' else 'used' end);
  end if;

  update public.invitations set
    status = 'opened',
    opened_at = coalesce(opened_at, now()),
    open_count = open_count + 1,
    assigned_method = coalesce(assigned_method, public.px_pick_method())
  where id = inv.id
  returning * into inv;

  return jsonb_build_object(
    'state', 'ok',
    'sender_name', coalesce(sender.display_name, inv.sender_name),
    'method', inv.assigned_method,
    'answered', inv.answered_at is not null,
    'already_participant', me.id is not null
  );
end $$;

drop function if exists public.accept_invitation(text, text, boolean, boolean);

create or replace function public.accept_invitation(
  p_token text,
  p_display_name text,
  p_research_consent boolean,
  p_marketing_consent boolean default false,
  p_device text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  me public.participants;
  sender public.participants;
  v_email text;
  v_name text := nullif(btrim(p_display_name), '');
  v_device text := public.px_hash(p_device);
  v_ip text := public.px_hash(public.px_client_ip());
  v_block_device boolean := coalesce((public.px_setting('block_same_device'))::boolean, true);
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into inv from public.invitations where token = p_token for update;
  if not found or inv.status = 'revoked' then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;

  me := public.px_me();
  if inv.sender_id is not null then
    select * into sender from public.participants where id = inv.sender_id;
  end if;

  -- Already a participant: never re-parent (prevents loops and double credit).
  if me.id is not null then
    if inv.accepted_by = me.id then
      return jsonb_build_object('state', 'joined');
    end if;
    if inv.sender_id = me.id then
      raise exception 'self_invite' using errcode = '22023';
    end if;
    if inv.status not in ('created', 'opened') then
      raise exception 'invitation_used' using errcode = '22023';
    end if;
    update public.invitations
      set status = 'duplicate', accepted_by = me.id, accepted_at = now()
      where id = inv.id;
    update public.classifications set rater_id = me.id
      where invitation_id = inv.id and direction = 'inbound';
    return jsonb_build_object('state', 'already_participant');
  end if;

  if inv.status not in ('created', 'opened') then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  if sender.user_id is not null and sender.user_id = auth.uid() then
    raise exception 'self_invite' using errcode = '22023';
  end if;
  -- Same browser as the sender (e.g. signed out and opened their own link).
  if v_block_device and v_device is not null and sender.device_hash = v_device then
    raise exception 'self_invite' using errcode = '22023';
  end if;
  -- Same browser as another active participant: one person per browser.
  if v_block_device and v_device is not null and exists (
      select 1 from public.participants
      where device_hash = v_device and deleted_at is null) then
    raise exception 'device_already_joined' using errcode = '22023';
  end if;
  if not coalesce(p_research_consent, false) then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) > 40 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  perform public.px_rate_limit('join', public.px_client_ip(), 'joins_per_ip_hour', interval '1 hour');

  select email into v_email from auth.users where id = auth.uid();

  insert into public.participants (
    user_id, email, display_name, parent_id, invitation_id, depth, method,
    research_consent_at, marketing_consent, marketing_consent_at,
    device_hash, ip_hash, flagged_same_network
  ) values (
    auth.uid(), lower(v_email), v_name, inv.sender_id, inv.id,
    coalesce(sender.depth, 0) + 1,
    coalesce(inv.assigned_method, public.px_pick_method()),
    now(), coalesce(p_marketing_consent, false),
    case when p_marketing_consent then now() end,
    v_device, v_ip,
    coalesce(v_ip is not null and sender.ip_hash = v_ip, false)
  ) returning * into me;

  update public.invitations
    set status = 'accepted', accepted_by = me.id, accepted_at = now(),
        assigned_method = coalesce(assigned_method, me.method)
    where id = inv.id;
  update public.classifications set rater_id = me.id
    where invitation_id = inv.id and direction = 'inbound';

  if sender.id is not null and public.px_setting('unlock_on') #>> '{}' = 'accepted' then
    update public.participants p set
      reveal_level = greatest(p.reveal_level, least(2, (
        select count(*) from public.invitations i
        where i.sender_id = p.id and i.status = 'accepted'))),
      revealed_via = coalesce(p.revealed_via, 'invite')
    where p.id = sender.id;
  end if;

  return jsonb_build_object('state', 'joined');
end $$;

-- Wrap create_invitation (from 001) with a per-participant hourly limit.
alter function public.create_invitation(text, text, integer) rename to px_create_invitation_core;

create or replace function public.create_invitation(
  p_value text,
  p_recipient_label text default null,
  p_response_ms integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if me.id is not null then
    perform public.px_rate_limit('invite', me.id::text, 'invites_per_participant_hour', interval '1 hour');
  end if;
  return public.px_create_invitation_core(p_value, p_recipient_label, p_response_ms);
end $$;

-- Account details for the home screen (kept separate from get_my_state).
create or replace function public.get_my_account()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  u auth.users;
  w public.waitlist;
begin
  select * into u from auth.users where id = auth.uid();
  if me.id is not null then
    select * into w from public.waitlist where participant_id = me.id and withdrawn_at is null;
  end if;
  return jsonb_build_object(
    'is_anonymous', u.email is null,
    'linked_email', case when u.email_confirmed_at is not null then u.email end,
    'waitlist_email', w.email
  );
end $$;

create or replace function public.join_waitlist(p_email text, p_source text default 'reveal')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_email text := lower(btrim(p_email));
begin
  if me.id is null then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  perform public.px_rate_limit('waitlist', public.px_client_ip(), 'waitlist_per_ip_hour', interval '1 hour');
  insert into public.waitlist (participant_id, email, consent_text, source)
  values (me.id, v_email, public.px_setting('waitlist_consent_text') #>> '{}',
          left(coalesce(p_source, 'reveal'), 20))
  on conflict (participant_id) do update
    set email = excluded.email, consent_text = excluded.consent_text,
        consent_at = now(), source = excluded.source, withdrawn_at = null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.leave_waitlist()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  update public.waitlist set withdrawn_at = now() where participant_id = me.id;
  return jsonb_build_object('ok', true);
end $$;

-- Erasure now also removes the waitlist entry (001's function is kept as the core).
alter function public.delete_my_data() rename to px_delete_my_data_core;

create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if me.id is not null then
    delete from public.waitlist where participant_id = me.id;
    update public.participants set device_hash = null, ip_hash = null where id = me.id;
  end if;
  return public.px_delete_my_data_core();
end $$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

create or replace function public.admin_account_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return jsonb_build_object(
    'anonymous', (select count(*) from public.participants p left join auth.users u on u.id = p.user_id
                  where p.deleted_at is null and u.email is null),
    'linked_emails', (select count(*) from public.participants p join auth.users u on u.id = p.user_id
                      where p.deleted_at is null and u.email_confirmed_at is not null),
    'waitlist', (select count(*) from public.waitlist w join public.participants p on p.id = w.participant_id
                 where w.withdrawn_at is null and p.deleted_at is null),
    'flagged_same_network', (select count(*) from public.participants
                             where flagged_same_network and deleted_at is null)
  );
end $$;

alter function public.admin_export(text) rename to px_admin_export_core;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'participants' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select p.id as participant_id, p.parent_id, p.depth, p.method,
        case when u.email_confirmed_at is not null then u.email else p.email end as linked_email,
        (p.deleted_at is null and u.email is null) as is_anonymous,
        p.display_name, p.research_consent_at,
        (w.withdrawn_at is null and w.email is not null) as on_waitlist,
        p.marketing_consent as legacy_marketing_consent,
        p.reveal_level, p.revealed_via, p.flagged_same_network, p.created_at, p.deleted_at,
        (select count(*) from public.invitations i where i.sender_id = p.id) as links_generated,
        (select count(*) from public.invitations i where i.sender_id = p.id and i.status = 'accepted') as links_accepted
      from public.participants p
      left join auth.users u on u.id = p.user_id
      left join public.waitlist w on w.participant_id = p.id) r;
    return coalesce(v, '[]'::jsonb);
  elsif p_kind = 'waitlist' then
    select jsonb_agg(row_to_json(r) order by r.consent_at) into v from (
      select w.email, w.participant_id, w.source, w.consent_text, w.consent_at
      from public.waitlist w join public.participants p on p.id = w.participant_id
      where w.withdrawn_at is null and p.deleted_at is null) r;
    return coalesce(v, '[]'::jsonb);
  end if;
  return public.px_admin_export_core(p_kind);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges for everything defined or renamed here
-- ---------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'px\_%' or p.proname like 'admin\_%' or p.proname in (
        'open_invitation', 'accept_invitation', 'create_invitation', 'get_my_account',
        'join_waitlist', 'leave_waitlist', 'delete_my_data'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.open_invitation(text) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean, boolean, text) to authenticated;
grant execute on function public.create_invitation(text, text, integer) to authenticated;
grant execute on function public.get_my_account() to authenticated;
grant execute on function public.join_waitlist(text, text) to authenticated;
grant execute on function public.leave_waitlist() to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
grant execute on function public.admin_account_stats() to authenticated;
