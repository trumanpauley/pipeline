-- The Pipeline Experiment - shareable, community-specific invitations.
--
-- Run after 015. Additive and safe to run more than once: no participant,
-- invitation, referral or answer changes. Every link already sent keeps working.
--
-- Per experiment (all optional, edited in the admin form under "Invitation settings"):
--   slug                  readable public name in links: /harvard-baseball/TOKEN
--                         (the TOKEN still identifies the one invitation and its sender;
--                         /join/TOKEN keeps working for every invitation)
--   public_title          e.g. "Harvard Baseball Network Experiment" (link previews)
--   preview_description   e.g. "How strong is the Harvard Baseball network? Help us find out."
--   preview_image_url     a public https image; empty = a generated title card
--                         (http://localhost addresses are accepted for local development)
--   invite_message        sent with seed links (the first invitations)
--   forward_message       sent with participants' referral links
--   affiliation_authorized  the organization named in the text has authorized this
--                         experiment; until it is ticked, wording that suggests
--                         official sponsorship or endorsement is refused.
--
-- experiment_share_meta() gives link previews (server-rendered on Vercel, for
-- crawlers that don't run JavaScript) only these display settings: never a
-- participant, a sender name or anything about the invitation itself.

alter table public.experiments
  add column if not exists slug text,
  add column if not exists public_title text,
  add column if not exists preview_description text,
  add column if not exists preview_image_url text,
  add column if not exists invite_message text,
  add column if not exists forward_message text,
  add column if not exists affiliation_authorized boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'experiments_sharing_text_check') then
    alter table public.experiments add constraint experiments_sharing_text_check check (
      (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
      and (public_title is null or char_length(public_title) <= 80)
      and (preview_description is null or char_length(preview_description) <= 200)
      and (preview_image_url is null or (char_length(preview_image_url) <= 600
        and preview_image_url ~ '^(https://|http://(localhost|127\.0\.0\.1)(:[0-9]+)?/)'))
      and (invite_message is null or char_length(invite_message) <= 500)
      and (forward_message is null or char_length(forward_message) <= 500));
  end if;
end $$;

create unique index if not exists experiments_slug_key on public.experiments (slug) where slug is not null;

-- Words the app's own pages use, so a slug can never hide one of them.
create or replace function public.px_reserved_slug(p_slug text)
returns boolean language sql immutable as $$
  select lower(p_slug) = any (array[
    'admin', 'api', 'app', 'assets', 'auth', 'callback', 'community', 'demo', 'edit', 'experiment',
    'experiments', 'favicon', 'health', 'help', 'home', 'i', 'index', 'invite', 'invites', 'join',
    'login', 'logout', 'new', 'null', 'og', 'pipeline', 'preview', 'privacy', 'public', 'robots',
    'settings', 'share', 'sign-in', 'signin', 'signup', 'sitemap', 'static', 'storage', 'support',
    'terms', 'undefined', 'waitlist', 'www'])
$$;

-- Wording that would suggest official sponsorship or endorsement.
create or replace function public.px_sponsorship_wording(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* (
    '\m(official|officially|sponsor|sponsors|sponsored|sponsorship|endorse|endorsed|endorses|endorsement)\M'
    || '|\mon behalf of\M'
    || '|\m(approved|sanctioned|authori[sz]ed|funded|commissioned|backed|supported) by\M'
    || '|\min (partnership|collaboration|association|affiliation) with\M')
$$;

-- Trim, and tidy spaces without losing line breaks (messages can have them).
create or replace function public.px_tidy_text(p_text text)
returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[ \t]+', ' ', 'g'), '\s*\n\s*\n\s*', E'\n\n', 'g')), '')
$$;

-- The communities already set up, only where nothing is set yet.
update public.experiments set
  slug = 'harvard-baseball',
  public_title = coalesce(public_title, 'Harvard Baseball Network Experiment'),
  preview_description = coalesce(preview_description, 'How strong is the Harvard Baseball network? Help us find out.'),
  invite_message = coalesce(invite_message, 'Current Harvard Baseball players are studying the strength of our baseball network. Take this short survey to help us understand how connected our community really is.'),
  forward_message = coalesce(forward_message, 'I''m taking part in a short experiment about the Harvard Baseball network. Add your connection to help us map how our community is connected.')
where lower(name) = 'harvard baseball' and slug is null
  and not exists (select 1 from public.experiments x where x.slug = 'harvard-baseball');

update public.experiments set slug = 'harvard-students'
where lower(name) = 'harvard students' and slug is null
  and not exists (select 1 from public.experiments x where x.slug = 'harvard-students');

update public.experiments set slug = 'psk-network'
where id = (select id from public.experiments where lower(name) like 'psk%' and slug is null order by created_at limit 1)
  and not exists (select 1 from public.experiments x where x.slug = 'psk-network');

-- ---------------------------------------------------------------------------
-- What the app receives (the participant's own experiment, and invitations)
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
    'slug', e.slug,
    'public_title', e.public_title,
    'forward_message', e.forward_message,
    'eligibility', case when e.eligibility_enabled and e.eligibility_question is not null then jsonb_build_object(
      'question', e.eligibility_question,
      'eligible_label', e.eligible_label,
      'ineligible_label', e.ineligible_label,
      'ineligible_message', coalesce(e.ineligible_message,
        'This experiment is currently for ' || e.name || ' members. Thanks for your interest.')) end)
$$;

-- ---------------------------------------------------------------------------
-- Link previews (public): by slug, or by an invitation's token
-- ---------------------------------------------------------------------------

-- Returns only display settings. A token that doesn't exist looks exactly like
-- one whose experiment has no custom preview (found = false).
create or replace function public.experiment_share_meta(p_slug text default null, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e public.experiments;
begin
  if p_token is not null and char_length(p_token) between 10 and 64 then
    select x.* into e from public.invitations i join public.experiments x on x.id = i.experiment_id
    where i.token = p_token;
  end if;
  if e.id is null and p_slug is not null and char_length(p_slug) <= 40 then
    select * into e from public.experiments where slug = lower(p_slug);
  end if;
  if e.id is null or (e.slug is null and e.public_title is null) then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'id', e.id,
    'slug', e.slug,
    'title', e.public_title,
    'description', e.preview_description,
    'image_url', e.preview_image_url,
    'version', floor(extract(epoch from e.updated_at))::bigint);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: save the invitation settings
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_experiment_sharing(
  p_experiment_id uuid,
  p_slug text,
  p_public_title text,
  p_preview_description text,
  p_preview_image_url text,
  p_invite_message text,
  p_forward_message text,
  p_affiliation_authorized boolean default false
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_slug text := lower(public.px_tidy_text(p_slug));
  v_title text := public.px_tidy_text(p_public_title);
  v_desc text := public.px_tidy_text(p_preview_description);
  v_image text := public.px_tidy_text(p_preview_image_url);
  v_invite text := public.px_tidy_text(p_invite_message);
  v_forward text := public.px_tidy_text(p_forward_message);
  v_authorized boolean := coalesce(p_affiliation_authorized, false);
  e public.experiments;
begin
  perform public.px_require_admin();
  if v_slug is not null then
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' or v_slug ~ '--' then
      raise exception 'invalid_slug' using errcode = '22023';
    end if;
    if public.px_reserved_slug(v_slug) then
      raise exception 'slug_reserved' using errcode = '22023';
    end if;
    if exists (select 1 from public.experiments where slug = v_slug and id <> p_experiment_id) then
      raise exception 'slug_taken' using errcode = '22023';
    end if;
  end if;
  -- Public https addresses (crawlers fetch them); localhost only for local development.
  if v_image is not null and (v_image !~ '^(https://|http://(localhost|127\.0\.0\.1)(:[0-9]+)?/)[^\s<>"]+$' or char_length(v_image) > 600) then
    raise exception 'invalid_image_url' using errcode = '22023';
  end if;
  if char_length(coalesce(v_title, '')) > 80 or char_length(coalesce(v_desc, '')) > 200
     or char_length(coalesce(v_invite, '')) > 500 or char_length(coalesce(v_forward, '')) > 500 then
    raise exception 'invalid_experiment_text' using errcode = '22023';
  end if;
  if not v_authorized and (public.px_sponsorship_wording(v_title) or public.px_sponsorship_wording(v_desc)
     or public.px_sponsorship_wording(v_invite) or public.px_sponsorship_wording(v_forward)) then
    raise exception 'sponsorship_language' using errcode = '22023';
  end if;
  update public.experiments set
    slug = v_slug,
    public_title = v_title,
    preview_description = v_desc,
    preview_image_url = v_image,
    invite_message = v_invite,
    forward_message = v_forward,
    affiliation_authorized = v_authorized,
    updated_at = now()
  where id = p_experiment_id
  returning * into e;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  return to_jsonb(e);
end $$;

-- ---------------------------------------------------------------------------
-- Preview images: a public bucket that only admins can upload to
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('experiment-previews', 'experiment-previews', true)
    on conflict (id) do update set public = true;
    -- Size and type limits, where this Supabase version has them.
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set file_size_limit = 2097152,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'experiment-previews'$q$;
    end if;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Admins upload preview images" on storage.objects';
    execute $q$create policy "Admins upload preview images" on storage.objects for insert to authenticated
      with check (bucket_id = 'experiment-previews' and public.is_admin())$q$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.px_experiment_public(public.experiments) from public, anon, authenticated;
revoke execute on function public.px_reserved_slug(text) from public, anon, authenticated;
revoke execute on function public.px_sponsorship_wording(text) from public, anon, authenticated;
revoke execute on function public.px_tidy_text(text) from public, anon, authenticated;
revoke execute on function public.admin_save_experiment_sharing(uuid, text, text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.experiment_share_meta(text, text) from public;
grant execute on function public.experiment_share_meta(text, text) to anon, authenticated;
grant execute on function public.admin_save_experiment_sharing(uuid, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.is_admin() to authenticated;
