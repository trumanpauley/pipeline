-- The Pipeline Experiment — Experiment D: circular connection-strength slider.
--
-- Run after 005. Additive: the three existing methods (A strength, B context,
-- C comfort) and all existing data are unchanged.
--
--   * New method "circular": a 0–100 rating given by dragging around a circle.
--     Stored like every other answer (classifications.value = '0'..'100'), so
--     existing exports and the reciprocity analysis keep working.
--   * classifications.question_version records which wording/UI produced each
--     answer ("v1" for A–C, "circular_v1" for D), set automatically.
--   * classification_events records when a question is shown and first
--     interacted with, so completion, abandonment and timing can be compared
--     across methods.
--   * Assignment stays random and balanced, but balancing now counts only from
--     when the method list last changed — otherwise a newly added method would
--     receive every new participant until it "caught up".

-- ---------------------------------------------------------------------------
-- Method, options, versions
-- ---------------------------------------------------------------------------

update public.experiment_settings
  set value = value || jsonb_build_object('circular',
        (select jsonb_agg(g::text order by g) from generate_series(0, 100) g)),
      updated_at = now()
  where key = 'method_options';

insert into public.experiment_settings (key, value, description) values
  ('question_versions', '{"strength": "v1", "context": "v1", "comfort": "v1", "circular": "circular_v1"}',
   'Version tag stored with each answer, per method. Bump when a question''s wording or UI changes.'),
  ('assignment_epoch', to_jsonb(now()),
   'Balanced assignment counts openings since this time. Updated automatically when "methods" changes.')
on conflict (key) do nothing;

-- Add D to the random-assignment pool (existing participants keep their method).
update public.experiment_settings
  set value = value || '["circular"]'::jsonb, updated_at = now()
  where key = 'methods' and not (value ? 'circular');

alter table public.classifications add column if not exists question_version text;

create or replace function public.px_set_question_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.question_version := coalesce(new.question_version, public.px_setting('question_versions') ->> new.method, 'v1');
  return new;
end $$;

create trigger classifications_question_version before insert on public.classifications
  for each row execute function public.px_set_question_version();

-- Answers made before this migration came from the v1 questions.
update public.classifications set question_version = 'v1' where question_version is null;

-- ---------------------------------------------------------------------------
-- Assignment: balanced since the method list last changed
-- ---------------------------------------------------------------------------

