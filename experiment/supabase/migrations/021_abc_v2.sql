-- The Pipeline Experiment: ABC V2 (three questions), alongside the existing ABC V1.
--
-- ABC V1 (two questions: cold message vs. introduced by the inviter) is unchanged. Every existing
-- experiment stays on V1, keeps its settings, and its answers stay in abc_responses with the same
-- meaning. Nothing is migrated to V2 automatically.
--
-- ABC V2 is chosen per experiment (experiments.abc_version = 'v2') and asks "How likely are you
-- to respond?" about the same hypothetical Jane/John in three situations:
--   1. university    shares only the university                    messages them directly
--   2. shared_group  shares the experiment's group (abc_v2_group)   messages them directly
--   3. warm          shares the group                               introduced by the intermediary
-- in a random order that is stored, each question exactly once. Question 3 needs an intermediary:
--   * personal referral (the inviter), personal seed link (the founder) or named broadcast link
--     (the sender, e.g. Ryan): all three
--   * unnamed broadcast link: no intermediary, so questions 1 and 2 only
-- A skipped question is stored as NULL (never 0), with warm_eligible = false.
-- The shared group is a phrase set per experiment (e.g. "on the Harvard Baseball team"); the
-- experiment's internal name is never used for it.
-- A named broadcast sender is recorded as intermediary_type = 'broadcast_sender'. It is never
-- turned into a referral or a connection, and knowing them is not assumed (knows_intermediary
-- stays NULL); the onboarding connection-strength answer about them is copied when there is one.
--
-- ADDITIVE and safe to run more than once. Run after 020.

-- ───────────── 1. Per-experiment settings ─────────────
-- abc_enabled stays the on/off switch. abc_version picks V1 or V2 when it's on.
alter table public.experiments
  add column if not exists abc_version text not null default 'v1',
  add column if not exists abc_v2_scenarios jsonb not null default '[]'::jsonb,
  -- The shared group as it reads in a sentence, e.g. "on the Harvard Baseball team".
  add column if not exists abc_v2_group text,
  add column if not exists abc_v2_revision integer not null default 1;

