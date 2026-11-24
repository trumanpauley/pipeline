-- The Pipeline Experiment — pre-launch updates (community branding, referral kinds, optional
-- additional invitations, anonymous feedback, launch analytics).
--
-- Run after 017. ADDITIVE and NON-DESTRUCTIVE: nothing is dropped, no rows are deleted, existing
-- links, participants, ratings and settings are untouched. Safe to run more than once.
--
--   1. experiments           community_name, completion_message and three on/off settings
--                            (allow_additional_invites, enable_feedback, enable_waitlist).
--                            Everything else an admin can customise already exists and is reused
--                            (title = public_title, intro = welcome_message, eligibility question,
--                            share messages, link preview title/description/image, ABC toggle).
--   2. invitations.kind      seed_personal | seed_broadcast | standard | additional.
--                            Existing links are backfilled (founder seeds → seed_personal, links
--                            participants made → standard); new links get their kind automatically.
--   3. participants.completed_at   when a participant first completed the experiment.
--   4. create_additional_invitation()   voluntary extra invitations after completion. They are
--                            stored apart from the standardised two-invitation data (the inviter's
--                            0–100 rating goes on the invitation, not into `classifications`) and
--                            never change anyone's completion status.
--   5. experiment_feedback   optional feedback, deliberately NOT linked to participants.
--   6. Admin functions       seed links with kind + label, launch analytics, feedback review, and a
--                            richer waitlist view. All admin-only (px_require_admin).

-- ───────────────────────── 1. Per-experiment settings ─────────────────────────
alter table public.experiments
  add column if not exists community_name text,
  add column if not exists completion_message text,
  add column if not exists allow_additional_invites boolean not null default false,
  add column if not exists enable_feedback boolean not null default false,
  add column if not exists enable_waitlist boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'experiments_launch_text_check') then
    alter table public.experiments add constraint experiments_launch_text_check check (
      (community_name is null or char_length(community_name) between 1 and 60)
      and (completion_message is null or char_length(completion_message) <= 300));
  end if;
end $$;

-- Rate limits for the new actions (only added if missing; existing values are kept).
update public.experiment_settings
   set value = jsonb_build_object('feedback_per_ip_hour', 10, 'additional_invites_per_participant_hour', 20) || value
 where key = 'rate_limits';
insert into public.experiment_settings (key, value)
values ('max_additional_invites', '60'::jsonb)
on conflict (key) do nothing;

-- What visitors and participants see of an experiment (adds the new fields).
create or replace function public.px_experiment_public(e public.experiments)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'description', e.description,
    'invite_instruction', e.invite_instruction, 'categories', e.categories,
    'invites_per_participant', e.invites_per_participant,
    'status', e.status, 'is_default', e.is_default,
    'welcome_message', e.welcome_message,
    'ask_relationship_question', e.ask_relationship_question,
    'slug', e.slug,
    'public_title', e.public_title,
    'forward_message', e.forward_message,
    'community_name', e.community_name,
    'completion_message', e.completion_message,
    'allow_additional_invites', e.allow_additional_invites,
    'enable_feedback', e.enable_feedback,
    'enable_waitlist', e.enable_waitlist,
    'eligibility', case when e.eligibility_enabled and e.eligibility_question is not null then jsonb_build_object(
      'question', e.eligibility_question,
      'eligible_label', e.eligible_label,
      'ineligible_label', e.ineligible_label,
      'ineligible_message', coalesce(e.ineligible_message,
        'This experiment is currently for ' || e.name || ' members. Thanks for your interest.')) end)
$$;

