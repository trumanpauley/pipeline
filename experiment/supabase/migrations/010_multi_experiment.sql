-- The Pipeline Experiment — multiple experiments, "First L." names, connections.
--
-- Run after 009. Additive: no participant, link, answer or token is changed or
-- removed. Everything that exists today is placed in one default experiment
-- that behaves exactly as before.
--
-- Experiments
--   * experiments: name, description, invite instruction, invites per
--     participant, participant categories, active/paused.
--   * Every invitation belongs to exactly one experiment, fixed when it is
--     created (seed links: the admin's choice; referral links: the sender's
--     experiment). Token and experiment can never change afterwards, and
--     invitations can't be deleted, so a link always resolves to the same
--     experiment and a token is never reused.
--   * Pausing stops new joins and new links; nothing is deleted.
--
-- People and participations
--   * A participant row is now one person's membership in one experiment:
--     unique (user_id, experiment_id). The same login can join several
--     experiments without a second account. Identity is the auth user (and,
--     for duplicates, the browser), never name similarity.
--   * Server functions that act on "me" resolve it inside the experiment of the
--     invitation being opened/answered/accepted (transaction-local setting
--     px.experiment); elsewhere "me" is the participation the person last
--     joined or switched to (switch_experiment).
--
-- Connections
--   * Each accepted invitation is the participant's primary referral (their
--     place in the tree). Further invitations to someone already in the same
--     experiment are recorded as secondary connections (status 'duplicate'),
--     so the full graph is kept. View: public.connections (admin export).
--
-- Names
--   * New joins and inviter-typed names use "First L." (first name and last
--     initial, e.g. "James P."), normalised on the server. Full surnames are
--     rejected. Existing names are left as they are.

