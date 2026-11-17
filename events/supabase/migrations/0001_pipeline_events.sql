-- Pipeline Events — schema, RLS and server-side functions.
-- Run in the SQL editor of the *Pipeline Events* Supabase project
-- (a separate project from the Pipeline networking app).
--
-- Every write goes through a security-definer function below. Tables have RLS
-- enabled with select-only policies; there are no insert/update/delete policies.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,64}$'),
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  location_name text not null default '',
  -- Only shown to guests who have RSVP'd (exact address, door code, etc.)
  private_details text not null default '',
  capacity integer not null default 400 check (capacity between 1 and 400),
  rsvp_open boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.event_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role text not null default 'guest' check (role in ('host', 'guest')),
  full_name text not null check (length(full_name) between 1 and 100),
  email text check (email is null or email = lower(email)),
  rsvp_status text not null default 'attending' check (rsvp_status in ('attending', 'declined')),
  rsvp_updated_at timestamptz not null default now(),
  depth integer not null default 0 check (depth >= 0),
  created_at timestamptz not null default now(),
  anonymized_at timestamptz,
  check (anonymized_at is not null or email is not null)
);

create unique index event_guests_event_user_idx on public.event_guests (event_id, user_id) where user_id is not null;
create unique index event_guests_event_email_idx on public.event_guests (event_id, email) where email is not null;
create index event_guests_user_idx on public.event_guests (user_id);
create index event_guests_email_idx on public.event_guests (email);

create table public.event_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  inviter_guest_id uuid not null references public.event_guests(id) on delete cascade,
  slot integer not null check (slot >= 1),
  token text not null unique check (length(token) >= 20),
  status text not null default 'open' check (status in ('open', 'accepted', 'revoked')),
  accepted_guest_id uuid unique references public.event_guests(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  token_rotated_at timestamptz,
  unique (inviter_guest_id, slot),
  check ((status = 'accepted') = (accepted_at is not null))
);

create index event_invitations_event_idx on public.event_invitations (event_id);

-- The referral graph. Kept separate from invitations so it can be queried and
-- visualised directly, and separate from any permanent Pipeline relationship.
create table public.event_referrals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  inviter_guest_id uuid not null references public.event_guests(id) on delete cascade,
  invitee_guest_id uuid not null unique references public.event_guests(id) on delete cascade,
  invitation_id uuid not null unique references public.event_invitations(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (inviter_guest_id <> invitee_guest_id)
);

create index event_referrals_inviter_idx on public.event_referrals (inviter_guest_id);
create index event_referrals_event_idx on public.event_referrals (event_id);

create table public.event_consent_texts (
  id text primary key,
  consent_type text not null check (consent_type in ('event_rsvp', 'pipeline_marketing')),
  body text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index event_consent_texts_current_idx on public.event_consent_texts (consent_type) where is_current;

-- Append-only consent log: each decision is a new row.
create table public.event_consents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  guest_id uuid not null references public.event_guests(id) on delete cascade,
  consent_text_id text not null references public.event_consent_texts(id),
  consent_type text not null check (consent_type in ('event_rsvp', 'pipeline_marketing')),
  granted boolean not null,
  source text not null check (source in ('rsvp_form', 'dashboard', 'removal', 'admin')),
  created_at timestamptz not null default now()
);

create index event_consents_guest_idx on public.event_consents (guest_id, consent_type, created_at desc);

create table public.event_removal_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  guest_id uuid not null references public.event_guests(id) on delete cascade,
  note text not null default '' check (length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'completed', 'dismissed')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null
);

create unique index event_removal_requests_pending_idx on public.event_removal_requests (guest_id) where status = 'pending';

insert into public.event_consent_texts (id, consent_type, body, is_current) values
  ('event_rsvp.v1', 'event_rsvp',
   'To run this event, the organizer stores your name, email address, RSVP and who invited you. Other guests can see your name but never your email address. You can ask for your information to be removed at any time.',
   true),
  ('pipeline_marketing.v1', 'pipeline_marketing',
   'Yes, email me about future Pipeline events and invite me to the Pipeline beta. I can unsubscribe at any time.',
   true);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Server-side two-invitation limit for guests (hosts may mint more).
