-- The Pipeline Experiment — connection strength and the ABC experiment.
--
-- Run after 011. Additive: no existing participant, link, answer or tree
-- changes.
--
-- Connection strength
--   * relationship_ratings: one row per (invitation, direction). Today the
--     invitee rates the person who invited them ('inbound'): closeness 1–5
--     ("How close are you to …?") and, unless their assigned question already
--     was the comfort question, comfort asking for an introduction 1–5. Rows
--     are directional (rater → ratee), so the inviter's rating of the same
--     relationship ('outbound') can be added later without schema changes.
--   * The new 5-point closeness question supersedes method A (3-point "How
--     close are you to …?"), which is taken out of the rotation for NEW links
--     so invitees aren't asked the same thing twice. Existing method-A answers
--     and participants are untouched. To bring it back:
--       update experiment_settings set value = value || '["strength"]' where key = 'methods';
--   * View relationship_strength: closeness plus comfort (from this table, or
--     from the method-C answer to the same invitation, without duplicating it).
--
-- Test experiments
--   * experiments.is_test: an experiment for rehearsing the real flow on a phone
--     (seed link → join → invite → generation 3 → ABC). Its data is left out of
--     the ABC and connection-strength analytics unless picked in the filter.
--     The admin dashboard's preview runs the questions without saving at all.
--
-- Participant classification
--   * participants.classification: the scenario group ('student' / 'alumni'),
--     set from the join-screen category. Each experiment's abc_scenarios lists
--     its groups ({key, label, scenario}), so other communities can define
--     their own later.
--   * The original experiment now asks "Current Harvard student" /
--     "Harvard alumnus/alumna" at join (only if it asked nothing before).
--
-- ABC experiment
--   * Shown to participants at generation >= experiments.abc_min_depth
--     (default 3: seed-link joiners are generation 1, their invitees 2, so
--     generation 3 is "depth 2" counting seed participants as depth 0).
--   * abc_responses: one row per participant (no duplicates), created on first
--     view with a random Jane/John and question order, so both stay fixed if
--     they come back later. Answers are saved one at a time (resumable) and
--     locked once both are in.

-- ---------------------------------------------------------------------------
-- Relationship ratings
-- ---------------------------------------------------------------------------

create table if not exists public.relationship_ratings (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id),
  direction text not null check (direction in ('inbound', 'outbound')),
  rater_id uuid references public.participants(id) on delete cascade, -- null until an anonymous invitee joins
  ratee_id uuid references public.participants(id) on delete set null, -- inbound: the inviter (null on seed links)
  closeness smallint check (closeness between 1 and 5),
  comfort smallint check (comfort between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invitation_id, direction)
);

create index if not exists relationship_ratings_experiment_idx on public.relationship_ratings (experiment_id);
create index if not exists relationship_ratings_rater_idx on public.relationship_ratings (rater_id);

alter table public.relationship_ratings enable row level security;
revoke all on public.relationship_ratings from anon, authenticated;

create or replace view public.relationship_strength with (security_invoker = true) as
select r.id, r.invitation_id, r.experiment_id, r.direction, r.rater_id, r.ratee_id, r.closeness,
  coalesce(r.comfort, (
    select c.value::smallint from public.classifications c
    where c.invitation_id = r.invitation_id and c.direction = r.direction and c.method = 'comfort')) as comfort,
  r.created_at, r.updated_at
from public.relationship_ratings r;

revoke all on public.relationship_strength from anon, authenticated;

update public.experiment_settings
  set value = value - 'strength'
  where key = 'methods' and value ? 'strength' and jsonb_array_length(value) > 1;

update public.experiment_settings
  set value = value || '{"relationship_ratings_per_ip_hour": 300, "abc_answers_per_ip_hour": 300}'::jsonb
  where key = 'rate_limits' and not value ? 'relationship_ratings_per_ip_hour';

-- ---------------------------------------------------------------------------
-- Classification and ABC settings per experiment
-- ---------------------------------------------------------------------------

