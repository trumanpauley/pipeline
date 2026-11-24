-- Pipeline Migration 003: Landing page waitlist (pipeline-networking.com)
-- Run this in the Supabase SQL Editor of the project the landing page points at.
--
-- Anyone (logged out) can ADD an email. Nobody can read, change, or delete
-- emails through the public API; view them in Supabase → Table editor → landing_waitlist.
-- Separate from the experiment's public.waitlist table (which belongs to participants).

create table if not exists public.landing_waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null
              check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source      text not null default 'landing'
              check (char_length(source) <= 40),
  created_at  timestamptz not null default now()
);

-- One signup per email, regardless of capitalization.
create unique index if not exists landing_waitlist_email_unique on public.landing_waitlist (lower(email));

alter table public.landing_waitlist enable row level security;

-- Public visitors may only insert the email and source columns.
revoke all on public.landing_waitlist from anon, authenticated;
grant insert (email, source) on public.landing_waitlist to anon, authenticated;

drop policy if exists "Anyone can join the landing waitlist" on public.landing_waitlist;
create policy "Anyone can join the landing waitlist"
  on public.landing_waitlist
  for insert
  to anon, authenticated
  with check (true);
