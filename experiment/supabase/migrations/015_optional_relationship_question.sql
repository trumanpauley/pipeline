-- The Pipeline Experiment - optional "how do you know them?" question.
--
-- Run after 014. Safe to run more than once.
--
-- experiments.ask_relationship_question (default true): the one-tap question
-- that opens an invitation ("Where do you know Alex from?" and the other
-- assigned methods), and the matching question the inviter answers when they
-- create a link. In a community where everyone knows each other the same way
-- (a team, a club) it adds nothing, so it can be switched off per experiment:
--   * invitees go straight from the landing screen to closeness + comfort;
--   * inviters go straight from the name to their link (no answer is stored
--     for that invitation, rather than a made-up one).
-- Closeness, comfort, eligibility, ABC and the invitation tree are unchanged,
-- and answers already given stay as they are.
--
-- Switched off here for Harvard Baseball and PSK.

alter table public.experiments
  add column if not exists ask_relationship_question boolean not null default true;

update public.experiments set ask_relationship_question = false
where (lower(name) = 'harvard baseball' or lower(name) like 'psk%') and ask_relationship_question;

-- ---------------------------------------------------------------------------
-- What the invitation page (and the home screen) receive
-- ---------------------------------------------------------------------------

create or replace function public.px_experiment_public(e public.experiments)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'description', e.description,
    'invite_instruction', e.invite_instruction, 'categories', e.categories,
    'invites_per_participant', e.invites_per_participant,
    'status', e.status, 'is_default', e.is_default,
    'welcome_message', e.welcome_message,
    'ask_relationship_question', e.ask_relationship_question,
    'eligibility', case when e.eligibility_enabled and e.eligibility_question is not null then jsonb_build_object(
      'question', e.eligibility_question,
      'eligible_label', e.eligible_label,
      'ineligible_label', e.ineligible_label,
      'ineligible_message', coalesce(e.ineligible_message,
        'This experiment is currently for ' || e.name || ' members. Thanks for your interest.')) end)
$$;

-- ---------------------------------------------------------------------------
-- Creating a link without the question
-- ---------------------------------------------------------------------------

-- While px.skip_outbound is set (only inside create_invitation below), the
-- inviter's answer row is not written.
create or replace function public.px_skip_outbound_answer()
returns trigger language plpgsql as $$
begin
  if new.direction = 'outbound' and current_setting('px.skip_outbound', true) = 'on' then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists classifications_skip_outbound on public.classifications;
create trigger classifications_skip_outbound before insert on public.classifications
  for each row execute function public.px_skip_outbound_answer();

do $$
begin
  if to_regprocedure('public.px_create_invitation_v14(text, text, integer)') is null then
    alter function public.create_invitation(text, text, integer) rename to px_create_invitation_v14;
  end if;
end $$;

create or replace function public.create_invitation(
  p_value text,
  p_recipient_label text default null,
  p_response_ms integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.participants := public.px_me();
  v_ask boolean;
  v_placeholder text;
  v jsonb;
begin
  if me.id is not null and p_value is null then
    select ask_relationship_question into v_ask from public.experiments where id = me.experiment_id;
    if v_ask = false then
      -- Any valid value gets past the checks; the row itself is never written.
      select x into v_placeholder
      from jsonb_array_elements_text(public.px_setting('method_options') -> me.method) x limit 1;
      perform set_config('px.skip_outbound', 'on', true);
      v := public.px_create_invitation_v14(v_placeholder, p_recipient_label, null);
      perform set_config('px.skip_outbound', '', true);
      return v;
    end if;
  end if;
  return public.px_create_invitation_v14(p_value, p_recipient_label, p_response_ms);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: switch it on or off
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_relationship_question(p_experiment_id uuid, p_enabled boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e public.experiments;
begin
  perform public.px_require_admin();
  update public.experiments set ask_relationship_question = coalesce(p_enabled, true), updated_at = now()
  where id = p_experiment_id
  returning * into e;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  return to_jsonb(e);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.px_create_invitation_v14(text, text, integer) from public, anon, authenticated;
revoke execute on function public.px_experiment_public(public.experiments) from public, anon, authenticated;
revoke execute on function public.px_skip_outbound_answer() from public, anon, authenticated;
revoke execute on function public.create_invitation(text, text, integer) from public, anon;
revoke execute on function public.admin_set_relationship_question(uuid, boolean) from public, anon;
grant execute on function public.create_invitation(text, text, integer) to authenticated;
grant execute on function public.admin_set_relationship_question(uuid, boolean) to authenticated;