alter table public.participants
  add column if not exists classification text check (classification is null or char_length(classification) <= 40);

alter table public.experiments
  -- Test experiments: real joins for rehearsing the whole flow, left out of the analytics.
  add column if not exists is_test boolean not null default false,
  add column if not exists abc_enabled boolean not null default true,
  add column if not exists abc_min_depth integer not null default 3 check (abc_min_depth >= 1),
  add column if not exists abc_scenarios jsonb not null default '[
    {"key": "student", "label": "Current Harvard student",
     "scenario": "Imagine {name} is an incoming Harvard student looking for advice on which classes to take."},
    {"key": "alumni", "label": "Harvard alumnus/alumna",
     "scenario": "Imagine {name} is a Harvard junior looking for advice about internship opportunities."}
  ]'::jsonb check (jsonb_typeof(abc_scenarios) = 'array');

-- The original experiment didn't ask; it now asks the two Harvard groups.
update public.experiments
  set categories = '["Current Harvard student", "Harvard alumnus/alumna"]'::jsonb
  where is_default and categories = '[]'::jsonb;

-- A join-screen category → the experiment's scenario group. Exact label first,
-- then the obvious words (so "Current Student" / "Alumni" also work).
create or replace function public.px_classify(p_experiment uuid, p_label text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s ->> 'key' from public.experiments e, jsonb_array_elements(e.abc_scenarios) s
      where e.id = p_experiment and lower(s ->> 'label') = lower(btrim(p_label)) limit 1),
    case
      when p_label ~* 'alum' then 'alumni'
      when p_label ~* 'student|undergrad|current' then 'student'
    end)
$$;

update public.participants p set classification = public.px_classify(p.experiment_id, p.category)
  where p.classification is null and p.category is not null;

-- ---------------------------------------------------------------------------
-- ABC responses
-- ---------------------------------------------------------------------------

create table if not exists public.abc_responses (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id),
  invitation_id uuid references public.invitations(id) on delete set null,
  inviter_id uuid references public.participants(id) on delete set null,
  depth integer not null,
  classification text not null,
  fictional_name text not null check (fictional_name in ('Jane', 'John')),
  scenario text not null,
  question_order text not null check (question_order in ('cold_first', 'warm_first')),
  cold smallint check (cold between 1 and 5),
  cold_at timestamptz,
  warm smallint check (warm between 1 and 5),
  warm_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists abc_responses_experiment_idx on public.abc_responses (experiment_id);

alter table public.abc_responses enable row level security;
revoke all on public.abc_responses from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Participant RPCs
-- ---------------------------------------------------------------------------

