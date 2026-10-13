-- Pipeline Migration 002: Seed canonical groups and onboarding support
-- Run this migration in the Supabase SQL Editor if you want canonical groups persisted in the database.

-- Ensure uuid extension is available
create extension if not exists "uuid-ossp" with schema extensions;

-- Allow canonical system groups to exist without an auth.users creator
alter table public.groups alter column created_by drop not null;

-- Update the check constraint so canonical system groups can be verified without a user ID
alter table public.groups drop constraint if exists groups_check;
alter table public.groups add constraint groups_check check (not is_verified or verified_by is not null or created_by is null);

-- Ensure slug column exists for easy lookups
alter table public.groups add column if not exists slug text unique;

-- Ensure groups have predictable UUIDs based on their slug so memberships can be inserted cleanly.
insert into public.groups (id, slug, name, description, group_type, is_verified, created_by)
select
  extensions.uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, seed.slug) as id,
  seed.slug,
  seed.name,
  seed.description,
  seed.group_type,
  seed.is_verified,
  null::uuid as created_by
from (
  values
    ('harvard-chess-club', 'Harvard Chess Club', 'A student club for chess players of all levels, with casual play, lessons, and tournaments.', 'Club', false),
    ('harvard-football', 'Harvard Football', 'Harvard’s varsity football program, competing in the Ivy League and the NCAA Football Championship Subdivision.', 'Team', true),
    ('harvard-financial-analysts', 'Harvard Financial Analysts Club', 'A student organization focused on financial analysis, investing, and preparing members for finance careers.', 'Club', true),
    ('harvard-undergraduate-capital-partners', 'Harvard Undergraduate Capital Partners', 'A student-run organization for undergraduates interested in investing and capital markets.', 'Club', false),
    ('harvard-undergraduate-consulting-group', 'Harvard Undergraduate Consulting Group', 'A student consulting group that works with clients on market research and strategy projects.', 'Club', false),
    ('harvard-hucbe', 'Harvard Undergraduate Consulting on Business and the Environment', 'A student consulting organization applying business skills to environmental and sustainability projects.', 'Club', false),
    ('harvard-college-ventures', 'Harvard College Ventures', 'A student-run entrepreneurship and venture capital organization that supports student founders.', 'Club', true),
    ('harvard-innovation-labs', 'Harvard Innovation Labs', 'Harvard’s university-wide hub for student entrepreneurship, with programs and community for founders.', 'Organization', true),
    ('harvard-student-agencies', 'Harvard Student Agencies', 'A non-profit that runs student businesses across several industries and provides business experience.', 'Organization', false),
    ('harvard-women-in-business', 'Harvard Undergraduate Women In Business', 'A student organization supporting undergraduate women pursuing careers in business.', 'Club', false),
    ('harvard-computer-society', 'Harvard Computer Society', 'A student computing organization offering projects, services, and a community for people who build software.', 'Club', true),
    ('hackharvard', 'HackHarvard', 'A free 36-hour undergraduate hackathon hosted at Harvard University.', 'Club', false),
    ('harvard-tech-review', 'Harvard Tech Review', 'A student publication covering technology and its impact.', 'Club', false),
    ('harvard-political-review', 'Harvard Political Review', 'An undergraduate publication on politics, policy, and public affairs.', 'Club', false),
    ('harvard-debate-council', 'Harvard Debate Council', 'An undergraduate debate organization founded in 1892 that competes and hosts tournaments.', 'Club', true),
    ('harvard-model-united-nations', 'Harvard Model United Nations', 'A student organization that runs Model UN conferences and trains delegates.', 'Club', false),
    ('harvard-crimson', 'The Harvard Crimson', 'Harvard’s student-run daily newspaper, covering the University and its community.', 'Organization', true)
) as seed(slug, name, description, group_type, is_verified)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  group_type = excluded.group_type,
  is_verified = excluded.is_verified;

-- Allow authenticated users to view active (self-reported and verified) group memberships
-- so members of the same group can discover each other.
drop policy if exists "Read memberships" on public.group_memberships;
create policy "Read memberships" on public.group_memberships for select to authenticated
using (user_id = auth.uid() or status in ('self_reported', 'verified'));