create or replace function public.event_invitations_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
  v_event uuid;
begin
  select role, event_id into v_role, v_event
  from public.event_guests where id = new.inviter_guest_id;

  if v_event is distinct from new.event_id then
    raise exception 'Inviter does not belong to this event';
  end if;
  if v_role = 'guest' and new.slot > 2 then
    raise exception 'Guests may hold at most two invitations';
  end if;
  return new;
end;
$$;

create trigger event_invitations_enforce_limit
before insert or update of slot, inviter_guest_id, event_id on public.event_invitations
for each row execute function public.event_invitations_enforce_limit();

-- Consent log is append-only, even for the table owner's functions.
create or replace function public.event_consents_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'event_consents is append-only';
end;
$$;

create trigger event_consents_append_only
before update on public.event_consents
for each row execute function public.event_consents_append_only();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- 144-bit url-safe token.
create or replace function public.event_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
$$;

-- The caller's email, only if Supabase has confirmed they own it.
create or replace function public.event_verified_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
    and u.email is not null
    and u.email_confirmed_at is not null;
$$;

-- Links guest rows to the current auth user by verified email (reclaim on a
-- new device / after the auth user was recreated). Returns nothing.
create or replace function public.event_link_my_guest_rows()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.event_verified_email();
begin
  if v_email is null then
    return;
  end if;
  update public.event_guests g
     set user_id = auth.uid()
   where g.email = v_email
     and g.anonymized_at is null
     and g.user_id is distinct from auth.uid()
     and not exists (
       select 1 from public.event_guests o
        where o.event_id = g.event_id and o.user_id = auth.uid()
     );
end;
$$;

create or replace function public.event_is_host(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_guests g
     where g.event_id = p_event_id
       and g.user_id = auth.uid()
       and g.role = 'host'
       and g.anonymized_at is null
  );
$$;