create or replace function public.admin_save_experiment_launch(
  p_experiment_id uuid,
  p_community_name text,
  p_completion_message text,
  p_allow_additional_invites boolean,
  p_enable_feedback boolean,
  p_enable_waitlist boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_community text := public.px_tidy_name(p_community_name);
  v_message text := public.px_tidy_text(p_completion_message);
  e public.experiments;
begin
  perform public.px_require_admin();
  if char_length(coalesce(v_community, '')) > 60 or char_length(coalesce(v_message, '')) > 300 then
    raise exception 'invalid_experiment_text' using errcode = '22023';
  end if;
  update public.experiments set
    community_name = v_community,
    completion_message = v_message,
    allow_additional_invites = coalesce(p_allow_additional_invites, false),
    enable_feedback = coalesce(p_enable_feedback, false),
    enable_waitlist = coalesce(p_enable_waitlist, true),
    updated_at = now()
  where id = p_experiment_id
  returning * into e;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  return to_jsonb(e);
end $$;

-- admin_experiments() lists each experiment with its stored settings: include the new ones.
-- (It returns to_jsonb of the row plus stats, so the new columns come through; nothing to change.)

-- ───────────────────────── 2. Referral kinds ─────────────────────────
alter table public.invitations
  add column if not exists kind text,
  add column if not exists sender_strength text;

update public.invitations
   set kind = case when sender_id is null then 'seed_personal' else 'standard' end
 where kind is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invitations_kind_check') then
    alter table public.invitations add constraint invitations_kind_check
      check (kind in ('seed_personal', 'seed_broadcast', 'standard', 'additional'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invitations_sender_strength_check') then
    alter table public.invitations add constraint invitations_sender_strength_check
      check (sender_strength is null or sender_strength ~ '^(100|[0-9]{1,2})$');
  end if;
end $$;
create index if not exists invitations_kind_idx on public.invitations (experiment_id, kind);

-- New invitations get their kind automatically: an admin function or the additional-invitation
-- function sets px.invite_kind for the statement; otherwise seeds are personal and
-- participant links are standard. Existing code paths therefore keep working unchanged.
create or replace function public.px_invitation_kind()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind is null then
    new.kind := coalesce(nullif(current_setting('px.invite_kind', true), ''),
                         case when new.sender_id is null then 'seed_personal' else 'standard' end);
  end if;
  return new;
end $$;

drop trigger if exists invitations_kind on public.invitations;
create trigger invitations_kind before insert on public.invitations
  for each row execute function public.px_invitation_kind();

-- Seed links with a kind and an internal label (never shown to participants).
--   personal  : handed out by a founder/admin. The inviter's name is shown on the invitation.
--   broadcast : posted to a group chat or list. No name is stored, so no personal relationship
--               between the admin and every recipient is implied; no strength is ever recorded.
create or replace function public.admin_create_experiment_seeds_v2(
  p_experiment_id uuid,
  p_count integer,
  p_sender_name text,
  p_label text,
  p_kind text default 'personal'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_kind text := case p_kind when 'broadcast' then 'seed_broadcast' when 'personal' then 'seed_personal' end;
  v_label text := public.px_tidy_name(p_label);
begin
  perform public.px_require_admin();
  if v_kind is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if not exists (select 1 from public.experiments where id = p_experiment_id) then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if char_length(coalesce(v_label, '')) > 80 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if v_kind = 'seed_personal' and public.px_name_problem(p_sender_name) is not null then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  perform set_config('px.seed_experiment', p_experiment_id::text, true);
  perform set_config('px.invite_kind', v_kind, true);
  v := public.px_admin_create_seed_invitations_core(
    p_count, case when v_kind = 'seed_personal' then public.px_tidy_name(p_sender_name) end, v_label);
  perform set_config('px.seed_experiment', '', true);
  perform set_config('px.invite_kind', '', true);
  return v;
end $$;

-- Relabel or re-kind a seed link later (only unused seeds can change kind).
create or replace function public.admin_update_seed(p_invitation_id uuid, p_label text, p_kind text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  v_label text := public.px_tidy_name(p_label);
begin
  perform public.px_require_admin();
  if char_length(coalesce(v_label, '')) > 80 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  select * into inv from public.invitations where id = p_invitation_id and sender_id is null;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  update public.invitations set admin_note = v_label where id = inv.id;
  if p_kind is not null and p_kind in ('personal', 'broadcast') then
    if inv.status in ('created', 'opened') then
      update public.invitations set kind = case p_kind when 'broadcast' then 'seed_broadcast' else 'seed_personal' end,
             sender_name = case when p_kind = 'broadcast' then null else sender_name end
       where id = inv.id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── 3. Completion time ─────────────────────────
alter table public.participants add column if not exists completed_at timestamptz;

create or replace function public.px_participant_completed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reveal_level >= 2 and (old.reveal_level is null or old.reveal_level < 2) and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists participants_completed on public.participants;
create trigger participants_completed before update of reveal_level on public.participants
  for each row execute function public.px_participant_completed();

-- ───────────────────────── 4. Additional invitations ─────────────────────────
-- A participant who has completed the experiment may invite more people, one at a time:
-- a name, how well they know them (0–100, the same circular slider), and a unique link.
-- No broadcast link. Completion status, the two standard invitations and the standardised
-- classification data are not touched.
create or replace function public.create_additional_invitation(p_value text, p_recipient_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  e public.experiments;
  v_label text;
  v_cap integer := coalesce((public.px_setting('max_additional_invites') #>> '{}')::int, 60);
  inv public.invitations;
begin
  if me.id is null then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if me.suspended_at is not null then
    raise exception 'suspended' using errcode = '42501';
  end if;
  select * into e from public.experiments where id = me.experiment_id;
  perform public.px_scope(e.id);
  if e.status <> 'active' then
    raise exception 'experiment_paused' using errcode = '22023';
  end if;
  if not e.allow_additional_invites then
    raise exception 'additional_invites_off' using errcode = '22023';
  end if;
  if me.reveal_level < 2 then
    raise exception 'not_complete' using errcode = '22023';
  end if;
  if p_value is null or p_value !~ '^(100|[0-9]{1,2})$' then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if public.px_tidy_name(p_recipient_label) is null then
    return jsonb_build_object('error', 'invalid_name_format');
  end if;
  v_label := public.px_format_name(p_recipient_label);
  if v_label is null then
    return jsonb_build_object('error', 'invalid_name_format');
  end if;
  v_label := public.px_name_gate(v_label, me.id::text);
  if v_label is null then
    return jsonb_build_object('error', 'invalid_name');
  end if;

  perform public.px_rate_limit('additional_invite', me.id::text, 'additional_invites_per_participant_hour', interval '1 hour');
  -- Serialise per participant so the cap can't be raced.
  perform 1 from public.participants where id = me.id for update;
  if (select count(*) from public.invitations where sender_id = me.id and kind = 'additional') >= v_cap then
    raise exception 'link_limit' using errcode = '22023';
  end if;

  perform set_config('px.invite_kind', 'additional', true);
  insert into public.invitations (token, sender_id, recipient_label, sender_strength)
  values (public.px_new_token(), me.id, v_label, p_value)
  returning * into inv;
  perform set_config('px.invite_kind', '', true);
  return jsonb_build_object('id', inv.id, 'token', inv.token);
end $$;

-- get_my_state(): keep "my two invitations" exactly as before (additional ones are listed
-- separately), and report what the completion page needs.
do $$
begin
  if to_regprocedure('public.px_get_my_state_v18()') is null then
    alter function public.get_my_state() rename to px_get_my_state_v18;
  end if;
end $$;

create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_get_my_state_v18();
  me public.participants := public.px_me();
  e public.experiments;
begin
  if me.id is null then return v; end if;
  select * into e from public.experiments where id = me.experiment_id;
  v := jsonb_set(v, '{invitations}', coalesce((
    select jsonb_agg(el order by ord)
    from jsonb_array_elements(coalesce(v -> 'invitations', '[]'::jsonb)) with ordinality t(el, ord)
    where not exists (
      select 1 from public.invitations a where a.id = (el ->> 'id')::uuid and a.kind = 'additional')), '[]'::jsonb));
  return v || jsonb_build_object('additional', jsonb_build_object(
    'allowed', coalesce(e.allow_additional_invites, false) and me.reveal_level >= 2,
    'created', (select count(*) from public.invitations i where i.sender_id = me.id and i.kind = 'additional'),
    'joined', (select count(*) from public.invitations i where i.sender_id = me.id and i.kind = 'additional' and i.status = 'accepted'),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'token', i.token, 'recipient_label', i.recipient_label, 'status', i.status,
        'created_at', i.created_at) order by i.created_at desc)
      from (select * from public.invitations x
            where x.sender_id = me.id and x.kind = 'additional'
            order by x.created_at desc limit 20) i), '[]'::jsonb)));
end $$;

-- ───────────────────────── 5. Optional feedback ─────────────────────────
-- Deliberately NOT linked to participants, invitations or relationship data. Stored:
-- the text, the experiment (group), the WEEK it was sent (not the time), an optional contact
-- email with explicit consent, and a review status. Nothing here is readable through the API;
-- only the admin function below reads it. Rate limiting uses a salted hash of the network
-- address in rate_events, which is deleted within two days and is not linked to this table.
create table if not exists public.experiment_feedback (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id),
  body text not null check (char_length(body) between 1 and 2000),
  week date not null default (date_trunc('week', now()))::date,
  contact_ok boolean not null default false,
  contact_email text check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  status text not null default 'new' check (status in ('new', 'reviewed')),
  reviewed_at timestamptz,
  check (contact_ok or contact_email is null)
);
alter table public.experiment_feedback enable row level security;
revoke all on public.experiment_feedback from public, anon, authenticated;
create index if not exists experiment_feedback_experiment_idx on public.experiment_feedback (experiment_id, status);

create or replace function public.submit_experiment_feedback(p_body text, p_contact_ok boolean default false, p_email text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  e public.experiments;
  v_body text := public.px_tidy_text(p_body);
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if me.id is null then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  select * into e from public.experiments where id = me.experiment_id;
  if not coalesce(e.enable_feedback, false) then
    raise exception 'feedback_off' using errcode = '22023';
  end if;
  if v_body is null or char_length(v_body) > 2000 then
    raise exception 'invalid_feedback' using errcode = '22023';
  end if;
  if coalesce(p_contact_ok, false) then
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
      raise exception 'invalid_email' using errcode = '22023';
    end if;
  else
    v_email := null;
  end if;
  perform public.px_rate_limit('feedback', public.px_client_ip(), 'feedback_per_ip_hour', interval '1 hour');
  -- Nothing about me (id, name, invitation, rating) goes into the row.
  insert into public.experiment_feedback (experiment_id, body, contact_ok, contact_email)
  values (e.id, v_body, coalesce(p_contact_ok, false), v_email);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_feedback_list(p_experiment_id uuid default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'total', (select count(*) from public.experiment_feedback where p_experiment_id is null or experiment_id = p_experiment_id),
      'new', (select count(*) from public.experiment_feedback where status = 'new' and (p_experiment_id is null or experiment_id = p_experiment_id)),
      'with_contact', (select count(*) from public.experiment_feedback where contact_ok and (p_experiment_id is null or experiment_id = p_experiment_id))),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'experiment', x.name, 'experiment_id', f.experiment_id, 'body', f.body,
        'week', f.week, 'status', f.status, 'reviewed_at', f.reviewed_at,
        'contact_ok', f.contact_ok, 'contact_email', f.contact_email)
        -- Newest week first; within a week the order is random so it can't be matched to
        -- the order people finished in.
        order by f.week desc, f.id)
      from public.experiment_feedback f
      join public.experiments x on x.id = f.experiment_id
      where (p_experiment_id is null or f.experiment_id = p_experiment_id)
        and (p_status is null or f.status = p_status)), '[]'::jsonb));
