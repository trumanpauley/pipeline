-- The Pipeline Experiment: reusable broadcast links.
--
-- A "broadcast" seed link is meant to be posted once in a group chat and used by many people.
-- Until now every link worked once, so a broadcast link stopped working after its first use.
--
-- How it works now: the link you post (the "master") never gets used up. The first time someone
-- opens it, the server gives that person their own private copy of it (a row in `invitations`
-- with broadcast_parent = the master and claimed_by = their sign-in). From then on every step
-- (answering, rating, joining) happens on their copy, so people never share state and a second
-- person is never told the link "has already been used". Coming back later reaches the same copy.
-- Personal seeds and everyone's referral links are untouched and still work once.
--
-- ADDITIVE and safe to run more than once. Run after 018.

alter table public.invitations
  add column if not exists broadcast_parent uuid references public.invitations(id),
  add column if not exists claimed_by uuid;
create unique index if not exists invitations_broadcast_claim_idx
  on public.invitations (broadcast_parent, claimed_by) where broadcast_parent is not null;

create or replace function public.px_resolve_token(p_token text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  m public.invitations;
  c public.invitations;
begin
  if p_token is null or auth.uid() is null then
    return p_token;
  end if;
  select * into m from public.invitations where token = p_token;
  if not found or m.kind is distinct from 'seed_broadcast' or m.broadcast_parent is not null or m.status = 'revoked' then
    return p_token;
  end if;
  select * into c from public.invitations where broadcast_parent = m.id and claimed_by = auth.uid();
  if not found then
    perform set_config('px.seed_experiment', m.experiment_id::text, true);
    perform set_config('px.invite_kind', 'seed_broadcast', true);
    insert into public.invitations (token, experiment_id, admin_note, kind, broadcast_parent, claimed_by)
    values (public.px_new_token(), m.experiment_id, m.admin_note, 'seed_broadcast', m.id, auth.uid())
    on conflict (broadcast_parent, claimed_by) where broadcast_parent is not null do nothing;
    perform set_config('px.seed_experiment', '', true);
    perform set_config('px.invite_kind', '', true);
    select * into c from public.invitations where broadcast_parent = m.id and claimed_by = auth.uid();
  end if;
  return c.token;
end $$;

-- Every call that takes an invitation token first swaps a broadcast link for the caller's own copy.
do $$
begin
  if to_regprocedure('public.px_open_invitation_v19(text, text)') is null then
    alter function public.open_invitation(text, text) rename to px_open_invitation_v19;
  end if;
  if to_regprocedure('public.px_answer_invitation_v19(text, text, integer)') is null then
    alter function public.answer_invitation(text, text, integer) rename to px_answer_invitation_v19;
  end if;
  if to_regprocedure('public.px_rate_relationship_v19(text, integer, integer)') is null then
    alter function public.rate_relationship(text, integer, integer) rename to px_rate_relationship_v19;
  end if;
  if to_regprocedure('public.px_report_wrong_recipient_v19(text)') is null then
    alter function public.report_wrong_recipient(text) rename to px_report_wrong_recipient_v19;
  end if;
  if to_regprocedure('public.px_log_classification_event_v19(text, text, text, integer)') is null then
    alter function public.log_classification_event(text, text, text, integer) rename to px_log_classification_event_v19;
  end if;
  if to_regprocedure('public.px_accept_invitation_v19(text, text, boolean, boolean, text, text, boolean)') is null then
    alter function public.accept_invitation(text, text, boolean, boolean, text, text, boolean) rename to px_accept_invitation_v19;
  end if;
end $$;

create or replace function public.open_invitation(p_token text, p_device text default null)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.px_open_invitation_v19(public.px_resolve_token(p_token), p_device)
$$;

create or replace function public.answer_invitation(p_token text, p_value text, p_response_ms integer default null)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.px_answer_invitation_v19(public.px_resolve_token(p_token), p_value, p_response_ms)
$$;

create or replace function public.rate_relationship(p_token text, p_closeness integer, p_comfort integer default null)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.px_rate_relationship_v19(public.px_resolve_token(p_token), p_closeness, p_comfort)
$$;

create or replace function public.report_wrong_recipient(p_token text)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.px_report_wrong_recipient_v19(public.px_resolve_token(p_token))
$$;

create or replace function public.log_classification_event(
  p_direction text, p_event text, p_token text default null, p_elapsed_ms integer default null
)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.px_log_classification_event_v19(p_direction, p_event, public.px_resolve_token(p_token), p_elapsed_ms)
$$;

create or replace function public.accept_invitation(
  p_token text, p_display_name text, p_research_consent boolean, p_marketing_consent boolean default false,
  p_device text default null, p_category text default null, p_eligible boolean default null
)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.px_accept_invitation_v19(public.px_resolve_token(p_token), p_display_name, p_research_consent,
    p_marketing_consent, p_device, p_category, p_eligible)
$$;

-- Admin views: the reusable link is one row (with how many people used it and joined); each
-- person's private copy is hidden from the seed list and counted as one opened link in the numbers.
create or replace function public.admin_experiment_detail(p_experiment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return jsonb_build_object(
    'seeds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'token', s.token, 'sender_name', s.sender_name, 'note', s.admin_note,
        'kind', s.kind,
        'status', case when s.kind = 'seed_broadcast' then 'created' else s.status end,
        'opened_at', s.opened_at, 'accepted_at', s.accepted_at,
        'reusable', s.kind = 'seed_broadcast',
        'uses', (select count(*) from public.invitations ch where ch.broadcast_parent = s.id),
        'joined', (select count(*) from public.invitations ch where ch.broadcast_parent = s.id and ch.status = 'accepted'),
        'created_at', s.created_at,
        'branch_size', (with recursive t as (
            select id from public.participants where invitation_id = s.id
            or invitation_id in (select ch.id from public.invitations ch where ch.broadcast_parent = s.id)
            union all select c2.id from public.participants c2 join t on c2.parent_id = t.id)
          select count(*) from t)
      ) order by s.created_at desc)
      from public.invitations s where s.sender_id is null and s.broadcast_parent is null and s.experiment_id = p_experiment_id), '[]'::jsonb),
    'tree', coalesce((
      with recursive roots as (
        select p.id, p.id as root_id, coalesce(i.broadcast_parent, i.id) as seed_id
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
      and not (i.kind = 'seed_broadcast' and i.broadcast_parent is null)   -- a reusable link is a template; each person who opens it counts
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
      'seed_links', (select count(*) from public.invitations i join ex on ex.id = i.experiment_id
                     where i.sender_id is null and i.broadcast_parent is null and i.status <> 'revoked'),
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
      -- invitation created > the recipient completed. Only people who completed after this
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
revoke execute on function public.px_resolve_token(text) from public, anon, authenticated;
revoke execute on function public.px_open_invitation_v19(text, text) from public, anon, authenticated;
revoke execute on function public.px_answer_invitation_v19(text, text, integer) from public, anon, authenticated;
revoke execute on function public.px_rate_relationship_v19(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.px_report_wrong_recipient_v19(text) from public, anon, authenticated;
revoke execute on function public.px_log_classification_event_v19(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.px_accept_invitation_v19(text, text, boolean, boolean, text, text, boolean) from public, anon, authenticated;

revoke execute on function public.open_invitation(text, text) from public;
revoke execute on function public.answer_invitation(text, text, integer) from public;
revoke execute on function public.rate_relationship(text, integer, integer) from public;
revoke execute on function public.report_wrong_recipient(text) from public;
revoke execute on function public.log_classification_event(text, text, text, integer) from public;
revoke execute on function public.accept_invitation(text, text, boolean, boolean, text, text, boolean) from public, anon;
grant execute on function public.open_invitation(text, text) to anon, authenticated;
grant execute on function public.answer_invitation(text, text, integer) to anon, authenticated;
grant execute on function public.rate_relationship(text, integer, integer) to anon, authenticated;
grant execute on function public.report_wrong_recipient(text) to anon, authenticated;
grant execute on function public.log_classification_event(text, text, text, integer) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, boolean, boolean, text, text, boolean) to authenticated;
revoke execute on function public.admin_experiment_detail(uuid) from public, anon;
revoke execute on function public.admin_launch_analytics(uuid) from public, anon;
grant execute on function public.admin_experiment_detail(uuid) to authenticated;
grant execute on function public.admin_launch_analytics(uuid) to authenticated;