create or replace function public.event_my_guest_id(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id from public.event_guests g
   where g.event_id = p_event_id and g.user_id = auth.uid() and g.anonymized_at is null;
$$;

create or replace function public.event_attending_count(p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.event_guests
   where event_id = p_event_id and rsvp_status = 'attending';
$$;

-- ---------------------------------------------------------------------------
-- Public (anon) RPC: invitation landing page
-- ---------------------------------------------------------------------------

create or replace function public.get_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.event_invitations;
  v_event public.events;
  v_inviter public.event_guests;
  v_status text;
begin
  if p_token is null or length(p_token) not between 20 and 64 then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_inv from public.event_invitations where token = p_token;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_event from public.events where id = v_inv.event_id;
  select * into v_inviter from public.event_guests where id = v_inv.inviter_guest_id;

  v_status := case
    when v_inv.status = 'accepted' then 'used'
    when v_inv.status = 'revoked' then 'not_found'
    when not v_event.rsvp_open then 'closed'
    when public.event_attending_count(v_event.id) >= v_event.capacity then 'full'
    else 'open'
  end;

  if v_status = 'not_found' then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', v_status,
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'description', v_event.description,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'location_name', v_event.location_name
    ),
    'inviter_name', case when v_inviter.anonymized_at is null then v_inviter.full_name else 'A guest' end,
    'consent_texts', (
      select jsonb_object_agg(consent_type, jsonb_build_object('id', id, 'body', body))
        from public.event_consent_texts where is_current
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Authenticated RPCs: guests
-- ---------------------------------------------------------------------------

-- Accept an invitation. Safe under concurrency: the event row lock serialises
-- capacity checks; the invitation row lock makes the link single-use.
create or replace function public.accept_invitation(
  p_token text,
  p_full_name text,
  p_marketing_consent boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.event_verified_email();
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_inv public.event_invitations;
  v_event public.events;
  v_inviter public.event_guests;
  v_existing public.event_guests;
  v_guest_id uuid;
  v_rsvp_text text;
  v_marketing_text text;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'Please verify your email address first' using errcode = '28000';
  end if;
  if length(v_name) not between 1 and 100 then
    raise exception 'Please enter your full name' using errcode = '22023';
  end if;

  -- Find the event without locking the invitation yet (lock order: event → invitation).
  select * into v_inv from public.event_invitations where token = p_token;
  if not found or v_inv.status = 'revoked' then
    raise exception 'This invitation link is not valid' using errcode = 'P0002';
  end if;

  select * into v_event from public.events where id = v_inv.event_id for update;

  -- Already a guest of this event? Return them without consuming the link.
  perform public.event_link_my_guest_rows();
  select * into v_existing from public.event_guests
   where event_id = v_event.id and (user_id = auth.uid() or email = v_email)
   limit 1;
  if found then
    return jsonb_build_object('result', 'already_guest', 'event_id', v_event.id, 'guest_id', v_existing.id);
  end if;

  select * into v_inv from public.event_invitations where id = v_inv.id for update;
  if v_inv.status = 'revoked' then
    raise exception 'This invitation link is not valid' using errcode = 'P0002';
  elsif v_inv.status <> 'open' then
    raise exception 'This invitation has already been used' using errcode = 'P0001';
  end if;
  if not v_event.rsvp_open then
    raise exception 'RSVPs for this event are closed' using errcode = 'P0001';
  end if;
  if public.event_attending_count(v_event.id) >= v_event.capacity then
    raise exception 'This event is at capacity' using errcode = 'P0001';
  end if;

  select * into v_inviter from public.event_guests where id = v_inv.inviter_guest_id;

  insert into public.event_guests (event_id, user_id, role, full_name, email, depth)
  values (v_event.id, auth.uid(), 'guest', v_name, v_email, v_inviter.depth + 1)
  returning id into v_guest_id;

  update public.event_invitations
     set status = 'accepted', accepted_guest_id = v_guest_id, accepted_at = now()
   where id = v_inv.id;

  insert into public.event_referrals (event_id, inviter_guest_id, invitee_guest_id, invitation_id)
  values (v_event.id, v_inviter.id, v_guest_id, v_inv.id);

  select id into v_rsvp_text from public.event_consent_texts where consent_type = 'event_rsvp' and is_current;
  select id into v_marketing_text from public.event_consent_texts where consent_type = 'pipeline_marketing' and is_current;

  insert into public.event_consents (event_id, guest_id, consent_text_id, consent_type, granted, source) values
    (v_event.id, v_guest_id, v_rsvp_text, 'event_rsvp', true, 'rsvp_form'),
    (v_event.id, v_guest_id, v_marketing_text, 'pipeline_marketing', coalesce(p_marketing_consent, false), 'rsvp_form');

  insert into public.event_invitations (event_id, inviter_guest_id, slot, token) values
    (v_event.id, v_guest_id, 1, public.event_new_token()),
    (v_event.id, v_guest_id, 2, public.event_new_token());

  return jsonb_build_object('result', 'accepted', 'event_id', v_event.id, 'guest_id', v_guest_id);
end;
$$;

-- Events the caller belongs to (also links guest rows by verified email).
create or replace function public.my_events()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  perform public.event_link_my_guest_rows();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'event_id', e.id, 'name', e.name, 'starts_at', e.starts_at,
             'role', g.role, 'rsvp_status', g.rsvp_status)
           order by e.starts_at nulls last)
      from public.event_guests g
      join public.events e on e.id = g.event_id
     where g.user_id = auth.uid() and g.anonymized_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.guest_dashboard(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest public.event_guests;
  v_event public.events;
begin
  perform public.event_link_my_guest_rows();
  select * into v_guest from public.event_guests
   where event_id = p_event_id and user_id = auth.uid() and anonymized_at is null;
  if not found then
    raise exception 'You are not on the guest list for this event' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id, 'name', v_event.name, 'description', v_event.description,
      'starts_at', v_event.starts_at, 'ends_at', v_event.ends_at,
      'location_name', v_event.location_name, 'private_details', v_event.private_details,
      'rsvp_open', v_event.rsvp_open
    ),
    'guest', jsonb_build_object(
      'id', v_guest.id, 'full_name', v_guest.full_name, 'email', v_guest.email,
      'role', v_guest.role, 'rsvp_status', v_guest.rsvp_status, 'depth', v_guest.depth,
      'created_at', v_guest.created_at
    ),
    -- Path from the guest up to the host: names only, never emails.
    'path', (
      with recursive chain as (
        select v_guest.id as guest_id, 0 as step
        union all
        select r.inviter_guest_id, c.step + 1
          from chain c
          join public.event_referrals r on r.invitee_guest_id = c.guest_id
         where c.step < 1000
      )
      select jsonb_agg(jsonb_build_object(
               'name', case when g.anonymized_at is null then g.full_name else 'Removed guest' end,
               'role', g.role,
               'is_you', g.id = v_guest.id)
             order by c.step desc)
        from chain c join public.event_guests g on g.id = c.guest_id
    ),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'slot', i.slot, 'status', i.status,
               'token', case when i.status = 'open' then i.token end,
               'accepted_at', i.accepted_at,
               'accepted_name', case when a.anonymized_at is null then a.full_name else 'Removed guest' end)
             order by i.slot)
        from public.event_invitations i
        left join public.event_guests a on a.id = i.accepted_guest_id
       where i.inviter_guest_id = v_guest.id
    ), '[]'::jsonb),
    'marketing_consent', coalesce((
      select c.granted from public.event_consents c
       where c.guest_id = v_guest.id and c.consent_type = 'pipeline_marketing'
       order by c.created_at desc, c.id desc limit 1
    ), false),
    'marketing_consent_text', (
      select body from public.event_consent_texts where consent_type = 'pipeline_marketing' and is_current
    ),
    'removal_requested', exists (
      select 1 from public.event_removal_requests r where r.guest_id = v_guest.id and r.status = 'pending'
    )
  );