end $$;

create or replace function public.admin_feedback_review(p_id uuid, p_reviewed boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  update public.experiment_feedback
     set status = case when p_reviewed then 'reviewed' else 'new' end,
         reviewed_at = case when p_reviewed then now() end
   where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── 6. Launch analytics ─────────────────────────
-- One admin-only read. Every rate comes back as {num, den} so the dashboard can say what it is
-- a share of. Definitions (a link is counted once per stage):
--   generated  the link exists and wasn't revoked
--   shared     the sender used Copy/Share on it (not proof it was sent)
--   opened     a person opened it (automated link-preview requests aren't recorded as opens)
--   started    someone joined the experiment through it
--   completed  the person who joined has completed the experiment (reveal level 2)
-- Test experiments are left out. p_experiment_id narrows to one experiment.
create or replace function public.admin_launch_analytics(p_experiment_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  with ex as (
    select id from public.experiments
    where not is_test and (p_experiment_id is null or id = p_experiment_id)
  ),
  inv as (
    select i.*, p.id as joined_id, p.reveal_level as joined_level, p.completed_at as joined_completed_at,
           p.deleted_at as joined_deleted
    from public.invitations i
    join ex on ex.id = i.experiment_id
    left join public.participants p on p.invitation_id = i.id
    where i.status <> 'revoked'
  ),
  by_kind as (
    select kind,
      count(*) as generated,
      count(*) filter (where shared_at is not null) as shared,
      count(*) filter (where opened_at is not null) as opened,
      count(*) filter (where joined_id is not null and joined_deleted is null) as started,
      count(*) filter (where joined_id is not null and joined_deleted is null and joined_level >= 2) as completed,
      count(*) filter (where status = 'duplicate') as duplicates
    from inv group by kind
  ),
  people as (
    select p.* from public.participants p join ex on ex.id = p.experiment_id where p.deleted_at is null
  ),
  done as (select * from people where reveal_level >= 2),
  extra as (
    select sender_id, count(*) as n from public.invitations i join ex on ex.id = i.experiment_id
    where i.kind = 'additional' and i.status <> 'revoked' group by sender_id
  ),
  waitlist as (
    select count(distinct c.email) as n
    from public.community_signups c join ex on ex.id = c.experiment_id
    join public.participants p on p.id = c.participant_id and p.deleted_at is null
    where c.updates and c.unsubscribed_at is null
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'seed_links', (select count(*) from inv where kind in ('seed_personal', 'seed_broadcast')),
      'participants', (select count(*) from people),
      'started', (select count(*) from people),
      'completed', (select count(*) from done),
      'completion_rate', jsonb_build_object('num', (select count(*) from done), 'den', (select count(*) from people)),
      'by_group', coalesce((select jsonb_agg(jsonb_build_object('group', g.grp, 'participants', g.n, 'completed', g.c) order by g.n desc)
                            from (select coalesce(classification, 'Not asked') as grp, count(*) as n,
                                         count(*) filter (where reveal_level >= 2) as c
                                  from people group by 1) g), '[]'::jsonb),
      'waitlist_from_experiment', (select n from waitlist),
      'waitlist_conversion', jsonb_build_object('num', (select n from waitlist), 'den', (select count(*) from done))
    ),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'generated', k.generated, 'shared', k.shared, 'opened', k.opened,
        'started', k.started, 'completed', k.completed, 'duplicates', k.duplicates,
        'opened_rate', jsonb_build_object('num', k.opened, 'den', k.generated),
        'started_rate', jsonb_build_object('num', k.started, 'den', k.opened),
        'completed_rate', jsonb_build_object('num', k.completed, 'den', k.started),
        'conversion', jsonb_build_object('num', k.completed, 'den', k.generated))
        order by case k.kind when 'seed_personal' then 1 when 'seed_broadcast' then 2 when 'standard' then 3 else 4 end)
      from by_kind k), '[]'::jsonb),
    'additional', jsonb_build_object(
      'generated', (select coalesce(sum(n), 0) from extra),
      'completed_with_any', jsonb_build_object('num', (select count(*) from done where id in (select sender_id from extra)),
                                               'den', (select count(*) from done)),
      'per_completed', jsonb_build_object('num', (select coalesce(sum(n), 0) from extra), 'den', (select count(*) from done))),
    'depth', jsonb_build_object(
      'max', (select coalesce(max(depth), 0) from people),
      'avg', (select round(avg(depth)::numeric, 2) from people)),
    'timing', jsonb_build_object(
      -- invitation created → the recipient completed. Only people who completed after this
      -- update have a completion time, so this fills in over time.
      'median_created_to_completed_s', (
        select round(percentile_cont(0.5) within group (order by extract(epoch from (joined_completed_at - created_at)))::numeric)
        from inv where joined_completed_at is not null and joined_deleted is null),
      'measured', (select count(*) from inv where joined_completed_at is not null and joined_deleted is null)),
    'overlap', jsonb_build_object(
      'people_invited_more_than_once', (select count(distinct accepted_by) from public.invitations i join ex on ex.id = i.experiment_id
                                        where i.status = 'duplicate'),
      'extra_invitations_received', (select count(*) from public.invitations i join ex on ex.id = i.experiment_id
                                     where i.status = 'duplicate'))
  ) into v;
  return v;
