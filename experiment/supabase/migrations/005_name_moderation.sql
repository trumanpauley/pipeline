-- The Pipeline Experiment — name validation, moderation and name privacy.
--
-- Run after 004. Additive: no existing name, link, participant or answer is
-- changed. Existing names start as "ok" and can be reviewed in the admin
-- dashboard.
--
-- Rules are enforced here, in the database, so they apply to the app *and* to
-- anyone calling the Supabase API directly (participants can't write tables;
-- every write goes through these functions).
--
--   * Names (a participant's own name, invitee names, seed sender names) must
--     pass public.px_name_problem(): length, characters, URLs/spam, and a small
--     editable term list (public.moderation_terms).
--   * Invitation landing pages show the sender's FIRST name only, and only when
--     the name is approved (name_status = 'ok') and the sender isn't suspended.
--   * Admins can flag / approve / hide / replace names and suspend participants;
--     every action is written to public.moderation_actions.

-- ---------------------------------------------------------------------------
-- Columns, tables, settings
-- ---------------------------------------------------------------------------

alter table public.participants
  add column if not exists name_status text not null default 'ok'
    check (name_status in ('ok', 'pending', 'flagged', 'hidden')),
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text;

alter table public.invitations
  add column if not exists label_status text not null default 'ok'
    check (label_status in ('ok', 'flagged', 'hidden'));

-- Terms that make a name unacceptable. "word" matches a whole word (or the whole
-- name with spaces/punctuation removed, so "f u c k" is caught); "substring"
-- matches anywhere and is reserved for terms no real name contains. Many
-- short terms are deliberately absent because they occur inside real names
-- (e.g. Kshitij, Shital, Cassandra, Hassan, Analisa, Nazira; "Kike" is a common
-- nickname for Enrique). Edit in Supabase → Table editor.
create table public.moderation_terms (
  term text primary key check (term = lower(term) and term !~ '\s'),
  match text not null default 'word' check (match in ('word', 'substring')),
  kind text not null default 'profanity' check (kind in ('profanity', 'slur', 'explicit', 'reserved', 'spam'))
);

insert into public.moderation_terms (term, match, kind) values
  -- unambiguous: match anywhere
  ('fuck', 'substring', 'profanity'), ('motherfuck', 'substring', 'profanity'), ('bitch', 'substring', 'profanity'),
  ('asshole', 'substring', 'profanity'), ('nigger', 'substring', 'slur'), ('nigga', 'substring', 'slur'),
  ('faggot', 'substring', 'slur'), ('cumshot', 'substring', 'explicit'), ('blowjob', 'substring', 'explicit'),
  ('handjob', 'substring', 'explicit'), ('dildo', 'substring', 'explicit'), ('pornhub', 'substring', 'explicit'),
  ('onlyfans', 'substring', 'spam'), ('hitler', 'substring', 'slur'), ('pipeline', 'substring', 'reserved'),
  -- whole words only
  ('shit', 'word', 'profanity'), ('shithead', 'word', 'profanity'), ('cunt', 'word', 'profanity'),
  ('ass', 'word', 'profanity'), ('arse', 'word', 'profanity'), ('twat', 'word', 'profanity'),
  ('prick', 'word', 'profanity'), ('wank', 'word', 'profanity'), ('wanker', 'word', 'profanity'),
  ('bollocks', 'word', 'profanity'), ('piss', 'word', 'profanity'), ('bastard', 'word', 'profanity'),
  ('slut', 'word', 'explicit'), ('whore', 'word', 'explicit'), ('porn', 'word', 'explicit'),
  ('porno', 'word', 'explicit'), ('sex', 'word', 'explicit'), ('sexy', 'word', 'explicit'),
  ('penis', 'word', 'explicit'), ('vagina', 'word', 'explicit'), ('pussy', 'word', 'explicit'),
  ('tits', 'word', 'explicit'), ('boobs', 'word', 'explicit'), ('jizz', 'word', 'explicit'),
  ('horny', 'word', 'explicit'), ('nude', 'word', 'explicit'), ('nudes', 'word', 'explicit'),
  ('milf', 'word', 'explicit'), ('xxx', 'word', 'explicit'), ('rape', 'word', 'explicit'),
  ('rapist', 'word', 'explicit'), ('fag', 'word', 'slur'), ('retard', 'word', 'slur'),
  ('retarded', 'word', 'slur'), ('spic', 'word', 'slur'), ('chink', 'word', 'slur'),
  ('gook', 'word', 'slur'), ('tranny', 'word', 'slur'), ('wetback', 'word', 'slur'),
  ('beaner', 'word', 'slur'), ('raghead', 'word', 'slur'), ('towelhead', 'word', 'slur'),
  ('kkk', 'word', 'slur'), ('heil', 'word', 'slur'), ('kys', 'word', 'profanity'),
  ('admin', 'word', 'reserved'), ('administrator', 'word', 'reserved'), ('moderator', 'word', 'reserved'),
  ('support', 'word', 'reserved'), ('official', 'word', 'reserved'), ('null', 'word', 'reserved'),
  ('undefined', 'word', 'reserved')
on conflict (term) do nothing;

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  admin_email text not null,
  target_type text not null check (target_type in ('participant', 'invitation')),
  target_id uuid not null,
  action text not null,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);