end;
$$;

-- Replace the token of an unused invitation (e.g. sent to the wrong person).
create or replace function public.rotate_invitation(p_invitation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := public.event_new_token();
begin
  update public.event_invitations i
     set token = v_token, token_rotated_at = now()
   where i.id = p_invitation_id
     and i.status = 'open'
     and i.inviter_guest_id = public.event_my_guest_id(i.event_id);
  if not found then
    raise exception 'Only your own unused invitations can be reset' using errcode = '42501';
  end if;
  return v_token;
end;
$$;

create or replace function public.set_rsvp_status(p_event_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest public.event_guests;
  v_event public.events;
begin
  if p_status not in ('attending', 'declined') then
    raise exception 'Invalid RSVP status' using errcode = '22023';
  end if;
  select * into v_event from public.events where id = p_event_id for update;
  select * into v_guest from public.event_guests
   where event_id = p_event_id and user_id = auth.uid() and anonymized_at is null
   for update;
  if not found then
    raise exception 'You are not on the guest list for this event' using errcode = '42501';
  end if;
  if p_status = v_guest.rsvp_status then
    return p_status;
  end if;
  if p_status = 'attending' and public.event_attending_count(p_event_id) >= v_event.capacity then
    raise exception 'This event is at capacity' using errcode = 'P0001';
  end if;
  update public.event_guests set rsvp_status = p_status, rsvp_updated_at = now() where id = v_guest.id;
  return p_status;
end;
$$;

create or replace function public.set_marketing_consent(p_event_id uuid, p_granted boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest_id uuid := public.event_my_guest_id(p_event_id);
begin
  if v_guest_id is null or p_granted is null then
    raise exception 'You are not on the guest list for this event' using errcode = '42501';
  end if;
  insert into public.event_consents (event_id, guest_id, consent_text_id, consent_type, granted, source)
  select p_event_id, v_guest_id, t.id, 'pipeline_marketing', p_granted, 'dashboard'
    from public.event_consent_texts t where t.consent_type = 'pipeline_marketing' and t.is_current;
  return p_granted;
end;
$$;

create or replace function public.request_data_removal(p_event_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest_id uuid := public.event_my_guest_id(p_event_id);
begin
  if v_guest_id is null then
    raise exception 'You are not on the guest list for this event' using errcode = '42501';
  end if;
  insert into public.event_removal_requests (event_id, guest_id, note)
  values (p_event_id, v_guest_id, left(coalesce(p_note, ''), 1000))
  on conflict (guest_id) where status = 'pending' do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Authenticated RPCs: hosts (organizers)
-- ---------------------------------------------------------------------------

create or replace function public.organizer_create_invitations(p_event_id uuid, p_count integer)
returns setof public.event_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_id uuid;
  v_next integer;
begin
  perform public.event_link_my_guest_rows();
  v_host_id := public.event_my_guest_id(p_event_id);
  if not public.event_is_host(p_event_id) then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
  if p_count is null or p_count not between 1 and 50 then
    raise exception 'Create between 1 and 50 invitations at a time' using errcode = '22023';
  end if;
  -- Serialise slot allocation for this host.
  perform 1 from public.event_guests where id = v_host_id for update;
  select coalesce(max(slot), 0) + 1 into v_next from public.event_invitations where inviter_guest_id = v_host_id;
  return query
    insert into public.event_invitations (event_id, inviter_guest_id, slot, token)
    select p_event_id, v_host_id, v_next + n, public.event_new_token()
      from generate_series(0, p_count - 1) n
    returning *;
end;
$$;

create or replace function public.organizer_set_rsvp_open(p_event_id uuid, p_open boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.event_is_host(p_event_id) then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
  update public.events set rsvp_open = coalesce(p_open, false) where id = p_event_id;
  return coalesce(p_open, false);
end;
$$;

-- action: 'complete' (anonymise guest) or 'dismiss'.
create or replace function public.organizer_process_removal(p_request_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.event_removal_requests;
begin
  select * into v_req from public.event_removal_requests where id = p_request_id for update;
  if not found or not public.event_is_host(v_req.event_id) then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    return;
  end if;
  if p_action not in ('complete', 'dismiss') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;

  if p_action = 'complete' then
    if exists (select 1 from public.event_guests where id = v_req.guest_id and role = 'host') then
      raise exception 'Remove a host by editing the event in the SQL editor' using errcode = 'P0001';
    end if;

    insert into public.event_consents (event_id, guest_id, consent_text_id, consent_type, granted, source)
    select v_req.event_id, v_req.guest_id, t.id, 'pipeline_marketing', false, 'removal'
      from public.event_consent_texts t where t.consent_type = 'pipeline_marketing' and t.is_current;

    update public.event_invitations set status = 'revoked'
     where inviter_guest_id = v_req.guest_id and status = 'open';

    update public.event_guests
       set full_name = 'Removed guest', email = null, user_id = null,
           rsvp_status = 'declined', rsvp_updated_at = now(), anonymized_at = now()
     where id = v_req.guest_id;
  end if;

  update public.event_removal_requests
     set status = case when p_action = 'complete' then 'completed' else 'dismissed' end,
         processed_at = now(), processed_by = auth.uid()
   where id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin (SQL editor only): create an event and its host.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_event(
  p_slug text,
  p_name text,
  p_host_email text,
  p_host_name text,
  p_starts_at timestamptz default null,
  p_location_name text default '',
  p_description text default '',
  p_private_details text default '',
  p_capacity integer default 400
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_email text := lower(btrim(p_host_email));
begin
  insert into public.events (slug, name, starts_at, location_name, description, private_details, capacity)
  values (p_slug, p_name, p_starts_at, coalesce(p_location_name, ''), coalesce(p_description, ''),
          coalesce(p_private_details, ''), p_capacity)
  returning id into v_event_id;

  insert into public.event_guests (event_id, user_id, role, full_name, email, depth)
  values (v_event_id, (select id from auth.users where lower(email) = v_email limit 1),
          'host', btrim(p_host_name), v_email, 0);

  return v_event_id;
end;
$$;

-- Add a co-host to an existing event (SQL editor only).
create or replace function public.admin_add_host(p_event_id uuid, p_email text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_email text := lower(btrim(p_email));
begin
  insert into public.event_guests (event_id, user_id, role, full_name, email, depth)
  values (p_event_id, (select id from auth.users where lower(email) = v_email limit 1),
          'host', btrim(p_name), v_email, 0)
  on conflict (event_id, email) where email is not null do update set role = 'host', depth = 0
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security (select-only; writes go through the functions above)
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.event_guests enable row level security;
alter table public.event_invitations enable row level security;
alter table public.event_referrals enable row level security;
alter table public.event_consent_texts enable row level security;
alter table public.event_consents enable row level security;
alter table public.event_removal_requests enable row level security;

create policy "Members read their events" on public.events for select to authenticated
  using (public.event_my_guest_id(id) is not null);

create policy "Guests read own row" on public.event_guests for select to authenticated
  using (user_id = auth.uid());
create policy "Hosts read event guests" on public.event_guests for select to authenticated
  using (public.event_is_host(event_id));

create policy "Guests read own invitations" on public.event_invitations for select to authenticated
  using (inviter_guest_id = public.event_my_guest_id(event_id));
create policy "Hosts read event invitations" on public.event_invitations for select to authenticated
  using (public.event_is_host(event_id));

create policy "Hosts read referrals" on public.event_referrals for select to authenticated
  using (public.event_is_host(event_id));

create policy "Read consent texts" on public.event_consent_texts for select to anon, authenticated
  using (true);

create policy "Guests read own consents" on public.event_consents for select to authenticated
  using (guest_id = public.event_my_guest_id(event_id));
create policy "Hosts read event consents" on public.event_consents for select to authenticated
  using (public.event_is_host(event_id));

create policy "Guests read own removal requests" on public.event_removal_requests for select to authenticated
  using (guest_id = public.event_my_guest_id(event_id));
create policy "Hosts read removal requests" on public.event_removal_requests for select to authenticated
  using (public.event_is_host(event_id));

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants broad table privileges to anon/authenticated by
-- default; tighten to select-only and lock down function execution.
-- ---------------------------------------------------------------------------

revoke all on public.events, public.event_guests, public.event_invitations, public.event_referrals,
  public.event_consent_texts, public.event_consents, public.event_removal_requests
  from anon, authenticated;
grant select on public.events, public.event_guests, public.event_invitations, public.event_referrals,
  public.event_consents, public.event_removal_requests to authenticated;
grant select on public.event_consent_texts to anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_invitation(text) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean) to authenticated;
grant execute on function public.my_events() to authenticated;
grant execute on function public.guest_dashboard(uuid) to authenticated;
grant execute on function public.rotate_invitation(uuid) to authenticated;
grant execute on function public.set_rsvp_status(uuid, text) to authenticated;
grant execute on function public.set_marketing_consent(uuid, boolean) to authenticated;
grant execute on function public.request_data_removal(uuid, text) to authenticated;
grant execute on function public.organizer_create_invitations(uuid, integer) to authenticated;
grant execute on function public.organizer_set_rsvp_open(uuid, boolean) to authenticated;
grant execute on function public.organizer_process_removal(uuid, text) to authenticated;
-- Used inside RLS policies, so the querying role must be able to execute them.
grant execute on function public.event_is_host(uuid) to authenticated;
grant execute on function public.event_my_guest_id(uuid) to authenticated;

-- Future functions in this schema are not executable by API roles by default.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
