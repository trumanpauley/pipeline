-- The Pipeline Experiment - community onboarding.
--
-- Run after 013. Additive: no participant, link or answer changes, and every
-- experiment keeps its current onboarding until these settings are filled in.
--
-- Per experiment (all optional):
--   welcome_message       one line under "And you are?" (e.g. "A small
--                         experiment exploring the connections between ...")
--   eligibility_enabled   ask one membership question before joining
--   eligibility_question  e.g. "Have you played for Harvard Baseball?"
--   eligible_label        the answer that continues (default "Yes")
--   ineligible_label      the answer that stops (default "No")
--   ineligible_message    shown to people who answer the stopping option
-- Participant types stay in experiments.categories (e.g. "Current player",
-- "Former player / alumnus"); px_classify maps them to the ABC groups.
--
-- The server re-checks eligibility when someone joins: in an experiment that
-- screens, a new participant must confirm the eligible answer, so nobody who
-- answered "No" can join or create invitation links. Existing participants
-- (and second invitations to them) are unaffected.
--
-- Only these display settings are added to the public invitation data; no
-- participant information.

alter table public.experiments
  add column if not exists welcome_message text check (welcome_message is null or char_length(welcome_message) <= 240),
  add column if not exists eligibility_enabled boolean not null default false,
  add column if not exists eligibility_question text check (eligibility_question is null or char_length(eligibility_question) <= 160),
  add column if not exists eligible_label text not null default 'Yes' check (char_length(eligible_label) between 1 and 40),
  add column if not exists ineligible_label text not null default 'No' check (char_length(ineligible_label) between 1 and 40),
  add column if not exists ineligible_message text check (ineligible_message is null or char_length(ineligible_message) <= 300);

-- Settings for the communities already set up, only where nothing is set yet.
update public.experiments set
  welcome_message = coalesce(welcome_message, 'A small experiment exploring the connections between current and former Harvard Baseball players.'),
  eligibility_enabled = true,
  eligibility_question = 'Have you played for Harvard Baseball?',
  ineligible_message = coalesce(ineligible_message, 'This experiment is currently for Harvard Baseball players and alumni. Thanks for your interest.')
where lower(name) = 'harvard baseball' and eligibility_question is null;

-- Participant types for Harvard Baseball, unless people have already picked one.
update public.experiments e set categories = '["Current player", "Former player / alumnus"]'::jsonb
where lower(e.name) = 'harvard baseball'
  and not exists (select 1 from public.participants p where p.experiment_id = e.id and p.category is not null);

update public.experiments set
  welcome_message = 'We''re exploring how students at Harvard connect through people they know.'
where lower(name) = 'harvard students' and welcome_message is null;

update public.experiments set
  welcome_message = 'We''re exploring how connections extend through the PSK community.'
where lower(name) like 'psk%' and welcome_message is null;

-- ---------------------------------------------------------------------------
-- What the invitation page receives (display settings only)
-- ---------------------------------------------------------------------------

create or replace function public.px_experiment_public(e public.experiments)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'description', e.description,
    'invite_instruction', e.invite_instruction, 'categories', e.categories,
    'invites_per_participant', e.invites_per_participant,
    'status', e.status, 'is_default', e.is_default,
    'welcome_message', e.welcome_message,
    'eligibility', case when e.eligibility_enabled and e.eligibility_question is not null then jsonb_build_object(
      'question', e.eligibility_question,
      'eligible_label', e.eligible_label,
      'ineligible_label', e.ineligible_label,
      'ineligible_message', coalesce(e.ineligible_message,
        'This experiment is currently for ' || e.name || ' members. Thanks for your interest.')) end)
$$;

-- ---------------------------------------------------------------------------
-- Joining: eligibility is confirmed on the server too
-- ---------------------------------------------------------------------------

-- Safe to run twice: only rename the 013 version if that hasn't happened yet.
do $$
begin
  if to_regprocedure('public.px_accept_invitation_v13(text, text, boolean, boolean, text, text)') is null then
    alter function public.accept_invitation(text, text, boolean, boolean, text, text) rename to px_accept_invitation_v13;
  end if;
end $$;

create or replace function public.accept_invitation(
  p_token text,
  p_display_name text,
  p_research_consent boolean,
  p_marketing_consent boolean default false,
  p_device text default null,
  p_category text default null,
  p_eligible boolean default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  inv public.invitations;
  e public.experiments;
begin
  select * into inv from public.invitations where token = p_token;
  if found and auth.uid() is not null and inv.status in ('created', 'opened') then
    select * into e from public.experiments where id = inv.experiment_id;
    perform public.px_scope(e.id);
    -- New to this experiment and it screens: the eligible answer is required.
    if e.eligibility_enabled and e.eligibility_question is not null
       and (public.px_me()).id is null and coalesce(p_eligible, false) = false then
      return jsonb_build_object('error', 'not_eligible');
    end if;
  end if;
  return public.px_accept_invitation_v13(p_token, p_display_name, p_research_consent, p_marketing_consent, p_device, p_category);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: save the onboarding settings
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_experiment_onboarding(
  p_experiment_id uuid,
  p_welcome_message text,
  p_eligibility_enabled boolean,
  p_eligibility_question text,
  p_eligible_label text,
  p_ineligible_label text,
  p_ineligible_message text
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_welcome text := public.px_tidy_name(p_welcome_message);
  v_question text := public.px_tidy_name(p_eligibility_question);
  v_yes text := coalesce(public.px_tidy_name(p_eligible_label), 'Yes');
  v_no text := coalesce(public.px_tidy_name(p_ineligible_label), 'No');
  v_message text := public.px_tidy_name(p_ineligible_message);
  e public.experiments;
begin
  perform public.px_require_admin();
  if char_length(coalesce(v_welcome, '')) > 240 or char_length(coalesce(v_question, '')) > 160
     or char_length(v_yes) > 40 or char_length(v_no) > 40 or char_length(coalesce(v_message, '')) > 300 then
    raise exception 'invalid_experiment_text' using errcode = '22023';
  end if;
  if coalesce(p_eligibility_enabled, false) and v_question is null then
    raise exception 'eligibility_question_required' using errcode = '22023';
  end if;
  if lower(v_yes) = lower(v_no) then
    raise exception 'eligibility_labels_same' using errcode = '22023';
  end if;
  update public.experiments set
    welcome_message = v_welcome,
    eligibility_enabled = coalesce(p_eligibility_enabled, false),
    eligibility_question = v_question,
    eligible_label = v_yes,
    ineligible_label = v_no,
    ineligible_message = v_message,
    updated_at = now()
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

revoke execute on function public.px_accept_invitation_v13(text, text, boolean, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.px_experiment_public(public.experiments) from public, anon, authenticated;
revoke execute on function public.admin_save_experiment_onboarding(uuid, text, boolean, text, text, text, text) from public, anon;
revoke execute on function public.accept_invitation(text, text, boolean, boolean, text, text, boolean) from public, anon;
grant execute on function public.accept_invitation(text, text, boolean, boolean, text, text, boolean) to authenticated;
grant execute on function public.admin_save_experiment_onboarding(uuid, text, boolean, text, text, text, text) to authenticated;