create index moderation_actions_target_idx on public.moderation_actions (target_id);

update public.experiment_settings
  set value = value || '{"name_checks_per_ip_hour": 300, "name_rejects_per_ip_hour": 30}'::jsonb
  where key = 'rate_limits';

insert into public.experiment_settings (key, value, description) values
  ('name_review', '"after"',
   '"after": new names are shown right away and can be reviewed later (default). "before": names stay hidden on invitation pages until an admin approves them.')
on conflict (key) do nothing;

alter table public.moderation_terms enable row level security;
alter table public.moderation_actions enable row level security;
create policy "Admins read moderation terms" on public.moderation_terms for select to authenticated using (public.is_admin());
create policy "Admins read moderation log" on public.moderation_actions for select to authenticated using (public.is_admin());
revoke all on public.moderation_terms, public.moderation_actions from anon, authenticated;
grant select on public.moderation_terms, public.moderation_actions to authenticated;

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------

-- Collapse whitespace and trim.
create or replace function public.px_tidy_name(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '')
$$;

-- Returns NULL if the name is acceptable, otherwise a short reason (for admins
-- and tests; participants only ever see "Please enter a different name.").
-- Letters from any script are allowed, plus spaces, apostrophes (' ’ ʼ),
-- hyphens and periods.
create or replace function public.px_name_problem(p text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text := public.px_tidy_name(p);
  folded text;
  compact text;
  dedup text;
  tokens text[];
begin
  if v is null or char_length(v) > 40 then return 'length'; end if;
  -- digits and ASCII symbols other than ' - .
  if v ~ '[0-9!"#$%&()*+,/:;<=>?@\[\\\]^_`{|}~]' then return 'characters'; end if;
  -- control / invisible / formatting characters
  if v ~ '[\u0000-\u001F\u007F-\u009F­​-‏ - ⁠-⁯﻿︀-️]' then return 'characters'; end if;
  -- quote marks other than apostrophes, bullets, arrows, symbols, emoji, full-width ASCII
  if v ~ '[‚-‟†-‧‰-⁞℀-⯿　-〿！-～\U0001F000-\U0001FFFF]' then return 'characters'; end if;
  -- must contain a letter, and start with one
  if v ~ '^[\s''’ʼ.\-]' or v !~ '[^\s''’ʼ.\-]' then return 'characters'; end if;
  if v ~ '(.)\1{4,}' then return 'repeat'; end if;
  if (select count(*) from regexp_matches(v, ' ', 'g')) > 5 then return 'spam'; end if;
  if lower(v) ~ '(^|\s)(www|https?)\M' or lower(v) ~ '[[:alpha:]]{2,}\.[[:alpha:]]{2,}' then return 'url'; end if;

  folded := translate(lower(v),
    'àáâãäåāăąçćčďèéêëēėęěìíîïīįıłñńňòóôõöøōőŕřśšşșťțùúûüūůűųýÿźžż',
    'aaaaaaaaacccdeeeeeeeeiiiiiiilnnnoooooooorrssssttuuuuuuuuyyzzz');
  compact := regexp_replace(folded, '[\s''’ʼ.\-]', '', 'g');
  dedup := regexp_replace(compact, '(.)\1+', '\1', 'g');
  tokens := regexp_split_to_array(folded, '[\s''’ʼ.\-]+');

  if exists (
    select 1 from public.moderation_terms t
    where (t.match = 'substring' and (strpos(compact, t.term) > 0
            -- "fuuuck": also check with repeated letters collapsed, for terms that have none
            or (t.term = regexp_replace(t.term, '(.)\1+', '\1', 'g') and strpos(dedup, t.term) > 0)))
       or (t.match = 'word' and (t.term = any(tokens) or compact = t.term))
  ) then
    return 'blocked';
  end if;
  return null;
end $$;

-- Rejected attempts are counted per IP (and capped) without aborting the
-- request, so the counter survives the rejection.
create or replace function public.px_name_gate(p text, p_key text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_key text := public.px_hash(coalesce(p_key, public.px_client_ip()));
  v_limit integer := (public.px_setting('rate_limits') ->> 'name_rejects_per_ip_hour')::int;
begin
  if v_key is not null and v_limit is not null and (
      select count(*) from public.rate_events
      where kind = 'name_reject' and key_hash = v_key and created_at > now() - interval '1 hour') >= v_limit then
    raise exception 'rate_limited' using errcode = '22023';
  end if;
  if public.px_name_problem(p) is not null then
    if v_key is not null then insert into public.rate_events (kind, key_hash) values ('name_reject', v_key); end if;
    return null;
  end if;
  return public.px_tidy_name(p);
end $$;

-- Lets the app check a name before going further (e.g. before creating an
-- account). Returns only ok/not ok — never which rule matched.
create or replace function public.check_name(p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.px_rate_limit('name_check', public.px_client_ip(), 'name_checks_per_ip_hour', interval '1 hour');
  return jsonb_build_object('ok', public.px_name_gate(p_name) is not null);
end $$;

-- ---------------------------------------------------------------------------
-- Enforce on every way a name enters the system
-- ---------------------------------------------------------------------------

alter function public.accept_invitation(text, text, boolean, boolean, text) rename to px_accept_invitation_v2;

create or replace function public.accept_invitation(
  p_token text,
  p_display_name text,
  p_research_consent boolean,
  p_marketing_consent boolean default false,
  p_device text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text;
  v_result jsonb;
begin
  -- Existing participants don't submit a name here (their visit is recorded as
  -- a duplicate), so there is nothing to validate.
  if (public.px_me()).id is not null or auth.uid() is null then
    return public.px_accept_invitation_v2(p_token, p_display_name, p_research_consent, p_marketing_consent, p_device);
  end if;
  v_name := public.px_name_gate(p_display_name);
  if v_name is null then
    return jsonb_build_object('error', 'invalid_name');
  end if;
  v_result := public.px_accept_invitation_v2(p_token, v_name, p_research_consent, p_marketing_consent, p_device);
  if public.px_setting('name_review') #>> '{}' = 'before' then
    update public.participants set name_status = 'pending' where user_id = auth.uid() and deleted_at is null;
  end if;
  return v_result;
end $$;

alter function public.create_invitation(text, text, integer) rename to px_create_invitation_v2;

create or replace function public.create_invitation(
  p_value text,
  p_recipient_label text default null,
  p_response_ms integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_label text;
begin
  if me.suspended_at is not null then
    raise exception 'suspended' using errcode = '42501';
  end if;
  if public.px_tidy_name(p_recipient_label) is not null then
    v_label := public.px_name_gate(p_recipient_label, me.id::text);
    if v_label is null then
      return jsonb_build_object('error', 'invalid_name');
    end if;
  end if;
  return public.px_create_invitation_v2(p_value, v_label, p_response_ms);
end $$;

alter function public.admin_create_seed_invitations(integer, text, text) rename to px_admin_create_seed_invitations_core;

create or replace function public.admin_create_seed_invitations(p_count integer, p_sender_name text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  if public.px_name_problem(p_sender_name) is not null then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  return public.px_admin_create_seed_invitations_core(p_count, public.px_tidy_name(p_sender_name), p_note);
end $$;

-- ---------------------------------------------------------------------------
-- What participants and invitees can see
-- ---------------------------------------------------------------------------

-- Invitation landing: only an approved FIRST name, never a hidden/flagged/
-- pending name, and nothing from a suspended or deleted sender.
alter function public.open_invitation(text) rename to px_open_invitation_v2;

create or replace function public.open_invitation(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb := public.px_open_invitation_v2(p_token);
  inv public.invitations;
  s public.participants;
  v_name text;
begin
  if v ->> 'state' <> 'ok' then return v; end if;
  select * into inv from public.invitations where token = p_token;
  if inv.sender_id is null then
    v_name := inv.sender_name; -- seed links: the admin's own name
  else
    select * into s from public.participants where id = inv.sender_id;
    if s.name_status = 'ok' and s.suspended_at is null and s.deleted_at is null then
      v_name := s.display_name;
    end if;
  end if;
  return v || jsonb_build_object('sender_name', nullif(split_part(coalesce(v_name, ''), ' ', 1), ''));
end $$;

-- Participant's own dashboard: hidden names are not shown back; suspension is reported.
alter function public.get_my_state() rename to px_get_my_state_v3;

create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_get_my_state_v3();
  me public.participants := public.px_me();
begin
  if me.id is null then return v; end if;
  return jsonb_set(v, '{participant}', (v -> 'participant') || jsonb_build_object(
    'display_name', case when me.name_status = 'hidden' then null else me.display_name end,
    'name_status', me.name_status,
    'suspended', me.suspended_at is not null));
end $$;

-- Erasure also scrubs names from the moderation log.
alter function public.delete_my_data() rename to px_delete_my_data_v2;

create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if me.id is not null then
    update public.moderation_actions set old_value = null, new_value = null
      where target_id = me.id
         or target_id in (select id from public.invitations where sender_id = me.id);
  end if;
  return public.px_delete_my_data_v2();
end $$;

-- ---------------------------------------------------------------------------
-- Admin moderation
-- ---------------------------------------------------------------------------

create or replace function public.admin_names()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return jsonb_build_object(
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'name_status', p.name_status,
        'suspended_at', p.suspended_at, 'suspended_reason', p.suspended_reason,
        'depth', p.depth, 'created_at', p.created_at,
        'links', (select count(*) from public.invitations i where i.sender_id = p.id))
        order by (p.name_status <> 'ok') desc, p.created_at desc)
      from public.participants p where p.deleted_at is null), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'recipient_label', i.recipient_label, 'label_status', i.label_status,
        'status', i.status, 'created_at', i.created_at, 'sender_id', i.sender_id,
        'sender_name', s.display_name)
        order by (i.label_status <> 'ok') desc, i.created_at desc)
      from public.invitations i join public.participants s on s.id = i.sender_id
      where i.recipient_label is not null or i.label_status <> 'ok'), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(row_to_json(a) order by a.created_at desc)
      from (select * from public.moderation_actions order by created_at desc limit 100) a), '[]'::jsonb),
    'name_review', public.px_setting('name_review') #>> '{}'
  );