end $$;

-- Referral tree with what the dashboard filters on: how each person came in (seed kind,
-- standard/additional), their group, the strength they gave, and the seed they descend from.
create or replace function public.admin_experiment_detail(p_experiment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return jsonb_build_object(
    'seeds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'token', s.token, 'sender_name', s.sender_name, 'note', s.admin_note,
        'kind', s.kind,
        'status', s.status, 'opened_at', s.opened_at, 'accepted_at', s.accepted_at,
        'created_at', s.created_at,
        'branch_size', (with recursive t as (
            select id from public.participants where invitation_id = s.id
            union all select c2.id from public.participants c2 join t on c2.parent_id = t.id)
          select count(*) from t)
      ) order by s.created_at desc)
      from public.invitations s where s.sender_id is null and s.experiment_id = p_experiment_id), '[]'::jsonb),
    'tree', coalesce((
      with recursive roots as (
        select p.id, p.id as root_id, i.id as seed_id
        from public.participants p join public.invitations i on i.id = p.invitation_id
        where p.experiment_id = p_experiment_id and p.parent_id is null
        union all
        select c.id, r.root_id, r.seed_id
        from public.participants c join roots r on c.parent_id = r.id
      )
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'parent', x.parent_id, 'depth', x.depth, 'method', x.method,
        'category', x.category, 'deleted', x.deleted_at is not null,
        'kind', inv.kind, 'seed', rt.seed_id, 'group', x.classification,
        'completed', x.reveal_level >= 2,
        'strength', (select round(public.px_strength_score(c.method, c.value) * 100)
                     from public.classifications c
                     where c.invitation_id = x.invitation_id and c.direction = 'inbound' limit 1))
        order by x.depth, x.created_at)
      from public.participants x
      left join public.invitations inv on inv.id = x.invitation_id
      left join roots rt on rt.id = x.id
      where x.experiment_id = p_experiment_id), '[]'::jsonb),
    'secondary', coalesce((
      select jsonb_agg(jsonb_build_object('from', c.inviter_id, 'to', c.invitee_id))
      from public.connections c where c.experiment_id = p_experiment_id and not c.is_primary), '[]'::jsonb)
  );
