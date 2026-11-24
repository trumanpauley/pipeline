-- The Pipeline Experiment — one waitlist view across the landing page and the experiment.
--
-- Run after 016. ADDITIVE and NON-DESTRUCTIVE: no rows are changed or removed, nothing is dropped.
--
-- Two places collect early-access emails:
--   * pipeline-networking.com            → public.landing_waitlist   (root migration 003)
--   * the end of the experiment          → public.community_signups  (migration 009, with consent text,
--                                          timestamps and the experiment recorded by the server)
-- Both stay as they are (each keeps its own consent wording and its own security model: no table grants,
-- nothing readable through the public API). This migration adds ONE admin-only read that combines them,
-- de-duplicated by email, so the admin dashboard shows a single waitlist.
--
--   1. landing_waitlist (if it exists on this project) gains
--        consent_text     the wording the visitor agreed to; existing and new rows get the page's wording
--        unsubscribed_at  so a signup can be withdrawn without deleting it
--      The public (anon) role still can only INSERT email + source; the new columns are filled by defaults.
--   2. admin_waitlist_overview()  admin-only: totals, sources, last 7 days, recent signups.
--
-- Safe to run more than once. Works whether or not landing_waitlist exists yet.

do $$
begin
  if to_regclass('public.landing_waitlist') is not null then
    alter table public.landing_waitlist
      add column if not exists consent_text text not null
        default 'Agreed to receive Pipeline updates by email when joining the waitlist.',
      add column if not exists unsubscribed_at timestamptz;
  end if;
end $$;

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
      select lower(email) as email, source, created_at, 'landing'::text as origin
      from public.landing_waitlist
      where unsubscribed_at is null
    $l$;
  else
    v_landing := $l$
      select null::text as email, null::text as source, null::timestamptz as created_at, 'landing'::text as origin
      where false
    $l$;
  end if;

  v_sql := format($q$
    with landing as (%s),
    experiment as (
      -- the early-access list: people who ticked/pressed "Join Early Access" and haven't withdrawn
      select c.email, 'experiment'::text as source, c.signed_up_at as created_at, 'experiment'::text as origin
      from public.community_signups c
      join public.participants p on p.id = c.participant_id and p.deleted_at is null
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
                                      'email', r.email, 'source', r.source, 'created_at', r.created_at)
                                    order by r.created_at desc)
                             from (select email, source, created_at from everyone
                                   order by created_at desc limit 25) r), '[]'::jsonb)
    )
  $q$, v_landing);

  execute v_sql into v;
  return v;
end $$;

revoke execute on function public.admin_waitlist_overview() from public, anon;
grant execute on function public.admin_waitlist_overview() to authenticated;