end $$;

create or replace function public.admin_moderate(
  p_target text, p_id uuid, p_action text, p_value text default null, p_reason text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_admin text;
  p public.participants;
  inv public.invitations;
  v_new text;
  v_old text;
begin
  perform public.px_require_admin();
  select lower(email) into v_admin from auth.users where id = auth.uid();

  if p_target = 'participant' then
    select * into p from public.participants where id = p_id for update;
    if not found then raise exception 'not_found' using errcode = '22023'; end if;
    v_old := p.display_name;
    case p_action
      when 'approve' then update public.participants set name_status = 'ok' where id = p_id;
      when 'flag' then update public.participants set name_status = 'flagged' where id = p_id;
      when 'hide' then update public.participants set name_status = 'hidden' where id = p_id;
      when 'replace' then
        if public.px_name_problem(p_value) is not null then raise exception 'invalid_name' using errcode = '22023'; end if;
        v_new := public.px_tidy_name(p_value);
        update public.participants set display_name = v_new, name_status = 'ok' where id = p_id;
      when 'suspend' then
        update public.participants set suspended_at = coalesce(suspended_at, now()), suspended_reason = p_reason where id = p_id;
        -- Their unused links stop working.
        update public.invitations set status = 'revoked', revoked_at = now()
          where sender_id = p_id and status in ('created', 'opened');
      when 'unsuspend' then update public.participants set suspended_at = null, suspended_reason = null where id = p_id;
      else raise exception 'invalid_action' using errcode = '22023';
    end case;
    if p_action not in ('replace') then v_new := null; v_old := case when p_action in ('hide', 'flag') then v_old end; end if;

  elsif p_target = 'invitation' then
    select * into inv from public.invitations where id = p_id for update;
    if not found then raise exception 'not_found' using errcode = '22023'; end if;
    v_old := inv.recipient_label;
    case p_action
      when 'approve' then update public.invitations set label_status = 'ok' where id = p_id;
      when 'flag' then update public.invitations set label_status = 'flagged' where id = p_id;
      when 'hide' then update public.invitations set recipient_label = null, label_status = 'hidden' where id = p_id;
      when 'replace' then
        if public.px_name_problem(p_value) is not null then raise exception 'invalid_name' using errcode = '22023'; end if;
        v_new := public.px_tidy_name(p_value);
        update public.invitations set recipient_label = v_new, label_status = 'ok' where id = p_id;
      else raise exception 'invalid_action' using errcode = '22023';
    end case;
    if p_action = 'approve' then v_old := null; end if;
  else
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  insert into public.moderation_actions (admin_email, target_type, target_id, action, old_value, new_value, reason)
  values (v_admin, p_target, p_id, p_action, v_old, v_new, nullif(btrim(p_reason), ''));
  return jsonb_build_object('ok', true);
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
        'check_name', 'accept_invitation', 'create_invitation', 'open_invitation', 'get_my_state', 'delete_my_data'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.check_name(text) to anon, authenticated;
grant execute on function public.open_invitation(text) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean, boolean, text) to authenticated;
grant execute on function public.create_invitation(text, text, integer) to authenticated;
grant execute on function public.get_my_state() to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
grant execute on function public.admin_account_stats() to authenticated;
grant execute on function public.admin_names() to authenticated;
grant execute on function public.admin_moderate(text, uuid, text, text, text) to authenticated;
