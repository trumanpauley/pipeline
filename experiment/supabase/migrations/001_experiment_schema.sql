-- The Pipeline Experiment — schema, row level security, and RPC functions.
--
-- Design notes
--   * Every write goes through a SECURITY DEFINER function below. Clients never
--     insert/update/delete tables directly; RLS only grants narrow reads.
--   * Invitation tokens are random 122-bit values, never sequential ids.
--   * A participant has exactly one parent (the invitation they accepted), and an
--     existing participant can never be re-parented, so referral loops are
--     structurally impossible.
--   * Tunable experiment parameters live in public.experiment_settings so they can
--     be changed from the Supabase table editor without a redeploy.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.experiment_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.experiment_settings (key, value, description) values
  ('methods', '["strength","context","comfort"]',
    'Classification methods eligible for random assignment to new participants.'),
  ('method_options', '{
      "strength": ["close_friend","acquaintance","weak"],
      "context":  ["class","team","club","work","social","other"],
      "comfort":  ["1","2","3","4","5"]
    }',
    'Allowed stored values for each method. Keep in sync with src/config/experiment.ts.'),
  ('max_invites', '2', 'Active invitation slots per participant.'),
  ('max_links_total', '6', 'Lifetime links a participant may generate (including revoked ones).'),
  ('unlock_on', '"created"',
    '"created": reveal unlocks when a link is generated. "accepted": when an invitee joins.'),
  ('reveals', '[
      {"title": "You''re part of Pipeline."},
      {"title": "Pipeline is building a better way to navigate the people and communities you''re connected to."}
    ]', 'Reveal copy, in unlock order.'),
  ('feedback_question', '"What makes it hard to ask someone for an introduction?"',
    'Optional question that unlocks both reveals without inviting.');