end $$;

-- ───────────────────────── 7. Waitlist (richer) ─────────────────────────
-- Same one combined view as migration 017, now with consent wording, signup dates and the
-- experiment each signup came from. Still admin-only and still reads two tables that stay private.
create or replace function public.admin_waitlist_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_landing text;
  v_sql text;
  v jsonb;
begin
  perform public.px_require_admin();

  if to_regclass('public.landing_waitlist') is not null then
    v_landing := $l$
      select lower(email) as email, source, created_at, 'landing'::text as origin,
             null::text as experiment, consent_text as consent
      from public.landing_waitlist
      where unsubscribed_at is null
    $l$;
  else
    v_landing := $l$
      select null::text as email, null::text as source, null::timestamptz as created_at, 'landing'::text as origin,
             null::text as experiment, null::text as consent
      where false
    $l$;
  end if;

  v_sql := format($q$
    with landing as (%s),
    experiment as (
      select c.email, 'experiment'::text as source, c.signed_up_at as created_at, 'experiment'::text as origin,
             x.name as experiment, coalesce(c.updates_text, 'Joined Pipeline early access') as consent
      from public.community_signups c
      join public.participants p on p.id = c.participant_id and p.deleted_at is null
      left join public.experiments x on x.id = c.experiment_id
      where c.unsubscribed_at is null and c.updates
    ),
    everyone as (
      select * from landing
      union all
      select * from experiment
    )
    select jsonb_build_object(
      'unique_total',     (select count(distinct email) from everyone),
      'landing_total',    (select count(*) from landing),
      'experiment_total', (select count(*) from experiment),
      'on_both',          (select count(*) from (
                             select email from everyone group by email
                             having count(distinct origin) = 2) b),
      'last_7_days',      (select count(distinct email) from everyone
                           where created_at > now() - interval '7 days'),
      'by_source',        coalesce((
                             select jsonb_agg(jsonb_build_object('source', g.source, 'count', g.n)
                                              order by g.n desc, g.source)
                             from (select source, count(*) as n from everyone group by source) g), '[]'::jsonb),
      'recent',           coalesce((
                             select jsonb_agg(jsonb_build_object(
                                      'email', r.email, 'source', r.source, 'created_at', r.created_at,
                                      'origin', r.origin, 'experiment', r.experiment, 'consent', r.consent)
                                    order by r.created_at desc)
                             from (select email, source, created_at, origin, experiment, consent from everyone
                                   order by created_at desc limit 100) r), '[]'::jsonb)
    )
  $q$, v_landing);

  execute v_sql into v;
  return v;