create or replace function public.px_pick_method()
returns text language sql volatile security definer set search_path = public as $$
  select m
  from jsonb_array_elements_text(public.px_setting('methods')) m
  left join (
    select assigned_method, count(*) as c from public.invitations
    where assigned_method is not null
      and coalesce(opened_at, created_at) >= coalesce((public.px_setting('assignment_epoch') #>> '{}')::timestamptz, '-infinity')
    group by 1
  ) x on x.assigned_method = m
  order by coalesce(x.c, 0), random()
  limit 1
$$;

create or replace function public.px_bump_assignment_epoch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'methods' and new.value is distinct from old.value then
    update public.experiment_settings set value = to_jsonb(now()), updated_at = now() where key = 'assignment_epoch';
  end if;
  return new;
end $$;

create trigger experiment_settings_methods_epoch after update on public.experiment_settings
  for each row execute function public.px_bump_assignment_epoch();

-- ---------------------------------------------------------------------------
-- Comparable strength (0–1) across methods; context has none
-- ---------------------------------------------------------------------------

create or replace function public.px_strength_score(p_method text, p_value text)
returns numeric language sql immutable as $$
  select case p_method
    when 'strength' then case p_value when 'close_friend' then 1 when 'acquaintance' then 0.5 when 'weak' then 0 end
    when 'comfort' then (p_value::numeric - 1) / 4
    when 'circular' then case when p_value ~ '^\d{1,3}$' then least(p_value::numeric, 100) / 100 end
  end
$$;

-- ---------------------------------------------------------------------------
-- Shown / interacted events (for completion, abandonment and timing)
-- ---------------------------------------------------------------------------

create table public.classification_events (
  id bigint generated always as identity primary key,
  direction text not null check (direction in ('inbound', 'outbound')),
  event text not null check (event in ('shown', 'interacted')),
  method text not null,
  invitation_id uuid references public.invitations(id) on delete cascade, -- inbound: the invitation being answered
  participant_id uuid references public.participants(id) on delete cascade, -- outbound: the participant inviting
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms between 0 and 3600000),
  created_at timestamptz not null default now()
);
create index classification_events_lookup_idx on public.classification_events (method, direction, event);

alter table public.classification_events enable row level security;
create policy "Admins read classification events" on public.classification_events for select to authenticated using (public.is_admin());
revoke all on public.classification_events from anon, authenticated;
grant select on public.classification_events to authenticated;

update public.experiment_settings
  set value = value || '{"classification_events_per_ip_hour": 600}'::jsonb
  where key = 'rate_limits';

-- Inbound (anyone holding an open invitation link) or outbound (a participant).
-- The method is always taken from the server, never from the client.
create or replace function public.log_classification_event(
  p_direction text, p_event text, p_token text default null, p_elapsed_ms integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  me public.participants := public.px_me();
begin
  if p_event not in ('shown', 'interacted') then raise exception 'invalid_value' using errcode = '22023'; end if;
  perform public.px_rate_limit('class_event', public.px_client_ip(), 'classification_events_per_ip_hour', interval '1 hour');
  if p_direction = 'inbound' then
    select * into inv from public.invitations where token = p_token;
    if not found or inv.status not in ('created', 'opened') or inv.assigned_method is null then
      return jsonb_build_object('ok', false);
    end if;
    insert into public.classification_events (direction, event, method, invitation_id, participant_id, elapsed_ms)
    values ('inbound', p_event, inv.assigned_method, inv.id, me.id, public.px_clamp_ms(p_elapsed_ms));
  elsif p_direction = 'outbound' then
    if me.id is null then return jsonb_build_object('ok', false); end if;
    insert into public.classification_events (direction, event, method, participant_id, elapsed_ms)
    values ('outbound', p_event, me.method, me.id, public.px_clamp_ms(p_elapsed_ms));
  else
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Admin analytics per method (A–D comparable)
-- ---------------------------------------------------------------------------

create or replace function public.admin_method_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return jsonb_build_object(
    'methods', coalesce((
      select jsonb_agg(row_to_json(r) order by r.method) from (
        select m.method,
          (select count(*) from public.participants p where p.method = m.method and p.deleted_at is null) as participants,
          -- inbound: one "shown" per invitation; completed = an inbound answer exists
          (select count(distinct e.invitation_id) from public.classification_events e
             where e.method = m.method and e.direction = 'inbound' and e.event = 'shown') as in_shown,
          (select count(*) from public.classifications c
             where c.method = m.method and c.direction = 'inbound'
               and exists (select 1 from public.classification_events e where e.invitation_id = c.invitation_id and e.event = 'shown')) as in_completed,
          -- outbound: each opening of the question vs answers given
          (select count(*) from public.classification_events e
             where e.method = m.method and e.direction = 'outbound' and e.event = 'shown') as out_shown,
          (select count(*) from public.classifications c where c.method = m.method and c.direction = 'outbound'
             and c.created_at >= coalesce((select min(created_at) from public.classification_events), now())) as out_completed,
          (select round(avg(public.px_strength_score(c.method, c.value)) * 100, 1) from public.classifications c
             where c.method = m.method and c.direction = 'inbound') as in_avg_strength,
          (select round(avg(public.px_strength_score(c.method, c.value)) * 100, 1) from public.classifications c
             where c.method = m.method and c.direction = 'outbound') as out_avg_strength,
          (select percentile_cont(0.5) within group (order by c.response_ms) from public.classifications c
             where c.method = m.method and c.direction = 'inbound') as in_median_ms,
          (select percentile_cont(0.5) within group (order by c.response_ms) from public.classifications c
             where c.method = m.method and c.direction = 'outbound') as out_median_ms,
          (select count(*) from public.classifications c where c.method = m.method) as answers
        from (select distinct jsonb_object_keys(public.px_setting('method_options')) as method) m
      ) r), '[]'::jsonb),
    -- Experiment D: distribution by label band and in 10-point bins
    'circular_bands', coalesce((
      select jsonb_agg(row_to_json(b) order by b.ord) from (
        select band.ord, band.label,
          count(c.*) filter (where c.direction = 'inbound') as inbound,
          count(c.*) filter (where c.direction = 'outbound') as outbound
        from (values (1, 'Not well', 0, 0), (2, 'Not very well', 1, 24), (3, 'Somewhat', 25, 49),
                     (4, 'Well', 50, 74), (5, 'Very well', 75, 100)) band(ord, label, lo, hi)
        left join public.classifications c on c.method = 'circular' and c.value::int between band.lo and band.hi
        group by band.ord, band.label) b), '[]'::jsonb),
    'circular_bins', coalesce((
      select jsonb_agg(row_to_json(b) order by b.bin) from (
        select least(c.value::int / 10, 9) * 10 as bin, count(*) as n
        from public.classifications c where c.method = 'circular' group by 1) b), '[]'::jsonb),
    -- Agreement between inviter and recipient, on the comparable 0–100 scale
    'agreement', coalesce((
      select jsonb_agg(row_to_json(a)) from (
        select o.method as sender_method, n.method as recipient_method, count(*) as pairs,
          round(avg(abs(public.px_strength_score(o.method, o.value) - public.px_strength_score(n.method, n.value))) * 100, 1) as mean_abs_gap,
          round(avg(public.px_strength_score(o.method, o.value) - public.px_strength_score(n.method, n.value)) * 100, 1) as mean_sender_minus_recipient
        from public.classifications o
        join public.classifications n on n.invitation_id = o.invitation_id and n.direction = 'inbound'
        where o.direction = 'outbound'
          and public.px_strength_score(o.method, o.value) is not null
          and public.px_strength_score(n.method, n.value) is not null
        group by 1, 2 order by 1, 2) a), '[]'::jsonb)
  );
end $$;

-- Exports: question_version + completed on classifications; events export.
alter function public.admin_export(text) rename to px_admin_export_v4;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'classifications' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select c.id as classification_id, c.invitation_id, c.direction, c.rater_id as participant_id,
        c.method, c.question_version, c.value,
        public.px_strength_score(c.method, c.value) as strength_score,
        true as completed, c.response_ms, c.created_at
      from public.classifications c) r;
    return coalesce(v, '[]'::jsonb);
  elsif p_kind = 'classification_events' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select e.id as event_id, e.direction, e.event, e.method, e.invitation_id, e.participant_id,
        e.elapsed_ms, e.created_at,
        exists (select 1 from public.classifications c
                where (e.direction = 'inbound' and c.invitation_id = e.invitation_id and c.direction = 'inbound')
                   or (e.direction = 'outbound' and c.rater_id = e.participant_id and c.direction = 'outbound'
                       and c.created_at >= e.created_at)) as completed
      from public.classification_events e) r;
    return coalesce(v, '[]'::jsonb);
  end if;
  return public.px_admin_export_v4(p_kind);
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
      and (p.proname like 'px\_%' or p.proname like 'admin\_%' or p.proname = 'log_classification_event')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.log_classification_event(text, text, text, integer) to anon, authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
grant execute on function public.admin_account_stats() to authenticated;
grant execute on function public.admin_names() to authenticated;
grant execute on function public.admin_moderate(text, uuid, text, text, text) to authenticated;
grant execute on function public.admin_method_stats() to authenticated;