create table public.admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text,
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  parent_id uuid references public.participants(id) on delete set null,
  invitation_id uuid unique,
  depth integer not null check (depth >= 1),
  method text not null,
  research_consent_at timestamptz,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  reveal_level smallint not null default 0 check (reveal_level between 0 and 2),
  revealed_via text check (revealed_via in ('invite', 'feedback')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index participants_parent_idx on public.participants (parent_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  sender_id uuid references public.participants(id) on delete set null, -- null = seed invitation
  sender_name text,        -- name shown to the invitee (seed invitations only; otherwise sender.display_name)
  admin_note text,         -- private admin label for seed invitations
  recipient_label text check (recipient_label is null or char_length(recipient_label) <= 40), -- sender's private nickname
  status text not null default 'created'
    check (status in ('created', 'opened', 'accepted', 'duplicate', 'revoked')),
  assigned_method text,    -- set server-side, at random, on first open
  open_count integer not null default 0,
  opened_at timestamptz,
  answered_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.participants(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index invitations_sender_idx on public.invitations (sender_id);

alter table public.participants
  add constraint participants_invitation_fk
  foreign key (invitation_id) references public.invitations(id) on delete set null;

-- One row per (invitation, direction):
--   outbound = the sender classifying the recipient (before the link exists)
--   inbound  = the recipient classifying the sender (after opening the link)
create table public.classifications (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  rater_id uuid references public.participants(id) on delete cascade, -- null until an anonymous invitee joins
  method text not null,
  value text not null,
  response_ms integer check (response_ms is null or response_ms between 0 and 3600000),
  created_at timestamptz not null default now(),
  unique (invitation_id, direction)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  question text not null,
  answer text not null check (char_length(answer) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.px_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.experiment_settings where key = p_key
$$;

create or replace function public.px_new_token()
returns text language sql volatile set search_path = public as $$
  -- 122 bits from the server CSPRNG, base64url encoded (22 chars).
  select translate(rtrim(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_')
$$;

create or replace function public.px_me()
returns public.participants language sql stable security definer set search_path = public as $$
  select * from public.participants where user_id = auth.uid() and deleted_at is null
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    join auth.users u on lower(u.email) = a.email
    where u.id = auth.uid()
  )
$$;

create or replace function public.px_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.px_validate(p_method text, p_value text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_value is null or not coalesce(public.px_setting('method_options') -> p_method ? p_value, false) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
end $$;

-- Balanced randomization: choose uniformly among the enabled methods that have
-- been assigned least often, so small cohorts stay comparable.
create or replace function public.px_pick_method()
returns text language sql volatile security definer set search_path = public as $$
  select m
  from jsonb_array_elements_text(public.px_setting('methods')) m
  left join (
    select assigned_method, count(*) as c from public.invitations
    where assigned_method is not null group by 1
  ) x on x.assigned_method = m
  order by coalesce(x.c, 0), random()
  limit 1
$$;

create or replace function public.px_clamp_ms(p_ms integer)
returns integer language sql immutable as $$
  select case when p_ms is null or p_ms < 0 then null else least(p_ms, 3600000) end
$$;

-- ---------------------------------------------------------------------------
-- Participant RPCs
-- ---------------------------------------------------------------------------

-- Called when an invitation link is opened (signed in or not).
create or replace function public.open_invitation(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  me public.participants;
  sender public.participants;
begin
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

-- The invitee classifies their relationship with the sender. Works anonymously.
create or replace function public.answer_invitation(p_token text, p_value text, p_response_ms integer default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  me public.participants;
begin
  select * into inv from public.invitations where token = p_token for update;
  if not found or inv.status not in ('created', 'opened') or inv.assigned_method is null then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;
  perform public.px_validate(inv.assigned_method, p_value);
  me := public.px_me();

  insert into public.classifications (invitation_id, direction, rater_id, method, value, response_ms)
  values (inv.id, 'inbound', me.id, inv.assigned_method, p_value, public.px_clamp_ms(p_response_ms))
  on conflict (invitation_id, direction) do update
    set value = excluded.value, response_ms = excluded.response_ms,
        rater_id = excluded.rater_id, created_at = now();

  update public.invitations set answered_at = now() where id = inv.id;
  return jsonb_build_object('ok', true);
end $$;

-- Join the experiment through an invitation (requires a verified email session).
create or replace function public.accept_invitation(
  p_token text,
  p_display_name text,
  p_research_consent boolean,
  p_marketing_consent boolean default false
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  me public.participants;
  sender public.participants;
  v_email text;
  v_name text := nullif(btrim(p_display_name), '');
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
  if not coalesce(p_research_consent, false) then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) > 40 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- A deleted participant's tombstone keeps its old row; a fresh row is created.
  insert into public.participants (
    user_id, email, display_name, parent_id, invitation_id, depth, method,
    research_consent_at, marketing_consent, marketing_consent_at
  ) values (
    auth.uid(), lower(v_email), v_name, inv.sender_id, inv.id,
    coalesce(sender.depth, 0) + 1,
    coalesce(inv.assigned_method, public.px_pick_method()),
    now(), coalesce(p_marketing_consent, false),
    case when p_marketing_consent then now() end
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

-- Generate a referral link. The sender must classify the recipient first.
create or replace function public.create_invitation(
  p_value text,
  p_recipient_label text default null,
  p_response_ms integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants;
  inv public.invitations;
  v_active integer;
  v_total integer;
  v_label text := nullif(btrim(p_recipient_label), '');
begin
  me := public.px_me();
  if me.id is null then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  -- Serialize invitation creation per participant so limits can't be raced.
  perform 1 from public.participants where id = me.id for update;

  perform public.px_validate(me.method, p_value);
  if v_label is not null and char_length(v_label) > 40 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;

  select count(*) filter (where status in ('created', 'opened', 'accepted')), count(*)
    into v_active, v_total
    from public.invitations where sender_id = me.id;
  if v_active >= (public.px_setting('max_invites'))::int then
    raise exception 'invite_limit' using errcode = '22023';
  end if;
  if v_total >= (public.px_setting('max_links_total'))::int then
    raise exception 'link_limit' using errcode = '22023';
  end if;

  insert into public.invitations (token, sender_id, recipient_label)
  values (public.px_new_token(), me.id, v_label)
  returning * into inv;

  insert into public.classifications (invitation_id, direction, rater_id, method, value, response_ms)
  values (inv.id, 'outbound', me.id, me.method, p_value, public.px_clamp_ms(p_response_ms));

  if public.px_setting('unlock_on') #>> '{}' = 'created' then
    update public.participants set
      reveal_level = greatest(reveal_level, least(2, v_total + 1)),
      revealed_via = coalesce(revealed_via, 'invite')
    where id = me.id;
  end if;

  return jsonb_build_object('id', inv.id, 'token', inv.token);
end $$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  update public.invitations set status = 'revoked', revoked_at = now()
  where id = p_invitation_id and sender_id = me.id and status in ('created', 'opened');
  if not found then
    raise exception 'cannot_revoke' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Optional path to the reveals without inviting anyone.
create or replace function public.submit_feedback(p_answer text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_answer text := nullif(btrim(p_answer), '');
begin
  if me.id is null then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if v_answer is null or char_length(v_answer) > 1000 then
    raise exception 'invalid_answer' using errcode = '22023';
  end if;
  insert into public.feedback (participant_id, question, answer)
  values (me.id, public.px_setting('feedback_question') #>> '{}', v_answer);
  update public.participants
    set reveal_level = 2, revealed_via = coalesce(revealed_via, 'feedback')
    where id = me.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.set_marketing_consent(p_consent boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if me.id is null then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  update public.participants
    set marketing_consent = coalesce(p_consent, false),
        marketing_consent_at = case when p_consent then now() else null end
    where id = me.id;
  return jsonb_build_object('ok', true);
end $$;

-- Everything the participant home screen needs, in one round trip. Only the
-- participant's own data plus anonymous aggregates are returned.
create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_reveals jsonb := public.px_setting('reveals');
  v_branch jsonb;
begin
  if me.id is null then
    return jsonb_build_object('participant', null, 'is_admin', public.is_admin());
  end if;

  -- Descendants of me. Ids are replaced with opaque per-response keys; only my
  -- own private nicknames for my direct invitees are included.
  with recursive tree as (
    select p.id, p.parent_id, p.depth, p.invitation_id from public.participants p where p.id = me.id
    union all
    select c.id, c.parent_id, c.depth, c.invitation_id
    from public.participants c join tree t on c.parent_id = t.id
  ), keyed as (
    select t.*, row_number() over (order by t.depth, t.id) - 1 as k from tree t
  )
  select jsonb_agg(jsonb_build_object(
    'k', k1.k,
    'p', k2.k,
    'g', k1.depth - me.depth,
    'label', case when k1.parent_id = me.id then i.recipient_label end
  ) order by k1.k)
  into v_branch
  from keyed k1
  left join keyed k2 on k2.id = k1.parent_id and k1.id <> me.id
  left join public.invitations i on i.id = k1.invitation_id;

  return jsonb_build_object(
    'is_admin', public.is_admin(),
    'participant', jsonb_build_object(
      'display_name', me.display_name,
      'email', me.email,
      'method', me.method,
      'depth', me.depth,
      'reveal_level', me.reveal_level,
      'revealed_via', me.revealed_via,
      'marketing_consent', me.marketing_consent,
      'created_at', me.created_at
    ),
    'max_invites', (public.px_setting('max_invites'))::int,
    'feedback_question', public.px_setting('feedback_question') #>> '{}',
    'reveals', coalesce((
      select jsonb_agg(r.value order by r.ordinality)
      from jsonb_array_elements(v_reveals) with ordinality r
      where r.ordinality <= me.reveal_level), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'token', i.token, 'recipient_label', i.recipient_label,
        'status', i.status, 'created_at', i.created_at,
        'opened_at', i.opened_at, 'accepted_at', i.accepted_at) order by i.created_at)
      from public.invitations i
      where i.sender_id = me.id and i.status in ('created', 'opened', 'accepted')), '[]'::jsonb),
    'branch', v_branch,
    'network', jsonb_build_object(
      'participants', (select count(*) from public.participants where deleted_at is null),
      'generations', (select coalesce(max(depth), 0) from public.participants)
    )
  );
end $$;

-- Right to erasure: removes personal data and the participant's responses.
-- An anonymous structural node is kept so other people's branches stay intact.
create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if me.id is not null then
    delete from public.classifications where rater_id = me.id;
    delete from public.classifications c using public.invitations i
      where c.invitation_id = i.id and i.id = me.invitation_id and c.direction = 'inbound';
    delete from public.feedback where participant_id = me.id;
    update public.invitations set recipient_label = null where sender_id = me.id;
    update public.invitations set status = 'revoked', revoked_at = now()
      where sender_id = me.id and status in ('created', 'opened');
    update public.participants set
      user_id = null, email = null, display_name = null,
      research_consent_at = null, marketing_consent = false, marketing_consent_at = null,
      deleted_at = now()
    where id = me.id;
  end if;
  begin
    delete from auth.users where id = v_uid;
  exception when insufficient_privilege then
    null; -- participant data is already erased; the auth record can be removed from the dashboard
  end;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_seed_invitations(
  p_count integer, p_sender_name text, p_note text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_out jsonb := '[]'::jsonb;
  inv public.invitations;
begin
  perform public.px_require_admin();
  if p_count is null or p_count < 1 or p_count > 50 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  for i in 1..p_count loop
    insert into public.invitations (token, sender_name, admin_note)
    values (public.px_new_token(), nullif(btrim(p_sender_name), ''), nullif(btrim(p_note), ''))
    returning * into inv;
    v_out := v_out || jsonb_build_object('id', inv.id, 'token', inv.token);
  end loop;
  return v_out;
end $$;

create or replace function public.admin_revoke_invitation(p_invitation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  update public.invitations set status = 'revoked', revoked_at = now()
  where id = p_invitation_id and status in ('created', 'opened');
  return jsonb_build_object('ok', found);
end $$;

-- Strength on a 0..1 scale for cross-method comparison (context has none).
create or replace function public.px_strength_score(p_method text, p_value text)
returns numeric language sql immutable as $$
  select case p_method
    when 'strength' then case p_value when 'close_friend' then 1 when 'acquaintance' then 0.5 when 'weak' then 0 end
    when 'comfort' then (p_value::numeric - 1) / 4
  end
$$;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();

  with
  p as (select * from public.participants where deleted_at is null),
  i as (select * from public.invitations),
  c as (select * from public.classifications),
  pairs as (
    select i.id as invitation_id, o.method as out_method, o.value as out_value,
           n.method as in_method, n.value as in_value,
           public.px_strength_score(o.method, o.value) as out_score,
           public.px_strength_score(n.method, n.value) as in_score
    from i
    join c o on o.invitation_id = i.id and o.direction = 'outbound'
    join c n on n.invitation_id = i.id and n.direction = 'inbound'
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'participants', (select count(*) from p),
      'verified_emails', (select count(*) from p join auth.users u on u.id = p.user_id
                          where u.email_confirmed_at is not null),
      'marketing_opt_in', (select count(*) from p where marketing_consent),
      'deleted', (select count(*) from public.participants where deleted_at is not null),
      'seed_participants', (select count(*) from p where depth = 1),
      'max_depth', (select coalesce(max(depth), 0) from p),
      'feedback', (select count(*) from public.feedback)
    ),
    'invitations', jsonb_build_object(
      'generated', (select count(*) from i where sender_id is not null),
      'opened', (select count(*) from i where sender_id is not null and opened_at is not null),
      'answered', (select count(*) from i where sender_id is not null and answered_at is not null),
      'accepted', (select count(*) from i where sender_id is not null and status = 'accepted'),
      'duplicate', (select count(*) from i where status = 'duplicate'),
      'revoked', (select count(*) from i where status = 'revoked'),
      'seed_generated', (select count(*) from i where sender_id is null),
      'seed_opened', (select count(*) from i where sender_id is null and opened_at is not null),
      'seed_accepted', (select count(*) from i where sender_id is null and status = 'accepted')
    ),
    'by_depth', coalesce((
      select jsonb_agg(row_to_json(d) order by d.depth) from (
        select p.depth,
          count(*) as participants,
          count(*) filter (where exists (select 1 from i where i.sender_id = p.id)) as inviters,
          (select count(*) from i join public.participants s on s.id = i.sender_id
             where s.depth = p.depth) as links,
          (select count(*) from i join public.participants s on s.id = i.sender_id
             where s.depth = p.depth and i.opened_at is not null) as opened,
          (select count(*) from i join public.participants s on s.id = i.sender_id
             where s.depth = p.depth and i.status = 'accepted') as accepted
        from p group by p.depth) d), '[]'::jsonb),
    'distribution', coalesce((
      select jsonb_agg(row_to_json(x) order by x.method, x.direction, x.value) from (
        select method, direction, value, count(*) as n from c group by 1, 2, 3) x), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(row_to_json(m) order by m.method) from (
        select mm.method,
          (select count(*) from p where p.method = mm.method) as participants,
          (select count(*) from i where i.assigned_method = mm.method and i.opened_at is not null) as opened,
          (select count(*) from i where i.assigned_method = mm.method and i.answered_at is not null) as answered,
          (select count(*) from i where i.assigned_method = mm.method and i.status = 'accepted') as joined,
          (select count(*) from p where p.method = mm.method
             and exists (select 1 from i where i.sender_id = p.id)) as inviters,
          (select count(*) from i join p s on s.id = i.sender_id where s.method = mm.method) as links,
          (select count(*) from i join p s on s.id = i.sender_id
             where s.method = mm.method and i.status = 'accepted') as links_accepted,
          (select count(*) from p where p.method = mm.method and p.revealed_via = 'feedback') as chose_feedback,
          (select percentile_cont(0.5) within group (order by response_ms) from c
             where c.method = mm.method and c.direction = 'inbound') as median_ms_inbound,
          (select percentile_cont(0.5) within group (order by response_ms) from c
             where c.method = mm.method and c.direction = 'outbound') as median_ms_outbound
        from (select distinct jsonb_object_keys(public.px_setting('method_options')) as method) mm
      ) m), '[]'::jsonb),
    'reciprocity', jsonb_build_object(
      'pairs', (select count(*) from pairs),
      'same_method_pairs', (select count(*) from pairs where out_method = in_method),
      'same_method_exact_agreement', (select count(*) from pairs where out_method = in_method and out_value = in_value),
      'scored_pairs', (select count(*) from pairs where out_score is not null and in_score is not null),
      'mean_abs_score_gap', (select round(avg(abs(out_score - in_score)), 3) from pairs
                             where out_score is not null and in_score is not null),
      'mean_out_minus_in', (select round(avg(out_score - in_score), 3) from pairs
                            where out_score is not null and in_score is not null),
      'matrix', coalesce((select jsonb_agg(row_to_json(r)) from (
        select out_method, out_value, in_method, in_value, count(*) as n
        from pairs group by 1, 2, 3, 4 order by 1, 2, 3, 4) r), '[]'::jsonb)
    ),
    'seeds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'token', s.token, 'sender_name', s.sender_name, 'note', s.admin_note,
        'status', s.status, 'opened_at', s.opened_at, 'accepted_at', s.accepted_at,
        'created_at', s.created_at,
        'branch_size', (with recursive t as (
            select id from public.participants where invitation_id = s.id
            union all select c2.id from public.participants c2 join t on c2.parent_id = t.id)
          select count(*) from t)
      ) order by s.created_at desc)
      from i s where s.sender_id is null), '[]'::jsonb),
    'tree', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'parent', x.parent_id, 'depth', x.depth, 'method', x.method,
        'deleted', x.deleted_at is not null) order by x.depth, x.created_at)
      from public.participants x), '[]'::jsonb),
    'settings', (select jsonb_object_agg(key, value) from public.experiment_settings)
  ) into v;
  return v;
end $$;

-- Flat rows for CSV export. Only the participants export contains email.
create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'participants' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select p.id as participant_id, p.parent_id, p.depth, p.method, p.email,
        p.display_name, p.research_consent_at, p.marketing_consent, p.marketing_consent_at,
        p.reveal_level, p.revealed_via, p.created_at, p.deleted_at,
        (select count(*) from public.invitations i where i.sender_id = p.id) as links_generated,
        (select count(*) from public.invitations i where i.sender_id = p.id and i.status = 'accepted') as links_accepted
      from public.participants p) r;
  elsif p_kind = 'invitations' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select i.id as invitation_id, i.sender_id, (i.sender_id is null) as is_seed, i.admin_note,
        s.depth as sender_depth, s.method as sender_method, i.assigned_method as recipient_method,
        i.status, i.open_count, i.created_at, i.opened_at, i.answered_at, i.accepted_at,
        i.accepted_by, i.revoked_at
      from public.invitations i left join public.participants s on s.id = i.sender_id) r;
  elsif p_kind = 'classifications' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select c.id as classification_id, c.invitation_id, c.direction, c.rater_id, c.method,
        c.value, public.px_strength_score(c.method, c.value) as strength_score,
        c.response_ms, c.created_at
      from public.classifications c) r;
  elsif p_kind = 'reciprocal' then
    select jsonb_agg(row_to_json(r)) into v from (
      select i.id as invitation_id, i.sender_id, i.accepted_by as recipient_id,
        o.method as sender_method, o.value as sender_says,
        n.method as recipient_method, n.value as recipient_says,
        public.px_strength_score(o.method, o.value) as sender_score,
        public.px_strength_score(n.method, n.value) as recipient_score,
        i.status
      from public.invitations i
      join public.classifications o on o.invitation_id = i.id and o.direction = 'outbound'
      join public.classifications n on n.invitation_id = i.id and n.direction = 'inbound') r;
  elsif p_kind = 'feedback' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select f.id as feedback_id, f.participant_id, p.method, f.question, f.answer, f.created_at
      from public.feedback f join public.participants p on p.id = f.participant_id) r;
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  return coalesce(v, '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------

alter table public.experiment_settings enable row level security;
alter table public.admins enable row level security;
alter table public.participants enable row level security;
alter table public.invitations enable row level security;
alter table public.classifications enable row level security;
alter table public.feedback enable row level security;

create policy "Admins read settings" on public.experiment_settings for select to authenticated using (public.is_admin());
create policy "Admins update settings" on public.experiment_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admins read admins" on public.admins for select to authenticated using (public.is_admin());

create policy "Read own participant row" on public.participants for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "Read own sent invitations" on public.invitations for select to authenticated
  using (sender_id = (select id from public.px_me()) or public.is_admin());
create policy "Read own classifications" on public.classifications for select to authenticated
  using (rater_id = (select id from public.px_me()) or public.is_admin());
create policy "Read own feedback" on public.feedback for select to authenticated
  using (participant_id = (select id from public.px_me()) or public.is_admin());

-- Defense in depth: no direct writes, and nothing at all for anonymous visitors.
revoke all on public.experiment_settings, public.admins, public.participants,
  public.invitations, public.classifications, public.feedback from anon, authenticated;
grant select on public.participants, public.invitations, public.classifications,
  public.feedback, public.admins, public.experiment_settings to authenticated;
grant update (value, updated_at) on public.experiment_settings to authenticated;

-- Functions: Supabase grants EXECUTE on new functions to anon by default, so
-- revoke everything this migration defines and grant back explicitly below.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'px\_%' or p.proname like 'admin\_%' or p.proname in (
        'is_admin', 'open_invitation', 'answer_invitation', 'accept_invitation',
        'create_invitation', 'revoke_invitation', 'submit_feedback',
        'set_marketing_consent', 'get_my_state', 'delete_my_data'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.open_invitation(text) to anon, authenticated;
grant execute on function public.answer_invitation(text, text, integer) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean, boolean) to authenticated;
grant execute on function public.create_invitation(text, text, integer) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.submit_feedback(text) to authenticated;
grant execute on function public.set_marketing_consent(boolean) to authenticated;
grant execute on function public.get_my_state() to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