end $$;

-- ───────────────────────── 8. Permissions ─────────────────────────
revoke execute on function public.admin_save_experiment_launch(uuid, text, text, boolean, boolean, boolean) from public, anon;
revoke execute on function public.admin_create_experiment_seeds_v2(uuid, integer, text, text, text) from public, anon;
revoke execute on function public.admin_update_seed(uuid, text, text) from public, anon;
revoke execute on function public.admin_feedback_list(uuid, text) from public, anon;
revoke execute on function public.admin_feedback_review(uuid, boolean) from public, anon;
revoke execute on function public.admin_launch_analytics(uuid) from public, anon;
revoke execute on function public.admin_experiment_detail(uuid) from public, anon;
revoke execute on function public.admin_waitlist_overview() from public, anon;
revoke execute on function public.create_additional_invitation(text, text) from public, anon;
revoke execute on function public.submit_experiment_feedback(text, boolean, text) from public, anon;
-- The renamed-and-rewrapped get_my_state is a new function: give it the same access as before.
revoke execute on function public.get_my_state() from public, anon;
grant execute on function public.get_my_state() to authenticated;
revoke execute on function public.px_get_my_state_v18() from public, anon;
revoke execute on function public.px_participant_completed() from public, anon, authenticated;
revoke execute on function public.px_invitation_kind() from public, anon, authenticated;
grant execute on function public.admin_save_experiment_launch(uuid, text, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.admin_create_experiment_seeds_v2(uuid, integer, text, text, text) to authenticated;
grant execute on function public.admin_update_seed(uuid, text, text) to authenticated;
grant execute on function public.admin_feedback_list(uuid, text) to authenticated;
grant execute on function public.admin_feedback_review(uuid, boolean) to authenticated;
grant execute on function public.admin_launch_analytics(uuid) to authenticated;
grant execute on function public.admin_experiment_detail(uuid) to authenticated;
grant execute on function public.admin_waitlist_overview() to authenticated;
grant execute on function public.create_additional_invitation(text, text) to authenticated;
grant execute on function public.submit_experiment_feedback(text, boolean, text) to authenticated;
