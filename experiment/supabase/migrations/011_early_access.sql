-- The Pipeline Experiment — early-access signup, per experiment.
--
-- Run after 010. Additive: builds on the optional signup from 009
-- (community_signups: one row per person and per email, RLS on with no table
-- grants, so emails are never readable through the API).
--
--   * Each signup records the experiment it came from (experiment_id), set by
--     the server from the participant's membership.
--   * The two consents are now worded as the screen shows them:
--       updates          "Join our early-access list…" (the Join Early Access button)
--       research_invites "I'm interested in participating in future Pipeline experiments."
--     Existing rows keep the exact wording their owners agreed to.
--   * Admin: signups by experiment, and the experiment in the CSV exports.

alter table public.community_signups
  add column if not exists experiment_id uuid references public.experiments(id);

update public.community_signups c set experiment_id = p.experiment_id
  from public.participants p
  where p.id = c.participant_id and c.experiment_id is null;

create index if not exists community_signups_experiment_idx on public.community_signups (experiment_id);

create or replace function public.px_community_signup_experiment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.experiment_id := coalesce(new.experiment_id,
    (select experiment_id from public.participants where id = new.participant_id));
  return new;
end $$;

create trigger community_signups_experiment before insert on public.community_signups
  for each row execute function public.px_community_signup_experiment();

update public.experiment_settings
  set value = '{
      "updates": "Join our early-access list to be among the first to experience it.",
      "research_invites": "I’m interested in participating in future Pipeline experiments."
    }'::jsonb,
    description = 'Exact wording of the early-access signup (button) and the future-experiments checkbox, stored with each consent.'
  where key = 'community_consent_texts';

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

alter function public.admin_community_stats() rename to px_admin_community_stats_v10;

create or replace function public.admin_community_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.px_require_admin();
  return public.px_admin_community_stats_v10() || jsonb_build_object(
    'by_experiment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'experiment_id', e.id, 'name', e.name,
        'participants', (select count(*) from public.participants p
                         where p.experiment_id = e.id and p.deleted_at is null),
        'signups', (select count(*) from public.community_signups c
                    join public.participants p on p.id = c.participant_id and p.deleted_at is null
                    where c.experiment_id = e.id and c.unsubscribed_at is null),
        'research_invites', (select count(*) from public.community_signups c
                             join public.participants p on p.id = c.participant_id and p.deleted_at is null
                             where c.experiment_id = e.id and c.unsubscribed_at is null and c.research_invites)
      ) order by e.is_default desc, e.created_at)
      from public.experiments e), '[]'::jsonb));
end $$;

alter function public.admin_export(text) rename to px_admin_export_v10;

create or replace function public.admin_export(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.px_admin_export_v10(p_kind);
begin
  -- px_admin_export_v10 checks the admin.
  if p_kind in ('community', 'research_pool') then
    select coalesce(jsonb_agg(a.r || jsonb_build_object('experiment_id', c.experiment_id, 'experiment', e.name)
                              order by a.ord), '[]'::jsonb) into v
    from jsonb_array_elements(v) with ordinality a(r, ord)
    left join public.community_signups c on c.participant_id = (a.r ->> 'participant_id')::uuid
    left join public.experiments e on e.id = c.experiment_id;
  end if;
  return v;
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
      and (p.proname like 'px\_%' or p.proname like 'admin\_%')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

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
