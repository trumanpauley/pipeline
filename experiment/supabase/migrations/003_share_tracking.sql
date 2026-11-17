-- The Pipeline Experiment — share tracking and share-based unlocks.
--
-- Run after 002. Additive and backward compatible.
--
-- Invitation lifecycle is now recorded as four separate facts:
--   created   invitations.created_at  (link generated)
--   shared    invitations.shared_at   (participant tapped Share or Copy — this is
--                                      only an *intent* to share; it is not proof
--                                      that anyone received the link)
--   opened    invitations.opened_at   (someone opened the link)
--   accepted  invitations.accepted_at (someone joined through it)
--
-- Reveals now unlock when a link is shared (unlock_on = "shared"), not when it
-- is created. "created" and "accepted" remain available in experiment_settings.

alter table public.invitations
  add column if not exists shared_at timestamptz,        -- first Share/Copy
  add column if not exists share_method text
    check (share_method is null or share_method in ('share', 'copy', 'legacy')),
  add column if not exists share_count integer not null default 0,
  add column if not exists last_shared_at timestamptz;

-- Links created before this migration already unlocked their reveal on creation.
-- Mark them as shared (method "legacy") so those participants aren't re-locked.
update public.invitations
  set shared_at = created_at, share_method = 'legacy'
  where sender_id is not null and shared_at is null;

update public.experiment_settings
  set value = '"shared"',
      description = '"shared": reveal unlocks when a link is shared or copied (default). "created": when a link is generated. "accepted": when an invitee joins.',
      updated_at = now()
  where key = 'unlock_on' and value = '"created"';

-- ---------------------------------------------------------------------------
-- Record a share / copy
-- ---------------------------------------------------------------------------

create or replace function public.mark_invitation_shared(p_invitation_id uuid, p_method text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_level smallint;
begin
  if me.id is null then
    raise exception 'not_participant' using errcode = '42501';
  end if;
  if p_method not in ('share', 'copy') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;

  update public.invitations set
    shared_at = coalesce(shared_at, now()),
    share_method = coalesce(share_method, p_method),
    share_count = least(share_count + 1, 1000),
    last_shared_at = now()
  where id = p_invitation_id and sender_id = me.id and status in ('created', 'opened', 'accepted');
  if not found then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;

  if public.px_setting('unlock_on') #>> '{}' = 'shared' then
    update public.participants p set
      reveal_level = greatest(p.reveal_level, least(2, (
        select count(*) from public.invitations i
        where i.sender_id = p.id and i.shared_at is not null))),
      revealed_via = coalesce(p.revealed_via, 'invite')
    where p.id = me.id;
  end if;

  select reveal_level into v_level from public.participants where id = me.id;
  return jsonb_build_object('ok', true, 'reveal_level', v_level);
end $$;

-- ---------------------------------------------------------------------------
-- Expose share state (wrapping the existing functions; their logic is unchanged)
-- ---------------------------------------------------------------------------

alter function public.get_my_state() rename to px_get_my_state_core;

create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_get_my_state_core();
  me public.participants := public.px_me();
begin
  if me.id is null then return v; end if;
  return v || jsonb_build_object('invitations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'token', i.token, 'recipient_label', i.recipient_label,
      'status', i.status, 'created_at', i.created_at, 'shared_at', i.shared_at,
      'opened_at', i.opened_at, 'accepted_at', i.accepted_at) order by i.created_at)
    from public.invitations i
    where i.sender_id = me.id and i.status in ('created', 'opened', 'accepted')), '[]'::jsonb));
end $$;

alter function public.admin_account_stats() rename to px_admin_account_stats_core;

create or replace function public.admin_account_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return public.px_admin_account_stats_core() || jsonb_build_object(
    'shared', (select count(*) from public.invitations
               where sender_id is not null and shared_at is not null and share_method <> 'legacy'),
    'shared_by_share', (select count(*) from public.invitations where share_method = 'share'),
    'shared_by_copy', (select count(*) from public.invitations where share_method = 'copy'),
    'created_since_tracking', (select count(*) from public.invitations i
                               where i.sender_id is not null and coalesce(i.share_method, '') <> 'legacy')
  );
end $$;

alter function public.admin_export(text) rename to px_admin_export_v2;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.px_require_admin();
  if p_kind = 'invitations' then
    select jsonb_agg(row_to_json(r) order by r.created_at) into v from (
      select i.id as invitation_id, i.sender_id, (i.sender_id is null) as is_seed, i.admin_note,
        s.depth as sender_depth, s.method as sender_method, i.assigned_method as recipient_method,
        i.status, i.created_at, i.shared_at, i.share_method, i.share_count, i.last_shared_at,
        i.open_count, i.opened_at, i.answered_at, i.accepted_at, i.accepted_by, i.revoked_at
      from public.invitations i left join public.participants s on s.id = i.sender_id) r;
    return coalesce(v, '[]'::jsonb);
  end if;
  return public.px_admin_export_v2(p_kind);
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
      and (p.proname like 'px\_%' or p.proname like 'admin\_%'
           or p.proname in ('get_my_state', 'mark_invitation_shared'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.get_my_state() to authenticated;
grant execute on function public.mark_invitation_shared(uuid, text) to authenticated;
grant execute on function public.px_me() to authenticated;
grant execute on function public.admin_create_seed_invitations(integer, text, text) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_export(text) to authenticated;
grant execute on function public.admin_account_stats() to authenticated;
