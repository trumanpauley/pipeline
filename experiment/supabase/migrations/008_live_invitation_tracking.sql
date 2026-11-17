-- The Pipeline Experiment — live invitation tracking.
--
-- Run after 007. Additive.
--
-- Statuses shown to the inviter (derived from existing columns):
--   Ready      link generated, not shared           (shared_at is null)
--   Pending    Share/Copy tapped                     (shared_at set)
--   Opened     a person (not a bot, not the sender) opened it   (opened_at set)
--   Connected  the recipient finished joining        (status = 'accepted')
--
-- A website can't confirm SMS/iMessage delivery: "Pending" means the inviter
-- started sharing, nothing more. Opens are only counted when the invitation
-- page's code actually runs in a browser, so link-preview fetchers that just
-- read the HTML never count; crawlers that do run code are excluded by
-- user agent; the sender's own browser is excluded; repeat visits by the same
-- browser count once.
--
-- Every step is written to invitation_events (admin-only). Inviters get live
-- updates through Supabase Realtime on their own invitation rows (RLS: a
-- participant can only read invitations they sent).

create table public.invitation_events (
  id bigint generated always as identity primary key,
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  event text not null check (event in ('created', 'share_initiated', 'opened', 'bot_preview', 'sender_open', 'connected')),
  detail text,           -- share method; 'repeat' for a returning visitor
  visitor_hash text,     -- salted hash of the visitor's browser id (or IP); never raw
  created_at timestamptz not null default now()
);
create index invitation_events_invitation_idx on public.invitation_events (invitation_id, event);

alter table public.invitation_events enable row level security;
create policy "Admins read invitation events" on public.invitation_events for select to authenticated using (public.is_admin());
revoke all on public.invitation_events from anon, authenticated;
grant select on public.invitation_events to authenticated;

alter table public.invitations
  add column if not exists unique_open_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- Bot / link-preview detection (user agent; deliberately conservative)
-- ---------------------------------------------------------------------------

create or replace function public.px_is_bot_ua(p_ua text)
returns boolean language sql immutable as $$
  select coalesce(p_ua, '') = ''
      or lower(p_ua) ~ '(bot|crawl|spider|slurp|preview|scanner|monitor|headlesschrome|lighthouse|facebookexternalhit|facebookcatalog|embedly|quora link|outbrain|pinterest|vkshare|whatsapp|telegram|discord|slack|linkedin|skype|bitly|applebot|google-inspectiontool|python-requests|curl/|wget|httpclient|okhttp|go-http-client|axios/)'
$$;

create or replace function public.px_request_ua()
returns text language sql stable as $$
  select nullif(current_setting('request.headers', true), '')::json ->> 'user-agent'
$$;

-- ---------------------------------------------------------------------------
-- Opening an invitation
-- ---------------------------------------------------------------------------

alter function public.open_invitation(text) rename to px_open_invitation_v7;

create or replace function public.open_invitation(p_token text, p_device text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  sender public.participants;
  v jsonb;
  v_visitor text := public.px_hash(coalesce(nullif(p_device, ''), public.px_client_ip()));
  v_seen boolean;
begin
  select * into inv from public.invitations where token = p_token;
  if not found then
    return public.px_open_invitation_v7(p_token); -- 'invalid' (and rate limiting) as before
  end if;

  -- Link previews and crawlers: no status change, no method assignment, no names.
  if public.px_is_bot_ua(public.px_request_ua()) then
    insert into public.invitation_events (invitation_id, event, detail) values (inv.id, 'bot_preview', left(public.px_request_ua(), 120));
    return jsonb_build_object('state', 'preview');
  end if;

  -- The sender's own browser (even signed out) never counts as an open.
  if inv.sender_id is not null and p_device is not null then
    select * into sender from public.participants where id = inv.sender_id;
    if sender.device_hash is not null and sender.device_hash = public.px_hash(p_device) then
      insert into public.invitation_events (invitation_id, event) values (inv.id, 'sender_open');
      return jsonb_build_object('state', 'own');
    end if;
  end if;

  v := public.px_open_invitation_v7(p_token);

  if v ->> 'state' = 'own' then
    insert into public.invitation_events (invitation_id, event) values (inv.id, 'sender_open');
  elsif v ->> 'state' = 'ok' then
    select exists (select 1 from public.invitation_events
                   where invitation_id = inv.id and event = 'opened' and visitor_hash = v_visitor) into v_seen;
    insert into public.invitation_events (invitation_id, event, detail, visitor_hash)
    values (inv.id, 'opened', case when v_seen then 'repeat' end, v_visitor);
    if not v_seen then
      update public.invitations set unique_open_count = unique_open_count + 1 where id = inv.id;
    end if;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Share initiated, created, connected
-- ---------------------------------------------------------------------------

alter function public.mark_invitation_shared(uuid, text) rename to px_mark_invitation_shared_v3;

create or replace function public.mark_invitation_shared(p_invitation_id uuid, p_method text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb := public.px_mark_invitation_shared_v3(p_invitation_id, p_method);
begin
  insert into public.invitation_events (invitation_id, event, detail) values (p_invitation_id, 'share_initiated', p_method);
  return v;
end $$;

create or replace function public.px_invitation_lifecycle_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.invitation_events (invitation_id, event) values (new.id, 'created');
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.invitation_events (invitation_id, event) values (new.id, 'connected');
  end if;
  return new;
end $$;

create trigger invitations_lifecycle_events after insert or update of status on public.invitations
  for each row execute function public.px_invitation_lifecycle_events();

-- ---------------------------------------------------------------------------
-- The participant's own id (for the Realtime filter) and open counts
-- ---------------------------------------------------------------------------

alter function public.get_my_state() rename to px_get_my_state_v5;

create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_get_my_state_v5();
  me public.participants := public.px_me();
begin
  if me.id is null then return v; end if;
  return jsonb_set(v, '{participant}', (v -> 'participant') || jsonb_build_object('id', me.id));
end $$;

-- ---------------------------------------------------------------------------
-- Realtime: stream changes to invitations (RLS limits each user to their own)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invitations') then
    execute 'alter publication supabase_realtime add table public.invitations';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

alter function public.admin_account_stats() rename to px_admin_account_stats_v5;

create or replace function public.admin_account_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return public.px_admin_account_stats_v5() || jsonb_build_object(
    'human_opens', (select count(*) from public.invitation_events where event = 'opened' and detail is null),
    'repeat_opens', (select count(*) from public.invitation_events where event = 'opened' and detail = 'repeat'),
    'bot_previews', (select count(*) from public.invitation_events where event = 'bot_preview'),
    'sender_opens', (select count(*) from public.invitation_events where event = 'sender_open')
  );
end $$;

alter function public.admin_export(text) rename to px_admin_export_v6;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'invitation_events' then
    select jsonb_agg(row_to_json(r) order by r.id) into v from (
      select e.id, e.invitation_id, e.event, e.detail, e.visitor_hash, e.created_at
      from public.invitation_events e) r;
    return coalesce(v, '[]'::jsonb);
  end if;
  return public.px_admin_export_v6(p_kind);
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
        'open_invitation', 'mark_invitation_shared', 'get_my_state'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.open_invitation(text, text) to anon, authenticated;
grant execute on function public.mark_invitation_shared(uuid, text) to authenticated;
grant execute on function public.get_my_state() to authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
grant execute on function public.admin_account_stats() to authenticated;
grant execute on function public.admin_names() to authenticated;
grant execute on function public.admin_moderate(text, uuid, text, text, text) to authenticated;
grant execute on function public.admin_method_stats() to authenticated;