-- The invitee rates the person who invited them (before or after joining; the
-- row is linked to their participant record when they join).
create or replace function public.rate_relationship(p_token text, p_closeness integer, p_comfort integer default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  me public.participants;
begin
  if p_closeness is null or p_closeness not between 1 and 5
     or (p_comfort is not null and p_comfort not between 1 and 5) then
    return jsonb_build_object('error', 'invalid_value');
  end if;
  select * into inv from public.invitations where token = p_token;
  if not found or inv.status not in ('created', 'opened') then
    return jsonb_build_object('error', 'invalid_invitation');
  end if;
  if (select status from public.experiments where id = inv.experiment_id) <> 'active' then
    return jsonb_build_object('error', 'experiment_paused');
  end if;
  perform public.px_rate_limit('relationship', public.px_client_ip(), 'relationship_ratings_per_ip_hour', interval '1 hour');
  perform public.px_scope(inv.experiment_id);
  me := public.px_me();
  insert into public.relationship_ratings (invitation_id, experiment_id, direction, rater_id, ratee_id, closeness, comfort)
  values (inv.id, inv.experiment_id, 'inbound', me.id, inv.sender_id, p_closeness, p_comfort)
  on conflict (invitation_id, direction) do update
    set closeness = excluded.closeness, comfort = excluded.comfort,
        rater_id = excluded.rater_id, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Joining links the rating to the new (or existing) participant and sets the
-- scenario group from the join-screen category.
alter function public.accept_invitation(text, text, boolean, boolean, text, text) rename to px_accept_invitation_v11;

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
  v jsonb := public.px_accept_invitation_v11(p_token, p_display_name, p_research_consent, p_marketing_consent, p_device, p_category);
  inv public.invitations;
  me public.participants;
begin
  if v ->> 'state' in ('joined', 'already_participant') then
    select * into inv from public.invitations where token = p_token;
    perform public.px_scope(inv.experiment_id);
    me := public.px_me();
    if me.id is not null then
      update public.relationship_ratings set rater_id = me.id, updated_at = now()
        where invitation_id = inv.id and direction = 'inbound' and (rater_id is null or rater_id = me.id);
      if me.classification is null and me.category is not null then
        update public.participants set classification = public.px_classify(me.experiment_id, me.category)
          where id = me.id;
      end if;
    end if;
  end if;
  return v;
end $$;

-- A forwarded link: the stranger's rating of the sender is discarded too.
alter function public.report_wrong_recipient(text) rename to px_report_wrong_recipient_v11;

create or replace function public.report_wrong_recipient(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb := public.px_report_wrong_recipient_v11(p_token);
begin
  if (v ->> 'ok')::boolean then
    delete from public.relationship_ratings r using public.invitations i
      where r.invitation_id = i.id and i.token = p_token and r.direction = 'inbound' and r.rater_id is null;
  end if;
  return v;
end $$;

create or replace function public.px_abc_eligible(me public.participants)
returns boolean language sql stable security definer set search_path = public as $$
  select me.id is not null and me.deleted_at is null and me.suspended_at is null and me.parent_id is not null
    and exists (select 1 from public.experiments e
                where e.id = me.experiment_id and e.abc_enabled and me.depth >= e.abc_min_depth)
$$;

create or replace function public.px_abc_payload(r public.abc_responses)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eligible', true,
    'name', r.fictional_name,
    'scenario', r.scenario,
    'order', r.question_order,
    'classification', r.classification,
    'cold', r.cold,
    'warm', r.warm,
    'completed', r.completed_at is not null,
    -- The inviter's approved first name (never a hidden or flagged one).
    'inviter_name', (
      select nullif(split_part(coalesce(s.display_name, ''), ' ', 1), '')
      from public.participants s
      where s.id = r.inviter_id and s.name_status = 'ok' and s.suspended_at is null and s.deleted_at is null))
$$;

-- Everything the ABC screens need. Creates the response row (with Jane/John
-- and the question order drawn at random) the first time, so the assignment
-- stays the same on every later visit.
create or replace function public.get_abc()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  e public.experiments;
  r public.abc_responses;
  v_scenario text;
  v_name text;
begin
  if not public.px_abc_eligible(me) then
    return jsonb_build_object('eligible', false);
  end if;
  select * into r from public.abc_responses where participant_id = me.id;
  if found then
    return public.px_abc_payload(r);
  end if;
  select * into e from public.experiments where id = me.experiment_id;
  select s ->> 'scenario' into v_scenario from jsonb_array_elements(e.abc_scenarios) s
    where s ->> 'key' = me.classification limit 1;
  if me.classification is null or v_scenario is null then
    -- Ask which group they're in first (one tap).
    return jsonb_build_object('eligible', true, 'needs_classification', true,
      'groups', (select coalesce(jsonb_agg(jsonb_build_object('key', s ->> 'key', 'label', s ->> 'label')), '[]'::jsonb)
                 from jsonb_array_elements(e.abc_scenarios) s));
  end if;
  v_name := case when random() < 0.5 then 'Jane' else 'John' end;
  insert into public.abc_responses (participant_id, experiment_id, invitation_id, inviter_id, depth,
    classification, fictional_name, scenario, question_order)
  values (me.id, me.experiment_id, me.invitation_id, me.parent_id, me.depth, me.classification, v_name,
    replace(v_scenario, '{name}', v_name),
    case when random() < 0.5 then 'cold_first' else 'warm_first' end)
  on conflict (participant_id) do nothing
  returning * into r;
  if r.participant_id is null then
    select * into r from public.abc_responses where participant_id = me.id;
  end if;
  return public.px_abc_payload(r);
end $$;

-- For participants who joined before the group was asked.
create or replace function public.set_my_classification(p_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
begin
  if me.id is null then
    return jsonb_build_object('error', 'not_participant');
  end if;
  if not exists (select 1 from public.experiments e, jsonb_array_elements(e.abc_scenarios) s
                 where e.id = me.experiment_id and s ->> 'key' = p_key) then
    return jsonb_build_object('error', 'invalid_value');
  end if;
  if exists (select 1 from public.abc_responses where participant_id = me.id) then
    return jsonb_build_object('error', 'abc_started');
  end if;
  update public.participants set classification = p_key where id = me.id;
  return jsonb_build_object('ok', true);
end $$;

-- One answer at a time (so a half-finished questionnaire can be resumed);
-- locked once both are in.
create or replace function public.answer_abc(p_question text, p_value integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  r public.abc_responses;
begin
  if p_question not in ('cold', 'warm') or p_value is null or p_value not between 1 and 5 then
    return jsonb_build_object('error', 'invalid_value');
  end if;
  select * into r from public.abc_responses where participant_id = me.id for update;
  if not found then
    return jsonb_build_object('error', 'not_participant');
  end if;
  if r.completed_at is not null then
    return jsonb_build_object('error', 'abc_completed');
  end if;
  perform public.px_rate_limit('abc', public.px_client_ip(), 'abc_answers_per_ip_hour', interval '1 hour');
  update public.abc_responses set
    cold = case when p_question = 'cold' then p_value else cold end,
    cold_at = case when p_question = 'cold' then now() else cold_at end,
    warm = case when p_question = 'warm' then p_value else warm end,
    warm_at = case when p_question = 'warm' then now() else warm_at end
  where participant_id = me.id
  returning * into r;
  if r.cold is not null and r.warm is not null then
    update public.abc_responses set completed_at = now() where participant_id = me.id returning * into r;
  end if;
  return public.px_abc_payload(r);
end $$;

alter function public.get_my_state() rename to px_get_my_state_v11;

create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_get_my_state_v11();
  me public.participants := public.px_me();
begin
  if me.id is null then return v; end if;
  return v || jsonb_build_object('abc', jsonb_build_object(
    'eligible', public.px_abc_eligible(me),
    'completed', exists (select 1 from public.abc_responses where participant_id = me.id and completed_at is not null)));
end $$;

-- Erasure: the person's own ratings and ABC answers, in every experiment.
alter function public.delete_my_data() rename to px_delete_my_data_v11;

create or replace function public.delete_my_data()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.relationship_ratings where rater_id in
    (select id from public.participants where user_id = auth.uid() and deleted_at is null);
  delete from public.abc_responses where participant_id in
    (select id from public.participants where user_id = auth.uid() and deleted_at is null);
  update public.participants set classification = null
    where user_id = auth.uid() and deleted_at is null;
  return public.px_delete_my_data_v11();
end $$;

-- ---------------------------------------------------------------------------
-- Admin analytics (associations in self-reported answers, not causal effects)
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_experiment_test(p_experiment_id uuid, p_is_test boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  update public.experiments set is_test = coalesce(p_is_test, false), updated_at = now() where id = p_experiment_id;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Optional filters: one experiment, one participant group. Test experiments
-- are left out unless one is picked explicitly.
create or replace function public.admin_abc_stats(p_experiment_id uuid default null, p_classification text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  with
  p as (
    select * from public.participants
    where deleted_at is null
      and (case when p_experiment_id is null
                then experiment_id not in (select id from public.experiments where is_test)
                else experiment_id = p_experiment_id end)
      and (p_classification is null or classification = p_classification)),
  elig as (
    select p.* from p join public.experiments e on e.id = p.experiment_id
    where e.abc_enabled and p.depth >= e.abc_min_depth and p.parent_id is not null),
  a as (
    select r.*, (r.warm - r.cold) as adv from public.abc_responses r join p on p.id = r.participant_id
    where r.completed_at is not null),
  -- each participant's rating of the person whose link they joined through
  rs as (
    select s.*, p.depth, p.classification as rater_class from public.relationship_strength s
    join p on p.id = s.rater_id
    where s.direction = 'inbound' and s.invitation_id = p.invitation_id and s.closeness is not null),
  ar as (
    select a.*, rs.closeness, rs.comfort from a left join rs on rs.rater_id = a.participant_id)
  select jsonb_build_object(
    'participation', jsonb_build_object(
      'eligible', (select count(*) from elig),
      'started', (select count(*) from public.abc_responses r join elig on elig.id = r.participant_id),
      'completed', (select count(*) from a)),
    'by_experiment', coalesce((
      select jsonb_agg(jsonb_build_object('experiment_id', e.id, 'name', e.name,
        'eligible', (select count(*) from elig where elig.experiment_id = e.id),
        'completed', (select count(*) from a where a.experiment_id = e.id),
        'avg_cold', (select round(avg(cold), 2) from a where a.experiment_id = e.id),
        'avg_warm', (select round(avg(warm), 2) from a where a.experiment_id = e.id),
        'avg_advantage', (select round(avg(adv), 2) from a where a.experiment_id = e.id))
        order by e.is_default desc, e.created_at)
      from public.experiments e where (p_experiment_id is null and not e.is_test) or e.id = p_experiment_id), '[]'::jsonb),
    'outreach', jsonb_build_object(
      'avg_cold', (select round(avg(cold), 2) from a),
      'avg_warm', (select round(avg(warm), 2) from a),
      'avg_advantage', (select round(avg(adv), 2) from a),
      'cold_dist', (select jsonb_agg((select count(*) from a where cold = k) order by k) from generate_series(1, 5) k),
      'warm_dist', (select jsonb_agg((select count(*) from a where warm = k) order by k) from generate_series(1, 5) k),
      'advantage_dist', (select jsonb_agg(jsonb_build_object('advantage', k, 'n', (select count(*) from a where adv = k)) order by k)
                         from generate_series(-4, 4) k),
      'by_order', coalesce((select jsonb_agg(jsonb_build_object('order', question_order, 'n', n, 'avg_cold', ac, 'avg_warm', aw))
                   from (select question_order, count(*) n, round(avg(cold), 2) ac, round(avg(warm), 2) aw from a group by 1) o), '[]'::jsonb),
      'by_name', coalesce((select jsonb_agg(jsonb_build_object('name', fictional_name, 'n', n, 'avg_advantage', av))
                   from (select fictional_name, count(*) n, round(avg(adv), 2) av from a group by 1) o), '[]'::jsonb)),
    'by_classification', coalesce((
      select jsonb_agg(jsonb_build_object('classification', c, 'abc_n', abc_n, 'avg_cold', ac, 'avg_warm', aw, 'avg_advantage', av,
                                          'ratings_n', rn, 'avg_closeness', acl) order by c)
      from (
        select coalesce(x.c, y.c) as c, x.abc_n, x.ac, x.aw, x.av, y.rn, y.acl from
          (select classification c, count(*) abc_n, round(avg(cold), 2) ac, round(avg(warm), 2) aw, round(avg(adv), 2) av
             from a group by 1) x
          full join (select coalesce(rater_class, 'not given') c, count(*) rn, round(avg(closeness), 2) acl
             from rs group by 1) y on y.c = x.c) t), '[]'::jsonb),
    'by_depth', coalesce((
      select jsonb_agg(jsonb_build_object('depth', d, 'ratings_n', rn, 'avg_closeness', acl, 'abc_n', abc_n, 'avg_advantage', av) order by d)
      from (
        select coalesce(x.d, y.d) as d, x.rn, x.acl, y.abc_n, y.av from
          (select depth d, count(*) rn, round(avg(closeness), 2) acl from rs group by 1) x
          full join (select depth d, count(*) abc_n, round(avg(adv), 2) av from a group by 1) y on y.d = x.d) t), '[]'::jsonb),
    'strength', jsonb_build_object(
      'ratings_n', (select count(*) from rs),
      'avg_closeness', (select round(avg(closeness), 2) from rs),
      'closeness_dist', (select jsonb_agg((select count(*) from rs where closeness = k) order by k) from generate_series(1, 5) k),
      'advantage_by_closeness', (select jsonb_agg(jsonb_build_object('closeness', k,
          'n', (select count(*) from ar where closeness = k),
          'avg_cold', (select round(avg(cold), 2) from ar where closeness = k),
          'avg_warm', (select round(avg(warm), 2) from ar where closeness = k),
          'avg_advantage', (select round(avg(adv), 2) from ar where closeness = k)) order by k)
        from generate_series(1, 5) k),
      'comfort_by_closeness', (select jsonb_agg(jsonb_build_object('closeness', k,
          'n', (select count(*) from rs where closeness = k and comfort is not null),
          'avg_comfort', (select round(avg(comfort), 2) from rs where closeness = k),
          'comfort_dist', (select jsonb_agg((select count(*) from rs where closeness = k and comfort = j) order by j)
                           from generate_series(1, 5) j)) order by k)
        from generate_series(1, 5) k))
  ) into v;
  return v;
end $$;

alter function public.admin_export(text) rename to px_admin_export_v11;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'abc' then
    -- Anonymised: random ids only, no names or emails.
    select jsonb_agg(row_to_json(r) order by r.completed_at nulls last) into v from (
      select a.participant_id, a.experiment_id, e.name as experiment, e.is_test as test_experiment, a.depth, a.inviter_id,
        a.classification, a.fictional_name, a.question_order, a.cold, a.warm, (a.warm - a.cold) as advantage,
        s.closeness, s.comfort, a.started_at, a.cold_at, a.warm_at, a.completed_at
      from public.abc_responses a
      join public.participants p on p.id = a.participant_id and p.deleted_at is null
      join public.experiments e on e.id = a.experiment_id
      left join public.relationship_strength s
        on s.rater_id = a.participant_id and s.invitation_id = p.invitation_id and s.direction = 'inbound') r;
    return coalesce(v, '[]'::jsonb);
  elsif p_kind = 'relationships' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select s.invitation_id, s.experiment_id, (select is_test from public.experiments where id = s.experiment_id) as test_experiment,
        s.direction, s.rater_id, s.ratee_id,
        p.depth as rater_depth, p.classification as rater_classification,
        (s.invitation_id = p.invitation_id) as is_primary_referral,
        s.closeness, s.comfort, s.created_at, s.updated_at
      from public.relationship_strength s
      join public.participants p on p.id = s.rater_id and p.deleted_at is null) r;
    return coalesce(v, '[]'::jsonb);
  end if;
  return public.px_admin_export_v11(p_kind);
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
        'rate_relationship', 'accept_invitation', 'report_wrong_recipient', 'get_abc', 'set_my_classification',
        'answer_abc', 'get_my_state', 'delete_my_data'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.rate_relationship(text, integer, integer) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean, boolean, text, text) to authenticated;
grant execute on function public.report_wrong_recipient(text) to anon, authenticated;
grant execute on function public.get_abc() to authenticated;
grant execute on function public.set_my_classification(text) to authenticated;
grant execute on function public.answer_abc(text, integer) to authenticated;
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
grant execute on function public.admin_method_stats() to authenticated;
grant execute on function public.admin_community_stats() to authenticated;
grant execute on function public.admin_save_experiment(uuid, text, text, text, integer, jsonb, text) to authenticated;
grant execute on function public.admin_create_experiment_seeds(uuid, integer, text, text) to authenticated;
grant execute on function public.admin_experiments() to authenticated;
grant execute on function public.admin_experiment_detail(uuid) to authenticated;
grant execute on function public.admin_abc_stats(uuid, text) to authenticated;
grant execute on function public.admin_set_experiment_test(uuid, boolean) to authenticated;