-- Default wording per participant type. {name} = Jane/John, {group} = abc_v2_group,
-- {inviter} = the intermediary's first name.
alter table public.experiments alter column abc_v2_scenarios set default '[
  {"key": "student", "label": "Current Harvard student",
   "university": "{name} is a Harvard first-year looking for advice on which classes to take.",
   "group": "{name} is a Harvard first-year {group} looking for advice on which classes to take.",
   "direct_contact": "{name} messages you directly.",
   "warm_contact": "{inviter} personally introduces you to {name}."},
  {"key": "alumni", "label": "Harvard alumnus/alumna",
   "university": "{name} is a Harvard junior looking for internship advice.",
   "group": "{name} is a Harvard junior {group} looking for internship advice.",
   "direct_contact": "{name} messages you directly.",
   "warm_contact": "{inviter} personally introduces you to {name}."}
]'::jsonb;
update public.experiments set abc_v2_scenarios = default where abc_v2_scenarios = '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'experiments_abc_version_check') then
    alter table public.experiments add constraint experiments_abc_version_check check (abc_version in ('v1', 'v2'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiments_abc_v2_scenarios_check') then
    alter table public.experiments add constraint experiments_abc_v2_scenarios_check check (jsonb_typeof(abc_v2_scenarios) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiments_abc_v2_group_check') then
    alter table public.experiments add constraint experiments_abc_v2_group_check check (abc_v2_group is null or char_length(abc_v2_group) <= 80);
  end if;
end $$;

-- ───────────── 2. V2 answers (one row per participant) ─────────────
create table if not exists public.abc_v2_responses (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id),
  abc_version text not null default 'v2' check (abc_version = 'v2'),
  invitation_id uuid references public.invitations(id) on delete set null,
  link_kind text,                    -- invitations.kind of the link they joined through
  depth integer not null,            -- generation (seed-link joiners are 1)
  classification text not null,      -- scenario group key, e.g. 'student' / 'alumni'
  -- Who would make the warm introduction:
  --   inviter           the participant who invited them (personal referral)
  --   seed_sender       the founder named on a personal seed link
  --   broadcast_sender  the person named on a broadcast link (NOT a confirmed personal referral)
  --   none              unnamed broadcast link
  intermediary_type text not null check (intermediary_type in ('inviter', 'seed_sender', 'broadcast_sender', 'none')),
  intermediary_participant_id uuid references public.participants(id) on delete set null,
  intermediary_name text,            -- first name as shown in the question
  knows_intermediary boolean,        -- true for a personal link; NULL when not asked (broadcast)
  knows_source text check (knows_source in ('self_report', 'referral')),
  connection_strength smallint check (connection_strength between 0 and 100),
  strength_source text,              -- 'referral_rating' / 'onboarding_rating' (see below)
  knows_response_ms integer check (knows_response_ms is null or knows_response_ms between 0 and 3600000),
  fictional_name text not null check (fictional_name in ('Jane', 'John')),
  scenario_revision integer not null,
  scenario_text jsonb not null,      -- the exact wording shown, per question
  question_order text[] not null,    -- e.g. {shared_group,warm,university}
  warm_eligible boolean not null,
  university smallint check (university between 1 and 5),
  university_at timestamptz,
  shared_group smallint check (shared_group between 1 and 5),
  shared_group_at timestamptz,
  warm smallint check (warm between 1 and 5),
  warm_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (warm is null or warm_eligible),
  check (not (intermediary_type = 'broadcast_sender' and knows_source = 'referral'))
);

create index if not exists abc_v2_responses_experiment_idx on public.abc_v2_responses (experiment_id);

-- connection_strength comes from the onboarding rating of the intermediary (0–100):
-- 'referral_rating' for a personal link, 'onboarding_rating' for a named broadcast sender.
do $$ begin
  alter table public.abc_v2_responses drop constraint if exists abc_v2_responses_strength_source_check;
  alter table public.abc_v2_responses add constraint abc_v2_responses_strength_source_check
    check (strength_source in ('referral_rating', 'onboarding_rating', 'v2_dial'));
end $$;
alter table public.abc_v2_responses enable row level security;
revoke all on public.abc_v2_responses from anon, authenticated;

-- ───────────── 3. V1 stays V1 ─────────────
-- Same rule as before, plus "this experiment uses V1". Every existing experiment does, so
-- nothing changes for them; a V2 experiment never creates V1 rows.
create or replace function public.px_abc_eligible(me public.participants)
returns boolean language sql stable security definer set search_path = public as $$
  select me.id is not null and me.deleted_at is null and me.suspended_at is null and me.parent_id is not null
    and exists (select 1 from public.experiments e
                where e.id = me.experiment_id and e.abc_enabled and e.abc_version = 'v1'
                  and me.depth >= e.abc_min_depth)
$$;

-- ───────────── 4. V2 helpers ─────────────
-- Who could introduce Jane/John to this participant, and whether they get V2 at all.
create or replace function public.px_abc_v2_context(me public.participants)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e public.experiments;
  inv public.invitations;
  v_kind text;
  v_type text := 'none';
  v_pid uuid;
  v_name text;
  v_eligible boolean;
begin
  if me.id is null or me.deleted_at is not null or me.suspended_at is not null then
    return jsonb_build_object('eligible', false);
  end if;
  select * into e from public.experiments where id = me.experiment_id;
  -- Without the shared group, questions 1 and 2 would read the same: nobody gets V2 until it's set.
  if not found or not e.abc_enabled or e.abc_version <> 'v2' or nullif(btrim(e.abc_v2_group), '') is null then
    return jsonb_build_object('eligible', false);
  end if;
  select * into inv from public.invitations where id = me.invitation_id;
  v_kind := inv.kind;
  if me.parent_id is not null then
    v_type := 'inviter';
    v_pid := me.parent_id;
    -- The inviter's approved first name only (never a hidden or flagged one).
    select nullif(split_part(coalesce(s.display_name, ''), ' ', 1), '') into v_name
      from public.participants s
      where s.id = me.parent_id and s.name_status = 'ok' and s.suspended_at is null and s.deleted_at is null;
  else
    v_name := nullif(split_part(btrim(coalesce(inv.sender_name,
      (select m.sender_name from public.invitations m where m.id = inv.broadcast_parent), '')), ' ', 1), '');
    if v_kind = 'seed_broadcast' then
      v_type := case when v_name is not null then 'broadcast_sender' else 'none' end;
    elsif v_name is not null then
      v_type := 'seed_sender';
    end if;
  end if;
  -- Broadcast-link joiners always qualify (that's the point of V2); everyone else from the
  -- experiment's starting generation.
  v_eligible := v_kind = 'seed_broadcast' or me.depth >= e.abc_min_depth;
  return jsonb_build_object('eligible', v_eligible, 'link_kind', v_kind, 'type', v_type,
    'participant_id', v_pid, 'name', v_name);
end $$;

-- The experiment's V2 scenario group for this participant (NULL if it has to be asked).
create or replace function public.px_abc_v2_group(e public.experiments, me public.participants)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s from jsonb_array_elements(e.abc_v2_scenarios) s where s ->> 'key' = me.classification limit 1),
    (select s from jsonb_array_elements(e.abc_v2_scenarios) s
      where me.category is not null and lower(s ->> 'label') = lower(btrim(me.category)) limit 1))
$$;

-- Fill the placeholders: {name} (Jane/John), {inviter} (intermediary's first name),
-- {group} (the experiment's abc_v2_group phrase; never its internal name). Spaces are tidied
-- so an empty phrase can't leave a double space.
create or replace function public.px_abc_v2_render(p_text text, p_name text, p_inviter text, p_group text)
returns text language sql immutable as $$
  select btrim(regexp_replace(replace(replace(replace(coalesce(p_text, ''), '{name}', p_name),
    '{inviter}', coalesce(p_inviter, 'someone you know')), '{group}', btrim(coalesce(p_group, ''))), '\s{2,}', ' ', 'g'))
$$;

create or replace function public.px_abc_v2_payload(r public.abc_v2_responses)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eligible', true,
    'version', 'v2',
    'name', r.fictional_name,
    'order', to_jsonb(r.question_order),
    'questions', r.scenario_text,
    'answers', jsonb_build_object('university', r.university, 'shared_group', r.shared_group, 'warm', r.warm),
    'classification', r.classification,
    'intermediary', jsonb_build_object('type', r.intermediary_type, 'name', r.intermediary_name,
                                       'knows', r.knows_intermediary),
    'completed', r.completed_at is not null)
$$;

-- Creates the participant's V2 row: random Jane/John and question order, the wording as shown.
create or replace function public.px_abc_v2_start(me public.participants, ctx jsonb, g jsonb)
returns public.abc_v2_responses language plpgsql volatile security definer set search_path = public as $$
declare
  e public.experiments;
  r public.abc_v2_responses;
  v_type text := ctx ->> 'type';
  v_iname text := ctx ->> 'name';
  v_name text := case when random() < 0.5 then 'Jane' else 'John' end;
  v_group text;
  v_warm boolean := v_type in ('inviter', 'seed_sender', 'broadcast_sender');
  v_knows boolean;
  v_source text;
  v_strength integer;
  v_order text[];
  v_text jsonb;
  v_direct text := coalesce(nullif(btrim(g ->> 'direct_contact'), ''), '{name} messages you directly.');
  v_intro text := coalesce(nullif(btrim(g ->> 'warm_contact'), ''), '{inviter} personally introduces you to {name}.');
  q text := 'How likely are you to respond?';
begin
  select * into e from public.experiments where id = me.experiment_id;
  v_group := e.abc_v2_group;
  if v_warm then
    -- Their own rating of the intermediary while joining (0–100), if there is one.
    select round(public.px_strength_score(c.method, c.value) * 100) into v_strength
      from public.classifications c
      where c.invitation_id = me.invitation_id and c.direction = 'inbound' limit 1;
    if v_strength is null then
      select (rr.closeness - 1) * 25 into v_strength
        from public.relationship_ratings rr
        where rr.invitation_id = me.invitation_id and rr.direction = 'inbound' and rr.closeness is not null limit 1;
    end if;
  end if;
  if v_type in ('inviter', 'seed_sender') then
    -- A personal link: this person invited them.
    v_knows := true;
    v_source := 'referral';
  end if;
  select array_agg(x order by random()) into v_order
    from unnest(case when v_warm then array['university', 'shared_group', 'warm']
                     else array['university', 'shared_group'] end) x;
  v_text := jsonb_build_object(
    'university', jsonb_build_object(
      'scenario', public.px_abc_v2_render(g ->> 'university', v_name, v_iname, v_group),
      'contact', public.px_abc_v2_render(v_direct, v_name, v_iname, v_group), 'question', q),
    'shared_group', jsonb_build_object(
      'scenario', public.px_abc_v2_render(g ->> 'group', v_name, v_iname, v_group),
      'contact', public.px_abc_v2_render(v_direct, v_name, v_iname, v_group), 'question', q));
  if v_warm then
    v_text := v_text || jsonb_build_object('warm', jsonb_build_object(
      'scenario', public.px_abc_v2_render(g ->> 'group', v_name, v_iname, v_group),
      'contact', public.px_abc_v2_render(v_intro, v_name, v_iname, v_group), 'question', q));
  end if;
  insert into public.abc_v2_responses (participant_id, experiment_id, invitation_id, link_kind, depth,
    classification, intermediary_type, intermediary_participant_id, intermediary_name,
    knows_intermediary, knows_source, connection_strength, strength_source,
    fictional_name, scenario_revision, scenario_text, question_order, warm_eligible)
  values (me.id, me.experiment_id, me.invitation_id, ctx ->> 'link_kind', me.depth,
    g ->> 'key', v_type, (ctx ->> 'participant_id')::uuid, v_iname,
    v_knows, v_source, v_strength,
    case when v_strength is null then null when v_type = 'broadcast_sender' then 'onboarding_rating' else 'referral_rating' end,
    v_name, e.abc_v2_revision, v_text, v_order, v_warm)
  on conflict (participant_id) do nothing
  returning * into r;
  if r.participant_id is null then
    select * into r from public.abc_v2_responses where participant_id = me.id;
  end if;
  return r;
end $$;

-- The earlier draft's 6-argument version and the "do you know the sender" step are gone.
drop function if exists public.px_abc_v2_start(public.participants, jsonb, jsonb, boolean, integer, integer);
drop function if exists public.set_abc_v2_knows(boolean, integer, integer);

-- ───────────── 5. Participant RPCs ─────────────
-- Everything the V2 screens need: the group question (only if their join answer didn't map to
-- one), then the questions.
create or replace function public.get_abc_v2()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  ctx jsonb := public.px_abc_v2_context(me);
  e public.experiments;
  r public.abc_v2_responses;
  g jsonb;
begin
  if not coalesce((ctx ->> 'eligible')::boolean, false) then
    return jsonb_build_object('eligible', false, 'version', 'v2');
  end if;
  select * into r from public.abc_v2_responses where participant_id = me.id;
  if found then
    return public.px_abc_v2_payload(r);
  end if;
  select * into e from public.experiments where id = me.experiment_id;
  g := public.px_abc_v2_group(e, me);
  if g is null then
    return jsonb_build_object('eligible', true, 'version', 'v2', 'needs_classification', true,
      'groups', (select coalesce(jsonb_agg(jsonb_build_object('key', s ->> 'key', 'label', s ->> 'label')), '[]'::jsonb)
                 from jsonb_array_elements(e.abc_v2_scenarios) s));
  end if;
  r := public.px_abc_v2_start(me, ctx, g);
  return public.px_abc_v2_payload(r);
end $$;

-- "Which describes you?" for V2 (only before their V2 questions have started).
create or replace function public.set_abc_v2_group(p_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if not coalesce((public.px_abc_v2_context(me) ->> 'eligible')::boolean, false) then
    return jsonb_build_object('error', 'not_participant');
  end if;
  if not exists (select 1 from public.experiments e, jsonb_array_elements(e.abc_v2_scenarios) s
                 where e.id = me.experiment_id and s ->> 'key' = p_key) then
    return jsonb_build_object('error', 'invalid_value');
  end if;
  if exists (select 1 from public.abc_v2_responses where participant_id = me.id) then
    return jsonb_build_object('error', 'abc_started');
  end if;
  update public.participants set classification = p_key where id = me.id;
  return public.get_abc_v2();
end $$;

-- One answer at a time. Until the last one is in, an answer can be changed (the Back button);
-- complete, and locked, once every question in their order is answered.
create or replace function public.answer_abc_v2(p_question text, p_value integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  r public.abc_v2_responses;
begin
  if p_question not in ('university', 'shared_group', 'warm') or p_value is null or p_value not between 1 and 5 then
    return jsonb_build_object('error', 'invalid_value');
  end if;
  select * into r from public.abc_v2_responses where participant_id = me.id for update;
  if not found then
    return jsonb_build_object('error', 'not_participant');
  end if;
  if r.completed_at is not null then
    return jsonb_build_object('error', 'abc_completed');
  end if;
  if not (p_question = any (r.question_order)) then
    return jsonb_build_object('error', 'invalid_value');
  end if;
  perform public.px_rate_limit('abc', public.px_client_ip(), 'abc_answers_per_ip_hour', interval '1 hour');
  update public.abc_v2_responses set
    university = case when p_question = 'university' then p_value else university end,
    university_at = case when p_question = 'university' then now() else university_at end,
    shared_group = case when p_question = 'shared_group' then p_value else shared_group end,
    shared_group_at = case when p_question = 'shared_group' then now() else shared_group_at end,
    warm = case when p_question = 'warm' then p_value else warm end,
    warm_at = case when p_question = 'warm' then now() else warm_at end
  where participant_id = me.id
  returning * into r;
  if r.university is not null and r.shared_group is not null and (r.warm is not null or not r.warm_eligible) then
    update public.abc_v2_responses set completed_at = now() where participant_id = me.id returning * into r;
  end if;
  return public.px_abc_v2_payload(r);
end $$;

-- Broadcast links: the invitation page needs to know a link is reusable, so it can sign the visitor
-- in (anonymously) before the onboarding questions. Until then their answers were saved on the
-- shared link itself, where the next visitor overwrote them and they were never tied to a person.
create or replace function public.open_invitation(p_token text, p_device text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb := public.px_open_invitation_v19(public.px_resolve_token(p_token), p_device);
begin
  if exists (select 1 from public.invitations
             where token = p_token and kind = 'seed_broadcast' and broadcast_parent is null and status <> 'revoked') then
    v := v || jsonb_build_object('reusable', true);
  end if;
  return v;
end $$;

-- The home screen's ABC card: V1 as before (now labelled), or V2.
do $$ begin
  if to_regprocedure('public.px_get_my_state_v21()') is null then
    alter function public.get_my_state() rename to px_get_my_state_v21;
  end if;
end $$;

create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_get_my_state_v21();
  me public.participants := public.px_me();
begin
  if me.id is null then return v; end if;
  if exists (select 1 from public.experiments e where e.id = me.experiment_id and e.abc_enabled and e.abc_version = 'v2') then
    return v || jsonb_build_object('abc', jsonb_build_object(
      'version', 'v2',
      'eligible', coalesce((public.px_abc_v2_context(me) ->> 'eligible')::boolean, false),
      'completed', exists (select 1 from public.abc_v2_responses where participant_id = me.id and completed_at is not null)));
  end if;
  if v ? 'abc' then
    return jsonb_set(v, '{abc,version}', '"v1"');
  end if;
  return v;
end $$;

-- Erasure: V2 answers go too.
do $$ begin
  if to_regprocedure('public.px_delete_my_data_v21()') is null then
    alter function public.delete_my_data() rename to px_delete_my_data_v21;
  end if;
end $$;

create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.abc_v2_responses where participant_id in
    (select id from public.participants where user_id = auth.uid() and deleted_at is null);
  return public.px_delete_my_data_v21();
end $$;

-- ───────────── 6. Admin ─────────────
-- Choose None / V1 / V2, the starting generation, and the V2 scenarios. Switching between V1 and
-- V2 is refused once anyone has answered in that experiment, so the two never mix.
drop function if exists public.admin_save_experiment_abc(uuid, text, integer, jsonb);

create or replace function public.admin_save_experiment_abc(
  p_experiment_id uuid, p_mode text, p_min_depth integer default null, p_v2_scenarios jsonb default null,
  p_v2_group text default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e public.experiments;
  s jsonb;
  v_version text;
  v_keys text[] := '{}';
  v_group text := nullif(btrim(p_v2_group), '');
begin
  perform public.px_require_admin();
  select * into e from public.experiments where id = p_experiment_id for update;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if p_mode not in ('none', 'v1', 'v2') or (p_min_depth is not null and p_min_depth not between 1 and 50) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  v_version := case when p_mode = 'none' then e.abc_version else p_mode end;
  -- V2 needs the shared group ("on the Harvard Baseball team"); the internal name is never used.
  if p_mode = 'v2' and coalesce(v_group, nullif(btrim(e.abc_v2_group), '')) is null then
    raise exception 'invalid_group' using errcode = '22023';
  end if;
  if char_length(coalesce(v_group, '')) > 80 then
    raise exception 'invalid_group' using errcode = '22023';
  end if;
  if v_version <> e.abc_version and (
       exists (select 1 from public.abc_responses where experiment_id = e.id)
    or exists (select 1 from public.abc_v2_responses where experiment_id = e.id)) then
    raise exception 'abc_version_locked' using errcode = '22023';
  end if;
  if p_v2_scenarios is not null then
    if jsonb_typeof(p_v2_scenarios) <> 'array' or jsonb_array_length(p_v2_scenarios) not between 1 and 8 then
      raise exception 'invalid_scenarios' using errcode = '22023';
    end if;
    for s in select * from jsonb_array_elements(p_v2_scenarios) loop
      if coalesce(s ->> 'key', '') !~ '^[a-z0-9_]{1,40}$' or s ->> 'key' = any (v_keys)
         or char_length(btrim(coalesce(s ->> 'label', ''))) not between 1 and 80
         or char_length(btrim(coalesce(s ->> 'university', ''))) not between 1 and 400
         or char_length(btrim(coalesce(s ->> 'group', ''))) not between 1 and 400
         or char_length(btrim(coalesce(s ->> 'direct_contact', ''))) not between 1 and 200
         or char_length(btrim(coalesce(s ->> 'warm_contact', ''))) not between 1 and 200 then
        raise exception 'invalid_scenarios' using errcode = '22023';
      end if;
      v_keys := v_keys || (s ->> 'key');
    end loop;
    select jsonb_agg(jsonb_build_object('key', x ->> 'key', 'label', btrim(x ->> 'label'),
             'university', btrim(x ->> 'university'), 'group', btrim(x ->> 'group'),
             'direct_contact', btrim(x ->> 'direct_contact'), 'warm_contact', btrim(x ->> 'warm_contact')))
      into s from jsonb_array_elements(p_v2_scenarios) x;
  end if;
  update public.experiments set
    abc_enabled = p_mode <> 'none',
    abc_version = v_version,
    abc_min_depth = coalesce(p_min_depth, abc_min_depth),
    abc_v2_scenarios = coalesce(s, abc_v2_scenarios),
    abc_v2_group = coalesce(v_group, abc_v2_group),
    -- A new wording is a new revision; answers keep the revision (and exact text) they saw.
    abc_v2_revision = abc_v2_revision + case when (s is not null and s is distinct from abc_v2_scenarios)
                                               or (v_group is not null and v_group is distinct from abc_v2_group) then 1 else 0 end,
    updated_at = now()
  where id = e.id;
  return jsonb_build_object('ok', true);
end $$;

-- V2 analytics. Differences are paired (the same person answered both questions).
-- Test experiments are left out unless one is picked.
create or replace function public.admin_abc_v2_stats(p_experiment_id uuid default null, p_classification text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  with ex as (
    select id from public.experiments
    where abc_version = 'v2' and (p_experiment_id is null and not is_test or id = p_experiment_id)
  ),
  r as (
    select a.*,
      case when a.link_kind = 'seed_broadcast' then 'broadcast' else 'personal' end as link_group,
      case
        when not a.warm_eligible then 'no_intermediary'
        when a.connection_strength is null then 'unrated'
        when a.connection_strength < 25 then '0-24'
        when a.connection_strength < 50 then '25-49'
        when a.connection_strength < 75 then '50-74'
        else '75-100' end as strength_band
    from public.abc_v2_responses a
    join ex on ex.id = a.experiment_id
    join public.participants p on p.id = a.participant_id and p.deleted_at is null
    where p_classification is null or a.classification = p_classification
  ),
  pairs as (
    select
      count(*) filter (where university is not null and shared_group is not null) as n_group_uni,
      avg(shared_group - university) filter (where university is not null and shared_group is not null) as diff_group_uni,
      avg(university) filter (where university is not null and shared_group is not null) as uni_in_pair,
      avg(shared_group) filter (where university is not null and shared_group is not null) as group_in_pair,
      count(*) filter (where shared_group is not null and warm is not null) as n_warm_group,
      avg(warm - shared_group) filter (where shared_group is not null and warm is not null) as diff_warm_group,
      avg(shared_group) filter (where shared_group is not null and warm is not null) as group_in_warm_pair,
      avg(warm) filter (where shared_group is not null and warm is not null) as warm_in_pair,
      count(*) filter (where university is not null and warm is not null) as n_warm_uni,
      avg(warm - university) filter (where university is not null and warm is not null) as diff_warm_uni
    from r
  )
  select jsonb_build_object(
    'participation', jsonb_build_object(
      'started', (select count(*) from r),
      'completed', (select count(*) from r where completed_at is not null),
      'warm_eligible', (select count(*) from r where warm_eligible),
      'named_broadcast', (select count(*) from r where intermediary_type = 'broadcast_sender'),
      'unnamed_broadcast', (select count(*) from r where intermediary_type = 'none')),
    'paired', (select jsonb_build_object(
      'group_vs_university', jsonb_build_object('n', n_group_uni, 'a', round(uni_in_pair, 2), 'b', round(group_in_pair, 2), 'diff', round(diff_group_uni, 2)),
      'warm_vs_group', jsonb_build_object('n', n_warm_group, 'a', round(group_in_warm_pair, 2), 'b', round(warm_in_pair, 2), 'diff', round(diff_warm_group, 2)),
      'warm_vs_university', jsonb_build_object('n', n_warm_uni, 'diff', round(diff_warm_uni, 2))) from pairs),
    'by_strength', coalesce((select jsonb_agg(jsonb_build_object('band', band, 'n', n, 'completed', c,
        'avg_university', au, 'avg_group', ag, 'avg_warm', aw, 'group_minus_university', d1, 'warm_minus_group', d2)
        order by case band when 'no_intermediary' then 0 when '0-24' then 1 when '25-49' then 2 when '50-74' then 3 when '75-100' then 4 else 5 end)
      from (select strength_band as band, count(*) as n, count(*) filter (where completed_at is not null) as c,
              round(avg(university), 2) au, round(avg(shared_group), 2) ag, round(avg(warm), 2) aw,
              round(avg(shared_group - university), 2) d1, round(avg(warm - shared_group), 2) d2
            from r group by strength_band) b), '[]'::jsonb),
    'by_link', coalesce((select jsonb_agg(jsonb_build_object('link', l, 'n', n, 'completed', c,
        'avg_university', au, 'avg_group', ag, 'avg_warm', aw, 'group_minus_university', d1, 'warm_minus_group', d2) order by l)
      from (select link_group as l, count(*) n, count(*) filter (where completed_at is not null) c,
              round(avg(university), 2) au, round(avg(shared_group), 2) ag, round(avg(warm), 2) aw,
              round(avg(shared_group - university), 2) d1, round(avg(warm - shared_group), 2) d2
            from r group by link_group) x), '[]'::jsonb),
    'by_classification', coalesce((select jsonb_agg(jsonb_build_object('classification', k, 'n', n, 'completed', c,
        'avg_university', au, 'avg_group', ag, 'avg_warm', aw, 'group_minus_university', d1, 'warm_minus_group', d2) order by k)
      from (select classification as k, count(*) n, count(*) filter (where completed_at is not null) c,
              round(avg(university), 2) au, round(avg(shared_group), 2) ag, round(avg(warm), 2) aw,
              round(avg(shared_group - university), 2) d1, round(avg(warm - shared_group), 2) d2
            from r group by classification) x), '[]'::jsonb),
    'by_first_question', coalesce((select jsonb_agg(jsonb_build_object('first', f, 'n', n,
        'avg_university', au, 'avg_group', ag, 'avg_warm', aw) order by f)
      from (select question_order[1] as f, count(*) n,
              round(avg(university), 2) au, round(avg(shared_group), 2) ag, round(avg(warm), 2) aw
            from r group by question_order[1]) x), '[]'::jsonb),
    'by_revision', coalesce((select jsonb_agg(jsonb_build_object('revision', rv, 'n', n) order by rv)
      from (select scenario_revision rv, count(*) n from r group by scenario_revision) x), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- CSV export (random ids only; no names or emails).
do $$ begin
  if to_regprocedure('public.px_admin_export_v21(text)') is null then
    alter function public.admin_export(text) rename to px_admin_export_v21;
  end if;
end $$;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'abc_v2' then
    select jsonb_agg(row_to_json(x) order by x.started_at) into v from (
      select a.participant_id, a.experiment_id, e.name as experiment, e.is_test as test_experiment,
        a.abc_version, a.classification, a.link_kind, a.depth,
        a.intermediary_type, a.intermediary_participant_id, a.knows_intermediary, a.knows_source,
        a.connection_strength, a.strength_source, a.knows_response_ms,
        a.fictional_name, array_to_string(a.question_order, '>') as question_order, a.warm_eligible,
        a.university, a.shared_group, a.warm,
        (a.shared_group - a.university) as group_minus_university, (a.warm - a.shared_group) as warm_minus_group,
        a.scenario_revision, a.started_at, a.university_at, a.shared_group_at, a.warm_at, a.completed_at
      from public.abc_v2_responses a
      join public.participants p on p.id = a.participant_id and p.deleted_at is null
      join public.experiments e on e.id = a.experiment_id) x;
    return coalesce(v, '[]'::jsonb);
  end if;
  return public.px_admin_export_v21(p_kind);
end $$;

-- ───────────── 7. Access ─────────────
revoke execute on function public.px_abc_v2_context(public.participants) from public, anon, authenticated;
revoke execute on function public.px_abc_v2_group(public.experiments, public.participants) from public, anon, authenticated;
revoke execute on function public.px_abc_v2_render(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.px_abc_v2_payload(public.abc_v2_responses) from public, anon, authenticated;
revoke execute on function public.px_abc_v2_start(public.participants, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.px_get_my_state_v21() from public, anon, authenticated;
revoke execute on function public.px_delete_my_data_v21() from public, anon, authenticated;
revoke execute on function public.px_admin_export_v21(text) from public, anon, authenticated;

revoke execute on function public.open_invitation(text, text) from public;
grant execute on function public.open_invitation(text, text) to anon, authenticated;
revoke execute on function public.get_abc_v2() from public, anon;
revoke execute on function public.set_abc_v2_group(text) from public, anon;
revoke execute on function public.answer_abc_v2(text, integer) from public, anon;
revoke execute on function public.get_my_state() from public, anon;
revoke execute on function public.delete_my_data() from public, anon;
revoke execute on function public.admin_save_experiment_abc(uuid, text, integer, jsonb, text) from public, anon;
revoke execute on function public.admin_abc_v2_stats(uuid, text) from public, anon;
revoke execute on function public.admin_export(text) from public, anon;
grant execute on function public.get_abc_v2() to authenticated;
grant execute on function public.set_abc_v2_group(text) to authenticated;
grant execute on function public.answer_abc_v2(text, integer) to authenticated;
grant execute on function public.get_my_state() to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.admin_save_experiment_abc(uuid, text, integer, jsonb, text) to authenticated;
grant execute on function public.admin_abc_v2_stats(uuid, text) to authenticated;
grant execute on function public.admin_export(text) to authenticated;