-- ---------------------------------------------------------------------------
-- Experiments
-- ---------------------------------------------------------------------------

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 600),
  invite_instruction text check (invite_instruction is null or char_length(invite_instruction) <= 200),
  invites_per_participant integer not null default 2 check (invites_per_participant between 1 and 10),
  categories jsonb not null default '[]'::jsonb check (jsonb_typeof(categories) = 'array'),
  status text not null default 'active' check (status in ('active', 'paused')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists experiments_one_default on public.experiments (is_default) where is_default;
create unique index if not exists experiments_name_idx on public.experiments (lower(name));

alter table public.experiments enable row level security;
create policy "Admins read experiments" on public.experiments for select to authenticated using (public.is_admin());
revoke all on public.experiments from anon, authenticated;
grant select on public.experiments to authenticated;

insert into public.experiments (name, invites_per_participant, is_default)
select 'The Pipeline Experiment',
       coalesce((select (value #>> '{}')::int from public.experiment_settings where key = 'max_invites'), 2),
       true
where not exists (select 1 from public.experiments where is_default);

-- ---------------------------------------------------------------------------
-- Participations and invitations belong to an experiment
-- ---------------------------------------------------------------------------

alter table public.participants
  add column if not exists experiment_id uuid references public.experiments(id),
  add column if not exists category text check (category is null or char_length(category) <= 40),
  add column if not exists focused_at timestamptz;

alter table public.invitations
  add column if not exists experiment_id uuid references public.experiments(id);

update public.participants set experiment_id = (select id from public.experiments where is_default)
  where experiment_id is null;
update public.invitations set experiment_id = (select id from public.experiments where is_default)
  where experiment_id is null;

alter table public.participants alter column experiment_id set not null;
alter table public.invitations alter column experiment_id set not null;

-- One membership per person per experiment (was: one per person).
alter table public.participants drop constraint if exists participants_user_id_key;
create unique index if not exists participants_user_experiment_idx on public.participants (user_id, experiment_id);
create index if not exists participants_experiment_idx on public.participants (experiment_id);
create index if not exists invitations_experiment_idx on public.invitations (experiment_id);

-- Where a new row belongs: a referral link → the sender's experiment; a seed
-- link → the experiment the admin chose (px.seed_experiment); a participant →
-- the experiment of the invitation they joined through.
create or replace function public.px_default_experiment()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.experiments where is_default
$$;

create or replace function public.px_invitation_experiment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.experiment_id := coalesce(
    new.experiment_id,
    (select experiment_id from public.participants where id = new.sender_id),
    nullif(current_setting('px.seed_experiment', true), '')::uuid,
    public.px_default_experiment());
  return new;
end $$;

create trigger invitations_experiment before insert on public.invitations
  for each row execute function public.px_invitation_experiment();

create or replace function public.px_participant_experiment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.experiment_id := coalesce(
    new.experiment_id,
    (select experiment_id from public.invitations where id = new.invitation_id),
    nullif(current_setting('px.experiment', true), '')::uuid,
    public.px_default_experiment());
  return new;
end $$;

create trigger participants_experiment before insert on public.participants
  for each row execute function public.px_participant_experiment();

-- Links are permanent: same token, same experiment, never deleted.
create or replace function public.px_invitation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invitations_are_permanent' using errcode = '42501';
  end if;
  if new.token is distinct from old.token or new.experiment_id is distinct from old.experiment_id then
    raise exception 'invitation_immutable' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger invitations_guard before update or delete on public.invitations
  for each row execute function public.px_invitation_guard();

create or replace function public.px_participant_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.experiment_id is distinct from old.experiment_id then
    raise exception 'participant_experiment_immutable' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger participants_guard before update on public.participants
  for each row execute function public.px_participant_guard();

-- ---------------------------------------------------------------------------
-- "Me" is per experiment; settings can be overridden per request
-- ---------------------------------------------------------------------------

create or replace function public.px_me()
returns public.participants language sql stable security definer set search_path = public as $$
  select p.* from public.participants p
  where p.user_id = auth.uid() and p.deleted_at is null
    and (nullif(current_setting('px.experiment', true), '') is null
         or p.experiment_id = nullif(current_setting('px.experiment', true), '')::uuid)
  order by greatest(p.created_at, coalesce(p.focused_at, p.created_at)) desc
  limit 1
$$;

-- Per-experiment values (e.g. invites per participant) are passed to the
-- existing functions as transaction-local overrides: px.s_<key>.
create or replace function public.px_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(current_setting('px.s_' || p_key, true), '')::jsonb,
    (select value from public.experiment_settings where key = p_key))
$$;

create or replace function public.px_scope(p_experiment uuid)
returns void language sql volatile security definer set search_path = public as $$
  select set_config('px.experiment', coalesce(p_experiment::text, ''), true)
$$;

create or replace function public.switch_experiment(p_experiment_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  update public.participants set focused_at = now()
    where user_id = auth.uid() and experiment_id = p_experiment_id and deleted_at is null;
  if not found then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Names: "First L."
-- ---------------------------------------------------------------------------

-- Returns the normalised "First L." form, or NULL if the input isn't a first
-- name (one or two words) followed by a single last initial. Capitalisation
-- is tidied ("james p" → "James P."); a typed full surname is rejected.
create or replace function public.px_format_name(p text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := public.px_tidy_name(p);
  m text[];
  f text;
  i text;
begin
  if v is null then return null; end if;
  m := regexp_match(v, '^([^\s.]+(?: [^\s.]+)?) ([^\s.''’ʼ-])\.?$');
  if m is null then return null; end if;
  f := m[1];
  i := m[2];
  if upper(i) = lower(i) or char_length(f) > 30 then return null; end if;
  if f = lower(f) or f = upper(f) then
    f := initcap(f);
  else
    f := upper(left(f, 1)) || substr(f, 2);
  end if;
  return f || ' ' || upper(i) || '.';
end $$;

-- ---------------------------------------------------------------------------
-- Opening, answering and accepting happen inside the link's experiment
-- ---------------------------------------------------------------------------

create or replace function public.px_experiment_public(e public.experiments)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'description', e.description,
    'invite_instruction', e.invite_instruction, 'categories', e.categories,
    'invites_per_participant', e.invites_per_participant,
    'status', e.status, 'is_default', e.is_default)
$$;

alter function public.open_invitation(text, text) rename to px_open_invitation_v9;

create or replace function public.open_invitation(p_token text, p_device text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  e public.experiments;
  me public.participants;
  v jsonb;
begin
  select * into inv from public.invitations where token = p_token;
  if found then
    select * into e from public.experiments where id = inv.experiment_id;
    perform public.px_scope(e.id);
    me := public.px_me();
    -- Paused: nothing changes (no open recorded, no method assigned).
    if e.status <> 'active' and not public.px_is_bot_ua(public.px_request_ua())
       and (me.id is null or inv.accepted_by is distinct from me.id) then
      return jsonb_build_object('state', 'paused');
    end if;
  end if;
  v := public.px_open_invitation_v9(p_token, p_device);
  if v ->> 'state' = 'ok' then
    v := v || jsonb_build_object('experiment', public.px_experiment_public(e));
  end if;
  return v;
end $$;

alter function public.answer_invitation(text, text, integer) rename to px_answer_invitation_v9;

create or replace function public.answer_invitation(p_token text, p_value text, p_response_ms integer default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
begin
  select * into inv from public.invitations where token = p_token;
  if found then
    perform public.px_scope(inv.experiment_id);
    if (select status from public.experiments where id = inv.experiment_id) <> 'active' then
      raise exception 'experiment_paused' using errcode = '22023';
    end if;
  end if;
  return public.px_answer_invitation_v9(p_token, p_value, p_response_ms);
end $$;

alter function public.log_classification_event(text, text, text, integer) rename to px_log_classification_event_v9;

create or replace function public.log_classification_event(
  p_direction text, p_event text, p_token text default null, p_elapsed_ms integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if p_direction = 'inbound' and p_token is not null then
    perform public.px_scope((select experiment_id from public.invitations where token = p_token));
  end if;
  return public.px_log_classification_event_v9(p_direction, p_event, p_token, p_elapsed_ms);
end $$;

alter function public.accept_invitation(text, text, boolean, boolean, text) rename to px_accept_invitation_v9;

create or replace function public.accept_invitation(
  p_token text,
  p_display_name text,
  p_research_consent boolean,
  p_marketing_consent boolean default false,
  p_device text default null,
  p_category text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  e public.experiments;
  me public.participants;
  sender public.participants;
  v_name text := p_display_name;
  v_category text;
  v_device text := public.px_hash(p_device);
  v jsonb;
begin
  select * into inv from public.invitations where token = p_token;
  if auth.uid() is null or not found then
    -- not_authenticated / invalid_invitation, exactly as before
    return public.px_accept_invitation_v9(p_token, p_display_name, p_research_consent, p_marketing_consent, p_device);
  end if;

  select * into e from public.experiments where id = inv.experiment_id;
  perform public.px_scope(e.id);
  me := public.px_me();
  if e.status <> 'active' and (me.id is null or inv.accepted_by is distinct from me.id) then
    raise exception 'experiment_paused' using errcode = '22023';
  end if;

  -- New to this experiment (possibly already in another one, same account).
  if me.id is null and inv.status in ('created', 'opened') then
    v_name := public.px_format_name(p_display_name);
    if v_name is null then
      return jsonb_build_object('error', 'invalid_name_format');
    end if;
    if jsonb_array_length(e.categories) > 0 then
      select c into v_category from jsonb_array_elements_text(e.categories) c
        where lower(c) = lower(btrim(coalesce(p_category, '')));
      if v_category is null then
        return jsonb_build_object('error', 'category_required');
      end if;
    end if;
    -- Browser checks, per experiment: the sender's browser can't accept their
    -- own link, and one browser holds one membership per experiment. (The same
    -- person joining a second experiment from their own browser is fine.)
    if coalesce((public.px_setting('block_same_device'))::boolean, true) and v_device is not null then
      if inv.sender_id is not null then
        select * into sender from public.participants where id = inv.sender_id;
        if sender.device_hash = v_device then
          raise exception 'self_invite' using errcode = '22023';
        end if;
      end if;
      if exists (select 1 from public.participants
                 where device_hash = v_device and deleted_at is null and experiment_id = e.id) then
        raise exception 'device_already_joined' using errcode = '22023';
      end if;
      perform set_config('px.s_block_same_device', 'false', true);
    end if;
  end if;

  v := public.px_accept_invitation_v9(p_token, v_name, p_research_consent, p_marketing_consent, p_device);
  perform set_config('px.s_block_same_device', '', true);

  if v ->> 'state' = 'joined' then
    update public.participants p set
      category = coalesce(v_category, p.category),
      -- A link from before "First L." names carried a first name only: adding
      -- the initial to it is a confirmation, not a correction.
      name_was_corrected = case
        when p.invited_name is not null and public.px_format_name(p.invited_name) is null
             and lower(p.confirmed_name) like lower(p.invited_name) || ' _.' then false
        else p.name_was_corrected end
      where p.user_id = auth.uid() and p.invitation_id = inv.id and p.deleted_at is null;
  end if;
  return v;
end $$;

-- Referral links: the sender's experiment, its invite limit, "First L." names.
alter function public.create_invitation(text, text, integer) rename to px_create_invitation_v9;

create or replace function public.create_invitation(
  p_value text,
  p_recipient_label text default null,
  p_response_ms integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  e public.experiments;
  v_label text := p_recipient_label;
  v jsonb;
begin
  if me.id is null then
    return public.px_create_invitation_v9(p_value, p_recipient_label, p_response_ms);
  end if;
  select * into e from public.experiments where id = me.experiment_id;
  perform public.px_scope(e.id);
  if e.status <> 'active' then
    raise exception 'experiment_paused' using errcode = '22023';
  end if;
  if public.px_tidy_name(p_recipient_label) is not null then
    v_label := public.px_format_name(p_recipient_label);
    if v_label is null then
      return jsonb_build_object('error', 'invalid_name_format');
    end if;
  end if;
  perform set_config('px.s_max_invites', e.invites_per_participant::text, true);
  perform set_config('px.s_max_links_total', greatest(
    coalesce((select (value #>> '{}')::int from public.experiment_settings where key = 'max_links_total'), 6),
    e.invites_per_participant * 3)::text, true);
  v := public.px_create_invitation_v9(p_value, v_label, p_response_ms);
  perform set_config('px.s_max_invites', '', true);
  perform set_config('px.s_max_links_total', '', true);
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Home screen: the current experiment, and the others this person is in
-- ---------------------------------------------------------------------------

alter function public.get_my_state() rename to px_get_my_state_v9;

create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_get_my_state_v9();
  me public.participants := public.px_me();
  e public.experiments;
begin
  if me.id is null then return v; end if;
  select * into e from public.experiments where id = me.experiment_id;
  v := jsonb_set(v, '{participant}', (v -> 'participant') || jsonb_build_object('category', me.category));
  return v || jsonb_build_object(
    'max_invites', e.invites_per_participant,
    'experiment', public.px_experiment_public(e),
    'experiments', (
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'current', x.id = e.id) order by p.created_at)
      from public.participants p join public.experiments x on x.id = p.experiment_id
      where p.user_id = auth.uid() and p.deleted_at is null),
    'network', jsonb_build_object(
      'participants', (select count(*) from public.participants where deleted_at is null and experiment_id = e.id),
      'generations', (select coalesce(max(depth), 0) from public.participants where experiment_id = e.id))
  );
end $$;

-- ---------------------------------------------------------------------------
-- Pipeline Community is per person, not per experiment
-- ---------------------------------------------------------------------------

create or replace function public.px_community_experiment()
returns uuid language sql stable security definer set search_path = public as $$
  select p.experiment_id from public.community_signups c
  join public.participants p on p.id = c.participant_id
  where p.user_id = auth.uid() and p.deleted_at is null
  limit 1
$$;

alter function public.join_community(text, boolean, boolean) rename to px_join_community_v9;

create or replace function public.join_community(p_email text, p_research_invites boolean, p_updates boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_scope(public.px_community_experiment());
  v := public.px_join_community_v9(p_email, p_research_invites, p_updates);
  perform public.px_scope(null);
  return v;
end $$;

alter function public.update_community_preferences(boolean, boolean) rename to px_update_community_preferences_v9;

create or replace function public.update_community_preferences(p_research_invites boolean, p_updates boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_scope(public.px_community_experiment());
  v := public.px_update_community_preferences_v9(p_research_invites, p_updates);
  perform public.px_scope(null);
  return v;
end $$;

alter function public.get_my_account() rename to px_get_my_account_v9;

create or replace function public.get_my_account()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_scope(public.px_community_experiment());
  v := public.px_get_my_account_v9();
  perform public.px_scope(null);
  return v || jsonb_build_object('community_prompt_dismissed', exists (
    select 1 from public.participants
    where user_id = auth.uid() and deleted_at is null and community_prompt_dismissed_at is not null));
end $$;

-- ---------------------------------------------------------------------------
-- Erasure covers every experiment the person is in
-- ---------------------------------------------------------------------------

-- Same as 001's, except the login itself is removed only once no membership is left.
create or replace function public.px_delete_my_data_core()
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
  if not exists (select 1 from public.participants where user_id = v_uid and deleted_at is null) then
    begin
      delete from auth.users where id = v_uid;
    exception when insufficient_privilege then
      null; -- participant data is already erased; the auth record can be removed from the dashboard
    end;
  end if;
  return jsonb_build_object('ok', true);
end $$;

alter function public.delete_my_data() rename to px_delete_my_data_v9;

create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
  v jsonb;
begin
  for r in select experiment_id from public.participants
           where user_id = auth.uid() and deleted_at is null
  loop
    perform public.px_scope(r.experiment_id);
    v := public.px_delete_my_data_v9();
  end loop;
  perform public.px_scope(null);
  -- No membership (or not signed in): the original behaviour.
  return coalesce(v, public.px_delete_my_data_v9());
end $$;

-- ---------------------------------------------------------------------------
-- Connections: primary referral + every further invitation (full graph)
-- ---------------------------------------------------------------------------

create or replace view public.connections with (security_invoker = true) as
select i.id as invitation_id, i.experiment_id, i.sender_id as inviter_id, i.accepted_by as invitee_id,
       (i.sender_id is null) as from_seed, (i.status = 'accepted') as is_primary, i.accepted_at as connected_at
from public.invitations i
where i.status in ('accepted', 'duplicate') and i.accepted_by is not null;

revoke all on public.connections from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin: experiments, seed links, analytics
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_experiment(
  p_id uuid,
  p_name text,
  p_description text,
  p_invite_instruction text,
  p_invites_per_participant integer,
  p_categories jsonb,
  p_status text
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := public.px_tidy_name(p_name);
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_instruction text := public.px_tidy_name(p_invite_instruction);
  v_categories jsonb;
  e public.experiments;
begin
  perform public.px_require_admin();
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'invalid_experiment_name' using errcode = '22023';
  end if;
  if char_length(coalesce(v_description, '')) > 600 or char_length(coalesce(v_instruction, '')) > 200 then
    raise exception 'invalid_experiment_text' using errcode = '22023';
  end if;
  if p_invites_per_participant is null or p_invites_per_participant not between 1 and 10 then
    raise exception 'invalid_invite_count' using errcode = '22023';
  end if;
  if coalesce(p_status, 'active') not in ('active', 'paused') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if p_categories is not null and jsonb_typeof(p_categories) <> 'array' then
    raise exception 'invalid_categories' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(d.c order by d.ord), '[]'::jsonb) into v_categories from (
    select distinct on (lower(t.c)) t.c, t.ord from (
      select public.px_tidy_name(x) as c, ord
      from jsonb_array_elements_text(coalesce(p_categories, '[]'::jsonb)) with ordinality as a(x, ord)) t
    where t.c is not null
    order by lower(t.c), t.ord) d;
  if jsonb_array_length(v_categories) > 8
     or exists (select 1 from jsonb_array_elements_text(v_categories) c where char_length(c) > 40) then
    raise exception 'invalid_categories' using errcode = '22023';
  end if;
  if exists (select 1 from public.experiments where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'experiment_name_taken' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.experiments (name, description, invite_instruction, invites_per_participant, categories, status)
    values (v_name, v_description, v_instruction, p_invites_per_participant, v_categories, coalesce(p_status, 'active'))
    returning * into e;
  else
    update public.experiments set
      name = v_name, description = v_description, invite_instruction = v_instruction,
      invites_per_participant = p_invites_per_participant, categories = v_categories,
      status = coalesce(p_status, status), updated_at = now()
    where id = p_id
    returning * into e;
    if not found then
      raise exception 'not_found' using errcode = '22023';
    end if;
  end if;
  return to_jsonb(e);
end $$;

create or replace function public.admin_create_experiment_seeds(
  p_experiment_id uuid, p_count integer, p_sender_name text, p_note text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if not exists (select 1 from public.experiments where id = p_experiment_id) then
    raise exception 'not_found' using errcode = '22023';
  end if;
  perform set_config('px.seed_experiment', p_experiment_id::text, true);
  v := public.admin_create_seed_invitations(p_count, p_sender_name, p_note);
  perform set_config('px.seed_experiment', '', true);
  return v;
end $$;

-- One row per experiment with its headline numbers (all from stored records).
create or replace function public.admin_experiments()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('stats', jsonb_build_object(
    'participants', (select count(*) from public.participants p where p.experiment_id = e.id and p.deleted_at is null),
    'people', (select count(distinct p.user_id) from public.participants p where p.experiment_id = e.id and p.deleted_at is null),
    'links_created', (select count(*) from public.invitations i where i.experiment_id = e.id),
    'seed_links', (select count(*) from public.invitations i where i.experiment_id = e.id and i.sender_id is null),
    'opened', (select count(*) from public.invitations i where i.experiment_id = e.id and i.opened_at is not null),
    'accepted', (select count(*) from public.invitations i where i.experiment_id = e.id and i.status = 'accepted'),
    'secondary_connections', (select count(*) from public.invitations i where i.experiment_id = e.id and i.status = 'duplicate'),
    -- First open → joined, in seconds (how long invitees take to respond).
    'median_response_s', (select round(percentile_cont(0.5) within group (
        order by extract(epoch from i.accepted_at - i.opened_at))::numeric, 1)
      from public.invitations i
      where i.experiment_id = e.id and i.status = 'accepted' and i.opened_at is not null),
    -- Link created → joined, in seconds (includes the time before it was sent).
    'median_link_to_join_s', (select round(percentile_cont(0.5) within group (
        order by extract(epoch from i.accepted_at - i.created_at))::numeric, 1)
      from public.invitations i where i.experiment_id = e.id and i.status = 'accepted'),
    'max_depth', (select coalesce(max(p.depth), 0) from public.participants p where p.experiment_id = e.id),
    'categories', (
      select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select coalesce(p.category, 'Not asked') as k, count(*) as n
        from public.participants p where p.experiment_id = e.id and p.deleted_at is null
        group by 1) c)
  )) order by e.is_default desc, e.created_at), '[]'::jsonb)
  into v from public.experiments e;
  return v;
end $$;

create or replace function public.admin_experiment_detail(p_experiment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return jsonb_build_object(
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
      from public.invitations s where s.sender_id is null and s.experiment_id = p_experiment_id), '[]'::jsonb),
    'tree', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'parent', x.parent_id, 'depth', x.depth, 'method', x.method,
        'category', x.category, 'deleted', x.deleted_at is not null) order by x.depth, x.created_at)
      from public.participants x where x.experiment_id = p_experiment_id), '[]'::jsonb),
    'secondary', coalesce((
      select jsonb_agg(jsonb_build_object('from', c.inviter_id, 'to', c.invitee_id))
      from public.connections c where c.experiment_id = p_experiment_id and not c.is_primary), '[]'::jsonb)
  );
end $$;

alter function public.admin_export(text) rename to px_admin_export_v9;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'experiments' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select e.id as experiment_id, e.name, e.description, e.invite_instruction, e.invites_per_participant,
        e.categories, e.status, e.is_default, e.created_at, e.updated_at
      from public.experiments e) r;
    return coalesce(v, '[]'::jsonb);
  elsif p_kind = 'connections' then
    -- person_key links one person's memberships across experiments (salted hash, no identity).
    select jsonb_agg(row_to_json(r) order by r.connected_at) into v from (
      select c.invitation_id, c.experiment_id, c.inviter_id, c.invitee_id,
        public.px_hash(si.user_id::text) as inviter_person_key,
        public.px_hash(ri.user_id::text) as invitee_person_key,
        c.from_seed, c.is_primary, c.connected_at
      from public.connections c
      left join public.participants si on si.id = c.inviter_id
      left join public.participants ri on ri.id = c.invitee_id) r;
    return coalesce(v, '[]'::jsonb);
  end if;
  v := public.px_admin_export_v9(p_kind);
  if p_kind = 'participants' then
    select coalesce(jsonb_agg(a.r || jsonb_build_object(
        'experiment_id', p.experiment_id, 'category', p.category,
        'person_key', public.px_hash(p.user_id::text)) order by a.ord), '[]'::jsonb) into v
    from jsonb_array_elements(v) with ordinality a(r, ord)
    left join public.participants p on p.id = (a.r ->> 'participant_id')::uuid;
  elsif p_kind = 'invitations' then
    select coalesce(jsonb_agg(a.r || jsonb_build_object('experiment_id', i.experiment_id) order by a.ord), '[]'::jsonb) into v
    from jsonb_array_elements(v) with ordinality a(r, ord)
    left join public.invitations i on i.id = (a.r ->> 'invitation_id')::uuid;
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
        'open_invitation', 'answer_invitation', 'accept_invitation', 'create_invitation',
        'log_classification_event', 'get_my_state', 'get_my_account', 'delete_my_data',
        'join_community', 'update_community_preferences', 'switch_experiment'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.open_invitation(text, text) to anon, authenticated;
grant execute on function public.answer_invitation(text, text, integer) to anon, authenticated;
grant execute on function public.log_classification_event(text, text, text, integer) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean, boolean, text, text) to authenticated;
grant execute on function public.create_invitation(text, text, integer) to authenticated;
grant execute on function public.get_my_state() to authenticated;
grant execute on function public.get_my_account() to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.join_community(text, boolean, boolean) to authenticated;
grant execute on function public.update_community_preferences(boolean, boolean) to authenticated;
grant execute on function public.switch_experiment(uuid) to authenticated;
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
grant execute on function public.admin_save_experiment(uuid, text, text, text, integer, jsonb, text) to authenticated;
grant execute on function public.admin_create_experiment_seeds(uuid, integer, text, text) to authenticated;
grant execute on function public.admin_experiments() to authenticated;
grant execute on function public.admin_experiment_detail(uuid) to authenticated;
