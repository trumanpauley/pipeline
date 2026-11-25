-- The Pipeline Experiment: a sender name on broadcast links.
--
-- A broadcast link can now say who it's from. Example: Ryan posts one link in his team's group
-- chat; everyone who opens it sees "Ryan" and answers the relationship questions about him.
-- The name is optional. A broadcast link without one behaves exactly as before.
--
--   * admin_create_experiment_seeds_v2 keeps the sender name for broadcast links (it used to drop it).
--   * Each person's private copy of a broadcast link carries the master's sender name.
--   * admin_set_seed_sender sets or changes the name on an existing seed link. For a broadcast
--     link it also updates the copies of people who opened it but haven't joined yet, so they see
--     the new name; people who already joined keep what they saw.
--   * admin_update_seed no longer erases the name when a seed is switched to broadcast.
--
-- ADDITIVE and safe to run more than once. Run after 019.

-- ───────────── 1. Creating seed links: broadcast links may carry a name ─────────────
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
  v_name text := nullif(public.px_tidy_name(p_sender_name), '');
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
  -- Personal links always need a name; broadcast links only when one is given.
  if (v_kind = 'seed_personal' or v_name is not null) and public.px_name_problem(p_sender_name) is not null then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  perform set_config('px.seed_experiment', p_experiment_id::text, true);
  perform set_config('px.invite_kind', v_kind, true);
  v := public.px_admin_create_seed_invitations_core(p_count, v_name, v_label);
  perform set_config('px.seed_experiment', '', true);
  perform set_config('px.invite_kind', '', true);
  return v;
end $$;

-- ───────────── 2. Each person's copy of a broadcast link shows the master's name ─────────────
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
    insert into public.invitations (token, experiment_id, sender_name, admin_note, kind, broadcast_parent, claimed_by)
    values (public.px_new_token(), m.experiment_id, m.sender_name, m.admin_note, 'seed_broadcast', m.id, auth.uid())
    on conflict (broadcast_parent, claimed_by) where broadcast_parent is not null do nothing;
    perform set_config('px.seed_experiment', '', true);
    perform set_config('px.invite_kind', '', true);
    select * into c from public.invitations where broadcast_parent = m.id and claimed_by = auth.uid();
  end if;
  return c.token;
end $$;

-- ───────────── 3. Set or change the name on an existing seed link ─────────────
create or replace function public.admin_set_seed_sender(p_invitation_id uuid, p_sender_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  v_name text := nullif(public.px_tidy_name(p_sender_name), '');
begin
  perform public.px_require_admin();
  select * into inv from public.invitations
    where id = p_invitation_id and sender_id is null and broadcast_parent is null;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if inv.kind = 'seed_broadcast' then
    if v_name is not null and public.px_name_problem(p_sender_name) is not null then
      raise exception 'invalid_name' using errcode = '22023';
    end if;
  else
    -- A personal link has one recipient: its name can only change before they open it,
    -- and it can't be removed.
    if inv.status <> 'created' then
      raise exception 'invitation_used' using errcode = '22023';
    end if;
    if public.px_name_problem(p_sender_name) is not null then
      raise exception 'invalid_name' using errcode = '22023';
    end if;
  end if;
  update public.invitations set sender_name = v_name where id = inv.id;
  if inv.kind = 'seed_broadcast' then
    update public.invitations set sender_name = v_name
      where broadcast_parent = inv.id and status in ('created', 'opened');
  end if;
  return jsonb_build_object('ok', true, 'sender_name', v_name);
end $$;

-- ───────────── 4. Switching a seed to broadcast keeps its name ─────────────
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
      update public.invitations set kind = case p_kind when 'broadcast' then 'seed_broadcast' else 'seed_personal' end
       where id = inv.id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── 5. Access ─────────────
revoke execute on function public.px_resolve_token(text) from public, anon, authenticated;
revoke execute on function public.admin_create_experiment_seeds_v2(uuid, integer, text, text, text) from public, anon;
revoke execute on function public.admin_set_seed_sender(uuid, text) from public, anon;
revoke execute on function public.admin_update_seed(uuid, text, text) from public, anon;
grant execute on function public.admin_create_experiment_seeds_v2(uuid, integer, text, text, text) to authenticated;
grant execute on function public.admin_set_seed_sender(uuid, text) to authenticated;
grant execute on function public.admin_update_seed(uuid, text, text) to authenticated;
