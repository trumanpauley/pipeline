create extension if not exists pgcrypto;

create type public.profile_entry_type as enum ('experience', 'education', 'skill', 'other');
create type public.profile_entry_source as enum ('manual', 'resume');
create type public.profile_entry_visibility as enum ('private', 'matching', 'public');
create type public.membership_status as enum ('pending', 'self_reported', 'verified', 'rejected');
create type public.acquaintance_status as enum ('pending', 'confirmed', 'declined');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,32}$'),
  full_name text not null default '',
  headline text not null default '',
  location text not null default '',
  school_or_organization text not null default '',
  graduation_year smallint check (graduation_year between 1900 and 2200),
  major text not null default '',
  bio text not null default '',
  photo_path text,
  is_public boolean not null default true,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_username_lower_idx on public.profiles (lower(username));

create table public.profile_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  entry_type public.profile_entry_type not null,
  source public.profile_entry_source not null default 'manual',
  content jsonb not null default '{}'::jsonb,
  approval_state text not null default 'pending' check (approval_state in ('pending', 'approved', 'rejected')),
  visibility public.profile_entry_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  group_type text not null default 'Organization',
  is_verified boolean not null default false,
  verified_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_verified or verified_by is not null)
);

create table public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.membership_status not null default 'pending',
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id),
  check (status <> 'verified' or verified_by is not null)
);

create table public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table public.acquaintances (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status public.acquaintance_status not null default 'pending',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id),
  check (status <> 'confirmed' or confirmed_at is not null)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  organization text not null default '',
  location text not null default '',
  category text not null default '',
  industry text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saved_opportunities (
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_acquaintance_endpoint_change()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then
    raise exception 'Acquaintance participants cannot be changed';
  end if;
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger profile_entries_touch_updated_at before update on public.profile_entries
for each row execute function public.touch_updated_at();
create trigger groups_touch_updated_at before update on public.groups
for each row execute function public.touch_updated_at();
create trigger memberships_touch_updated_at before update on public.group_memberships
for each row execute function public.touch_updated_at();
create trigger acquaintances_touch_updated_at before update on public.acquaintances
for each row execute function public.touch_updated_at();
create trigger acquaintances_protect_participants before update on public.acquaintances
for each row execute function public.prevent_acquaintance_endpoint_change();
create trigger opportunities_touch_updated_at before update on public.opportunities
for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), 'user_' || substr(replace(new.id::text, '-', ''), 1, 12)),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_user();

create view public.public_profiles
with (security_barrier = true)
as
select
  id,
  username,
  full_name,
  headline,
  location,
  school_or_organization,
  graduation_year,
  major,
  bio,
  photo_path,
  created_at,
  updated_at
from public.profiles
where is_public = true;

grant select on public.public_profiles to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.profile_entries enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.follows enable row level security;
alter table public.acquaintances enable row level security;
alter table public.opportunities enable row level security;
alter table public.saved_opportunities enable row level security;

create policy "Users read own profile" on public.profiles for select to authenticated
using (id = auth.uid());
create policy "Users create own profile" on public.profiles for insert to authenticated
with check (id = auth.uid());
create policy "Users update own profile" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "Users read own entries" on public.profile_entries for select to authenticated
using (profile_id = auth.uid());
create policy "Users create own entries" on public.profile_entries for insert to authenticated
with check (profile_id = auth.uid());
create policy "Users update own entries" on public.profile_entries for update to authenticated
using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "Users delete own entries" on public.profile_entries for delete to authenticated
using (profile_id = auth.uid());
create policy "Read public approved entries" on public.profile_entries for select to authenticated
using (approval_state = 'approved' and visibility = 'public');

create policy "Read groups" on public.groups for select to authenticated using (true);
create policy "Create unverified groups" on public.groups for insert to authenticated
with check (created_by = auth.uid() and is_verified = false and verified_by is null);
create policy "Update own unverified groups" on public.groups for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid() and is_verified = false and verified_by is null);
create policy "Delete own groups" on public.groups for delete to authenticated using (created_by = auth.uid());

create policy "Read memberships" on public.group_memberships for select to authenticated
using (user_id = auth.uid() or status = 'verified');
create policy "Manage own memberships" on public.group_memberships for insert to authenticated
with check (user_id = auth.uid() and status <> 'verified' and verified_by is null);
create policy "Update own membership requests" on public.group_memberships for update to authenticated
using (user_id = auth.uid() and status <> 'verified')
with check (user_id = auth.uid() and status <> 'verified' and verified_by is null);
create policy "Delete own memberships" on public.group_memberships for delete to authenticated
using (user_id = auth.uid() and status <> 'verified');

create policy "Read follows" on public.follows for select to authenticated
using (follower_id = auth.uid() or followed_id = auth.uid());
create policy "Create own follows" on public.follows for insert to authenticated
with check (follower_id = auth.uid());
create policy "Delete own follows" on public.follows for delete to authenticated
using (follower_id = auth.uid());

create policy "Read own acquaintance requests" on public.acquaintances for select to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "Request acquaintance" on public.acquaintances for insert to authenticated
with check (requester_id = auth.uid() and status = 'pending' and confirmed_at is null);
create policy "Respond to acquaintance request" on public.acquaintances for update to authenticated
using (addressee_id = auth.uid() and status = 'pending')
with check (addressee_id = auth.uid() and status in ('confirmed', 'declined'));
create policy "Withdraw acquaintance request" on public.acquaintances for delete to authenticated
using (requester_id = auth.uid() and status = 'pending');

create policy "Read opportunities" on public.opportunities for select to authenticated using (true);
create policy "Create own opportunities" on public.opportunities for insert to authenticated with check (owner_id = auth.uid());
create policy "Update own opportunities" on public.opportunities for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Delete own opportunities" on public.opportunities for delete to authenticated using (owner_id = auth.uid());

create policy "Read own saved opportunities" on public.saved_opportunities for select to authenticated using (user_id = auth.uid());
create policy "Save opportunities for self" on public.saved_opportunities for insert to authenticated with check (user_id = auth.uid());
create policy "Remove own saved opportunities" on public.saved_opportunities for delete to authenticated using (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

create policy "Users upload own profile photo" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users update own profile photo" on storage.objects for update to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users read own profile photo" on storage.objects for select to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own profile photo" on storage.objects for delete to authenticated
using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
