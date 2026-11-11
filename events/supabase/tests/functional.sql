-- Functional + security tests for 0001_pipeline_events.sql.
-- Run via ./run.sh (needs supabase_stub.sql applied first).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema test;

-- Signs in as a (confirmed) user, creating it if necessary. Call as postgres,
-- then `set role authenticated`.
create function test.login(p_email text, p_confirmed boolean default true) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then
    insert into auth.users (email, email_confirmed_at)
    values (p_email, case when p_confirmed then now() end) returning id into v_id;
  end if;
  perform set_config('request.jwt.claim.sub', v_id::text, false);
  return v_id;
end $$;

-- Asserts that a statement fails with a message matching p_pattern.
create function test.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm !~* p_pattern then
      raise exception 'Expected error ~ "%" from [%], got "%"', p_pattern, p_sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected error ~ "%" but [%] succeeded', p_pattern, p_sql;
end $$;
create function test.ok(p boolean, p_label text) returns void
language plpgsql as $$
begin
  if p is not true then raise exception '%', p_label; end if;
end $$;
grant usage on schema test to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;

\echo '-- setup: host and event'
select test.login('hannah@example.com');
select public.admin_create_event('launch-party', 'Pipeline Launch Party', 'Hannah@Example.com', 'Hannah Host',
  now() + interval '7 days', 'Cambridge, MA', 'A night with friends', 'Door code 1234') as event_id \gset

set role authenticated;
select test.expect_error($$select public.admin_create_event('x-x-x','x','a@b.c','x')$$, 'permission denied');
select (public.my_events() -> 0 ->> 'role') = 'host' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL host my_events');
select token as host_token_1 from public.organizer_create_invitations(:'event_id', 3) where slot = 1 \gset
select token as host_token_2 from public.event_invitations where inviter_guest_id = public.event_my_guest_id(:'event_id') and slot = 2 \gset
reset role;

\echo '-- anon landing page'
set role anon;
select public.get_invitation(:'host_token_1') as inv \gset
select (:'inv'::jsonb ->> 'status') = 'open'
   and (:'inv'::jsonb ->> 'inviter_name') = 'Hannah Host'
   and position('@' in :'inv') = 0
   and (:'inv'::jsonb -> 'consent_texts' -> 'pipeline_marketing' ->> 'id') = 'pipeline_marketing.v1' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL anon get_invitation');
select (public.get_invitation('nope') ->> 'status') = 'not_found' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL bad token');
select test.expect_error('select * from public.event_guests', 'permission denied');
select test.expect_error('select * from public.events', 'permission denied');
select test.expect_error($$select public.accept_invitation('x', 'x')$$, 'permission denied');
reset role;

\echo '-- unverified email cannot accept'
select test.login('mallory@example.com', false);
set role authenticated;
select test.expect_error(format('select public.accept_invitation(%L, %L)', :'host_token_1', 'Mallory'), 'verify your email');
reset role;

\echo '-- alice accepts host invitation'
select test.login('alice@example.com');
set role authenticated;
select test.expect_error(format('select public.accept_invitation(%L, %L)', :'host_token_1', '   '), 'full name');
select (public.accept_invitation(:'host_token_1', '  Alice   Anders ', true) ->> 'result') = 'accepted' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL alice accept');
-- second invitation for an existing guest does not consume the link
select (public.accept_invitation(:'host_token_2', 'Alice') ->> 'result') = 'already_guest' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL already_guest');
select public.guest_dashboard(:'event_id') as dash \gset
select jsonb_array_length(:'dash'::jsonb -> 'invitations') = 2
   and (:'dash'::jsonb -> 'guest' ->> 'full_name') = 'Alice Anders'
   and (:'dash'::jsonb -> 'guest' ->> 'depth') = '1'
   and (:'dash'::jsonb -> 'path' -> 0 ->> 'name') = 'Hannah Host'
   and (:'dash'::jsonb -> 'path' -> 1 ->> 'is_you') = 'true'
   and (:'dash'::jsonb ->> 'marketing_consent') = 'true'
   and (:'dash'::jsonb -> 'event' ->> 'private_details') = 'Door code 1234' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL alice dashboard');
select :'dash'::jsonb -> 'invitations' -> 0 ->> 'token' as alice_token_1,
       :'dash'::jsonb -> 'invitations' -> 1 ->> 'token' as alice_token_2,
       :'dash'::jsonb -> 'invitations' -> 1 ->> 'id' as alice_inv_2 \gset
select count(*) = 2 as ok from public.event_consents \gset
select test.ok(:'ok'::boolean, 'FAIL consents recorded');
reset role;
select (select status from public.event_invitations where token = :'host_token_2') = 'open' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL host_token_2 should stay open');

\echo '-- bob accepts alice; link is single-use'
select test.login('bob@example.com');
set role authenticated;
select (public.accept_invitation(:'alice_token_1', 'Bob Brown') ->> 'result') = 'accepted' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL bob accept');
select (public.guest_dashboard(:'event_id') -> 'path')::text as bob_path \gset
select :'bob_path'::jsonb -> 0 ->> 'name' = 'Hannah Host' and :'bob_path'::jsonb -> 1 ->> 'name' = 'Alice Anders'
   and jsonb_array_length(:'bob_path'::jsonb) = 3 as ok \gset
select test.ok(:'ok'::boolean, 'FAIL bob path');
select test.expect_error(format('select public.rotate_invitation(%L)', :'alice_inv_2'), 'own unused');
reset role;
select test.login('carol@example.com');
set role authenticated;
select test.expect_error(format('select public.accept_invitation(%L, %L)', :'alice_token_1', 'Carol'), 'already been used');
select (public.get_invitation(:'alice_token_1') ->> 'status') = 'used' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL used status');
reset role;

\echo '-- guest privacy: alice sees names, never other emails'
select test.login('alice@example.com');
set role authenticated;
select public.guest_dashboard(:'event_id')::text as dash \gset
select position('bob@example.com' in :'dash') = 0 and position('hannah@example.com' in :'dash') = 0
   and (:'dash'::jsonb -> 'invitations' -> 0 ->> 'accepted_name') = 'Bob Brown'
   and (:'dash'::jsonb -> 'invitations' -> 0 ->> 'token') is null as ok \gset
select test.ok(:'ok'::boolean, 'FAIL alice privacy');
select count(*) = 1 as ok from public.event_guests \gset
select test.ok(:'ok'::boolean, 'FAIL alice sees other guests');
select count(*) = 0 as ok from public.event_referrals \gset
select test.ok(:'ok'::boolean, 'FAIL alice sees referrals');
select count(*) = 2 as ok from public.event_invitations \gset
select test.ok(:'ok'::boolean, 'FAIL alice invitations');
select test.expect_error(format($$insert into public.event_invitations (event_id, inviter_guest_id, slot, token) values (%L, public.event_my_guest_id(%L), 3, 'aaaaaaaaaaaaaaaaaaaaaaaa')$$, :'event_id', :'event_id'), 'permission denied');
select test.expect_error($$update public.event_guests set role = 'host'$$, 'permission denied');
select test.expect_error($$delete from public.event_consents$$, 'permission denied');
select test.expect_error(format('select public.organizer_create_invitations(%L, 5)', :'event_id'), 'Organizer access');
select test.expect_error(format('select public.organizer_set_rsvp_open(%L, false)', :'event_id'), 'Organizer access');

\echo '-- rotate an unused link'
select public.rotate_invitation(:'alice_inv_2') as new_token \gset
select (public.get_invitation(:'alice_token_2') ->> 'status') = 'not_found'
   and (public.get_invitation(:'new_token') ->> 'status') = 'open' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL rotate');

\echo '-- marketing consent is an append-only log'
select public.set_marketing_consent(:'event_id', false);
select (public.guest_dashboard(:'event_id') ->> 'marketing_consent') = 'false' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL consent withdraw');
select count(*) = 3 as ok from public.event_consents \gset
select test.ok(:'ok'::boolean, 'FAIL consent rows');
reset role;
select test.expect_error('update public.event_consents set granted = true', 'append-only');

\echo '-- server-side two-invitation limit (even for privileged writes)'
select test.expect_error(format($$insert into public.event_invitations (event_id, inviter_guest_id, slot, token)
  select %L, id, 3, public.event_new_token() from public.event_guests where email = 'alice@example.com'$$, :'event_id'), 'at most two');
select test.expect_error(format($$insert into public.event_invitations (event_id, inviter_guest_id, slot, token)
  select %L, id, 1, public.event_new_token() from public.event_guests where email = 'alice@example.com'$$, :'event_id'), 'duplicate key');

\echo '-- host sees everything for their event'
select test.login('hannah@example.com');
set role authenticated;
select count(*) = 3 as ok from public.event_guests where email is not null \gset
select test.ok(:'ok'::boolean, 'FAIL host guest list');
select count(*) = 2 as ok from public.event_referrals \gset
select test.ok(:'ok'::boolean, 'FAIL host referrals');
reset role;

\echo '-- removal request: bob is anonymised, tree is kept'
select test.login('bob@example.com');
set role authenticated;
select public.request_data_removal(:'event_id', 'please remove me');
select public.request_data_removal(:'event_id', 'twice');
select (public.guest_dashboard(:'event_id') ->> 'removal_requested') = 'true' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL removal requested flag');
select test.expect_error(format($$select public.organizer_process_removal(id, 'complete') from public.event_removal_requests$$), 'Organizer access');
reset role;
select test.login('hannah@example.com');
set role authenticated;
select count(*) = 1 as ok from public.event_removal_requests where status = 'pending' \gset
select test.ok(:'ok'::boolean, 'FAIL one pending request');
select public.organizer_process_removal(id, 'complete') from public.event_removal_requests where status = 'pending';
select full_name = 'Removed guest' and email is null and user_id is null and rsvp_status = 'declined' as ok
  from public.event_guests where depth = 2 \gset
select test.ok(:'ok'::boolean, 'FAIL anonymise');
select count(*) = 2 as ok from public.event_invitations i join public.event_guests g on g.id = i.inviter_guest_id
  where g.depth = 2 and i.status = 'revoked' \gset
select test.ok(:'ok'::boolean, 'FAIL revoke on removal');
select count(*) = 2 as ok from public.event_referrals \gset
select test.ok(:'ok'::boolean, 'FAIL referral kept');
select (select granted from public.event_consents c join public.event_guests g on g.id = c.guest_id
         where g.depth = 2 and c.consent_type = 'pipeline_marketing' order by c.created_at desc, c.source = 'removal' desc limit 1) = false as ok \gset
select test.ok(:'ok'::boolean, 'FAIL consent withdrawn on removal');
reset role;
select test.login('bob@example.com');
set role authenticated;
select public.my_events() = '[]'::jsonb as ok \gset
select test.ok(:'ok'::boolean, 'FAIL bob still linked');
reset role;
select test.login('alice@example.com');
set role authenticated;
select (public.guest_dashboard(:'event_id') -> 'invitations' -> 0 ->> 'accepted_name') = 'Removed guest' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL alice sees removed name');
reset role;

\echo '-- reclaim: auth account recreated with the same verified email'
delete from auth.users where email = 'alice@example.com';
select test.login('alice@example.com');
set role authenticated;
select jsonb_array_length(public.my_events()) = 1 as ok \gset
select test.ok(:'ok'::boolean, 'FAIL reclaim');
select jsonb_array_length(public.guest_dashboard(:'event_id') -> 'invitations') = 2 as ok \gset
select test.ok(:'ok'::boolean, 'FAIL reclaimed slots');
reset role;

\echo '-- capacity and RSVP changes'
select test.login('henry@example.com');
select public.admin_create_event('tiny-dinner', 'Tiny Dinner', 'henry@example.com', 'Henry Host', p_capacity => 2) as event2 \gset
set role authenticated;
select array_agg(token order by slot) as t from public.organizer_create_invitations(:'event2', 2) \gset
select (:'t'::text[])[1] as e2_t1, (:'t'::text[])[2] as e2_t2 \gset
select count(*) = 0 as ok from public.event_guests where event_id = :'event_id' \gset
select test.ok(:'ok'::boolean, 'FAIL host isolation across events');
reset role;
select test.login('dora@example.com');
set role authenticated;
select public.accept_invitation(:'e2_t1', 'Dora');
reset role;
set role anon;
select (public.get_invitation(:'e2_t2') ->> 'status') = 'full' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL full status');
reset role;
select test.login('eve@example.com');
set role authenticated;
select test.expect_error(format('select public.accept_invitation(%L, %L)', :'e2_t2', 'Eve'), 'capacity');
reset role;
select test.login('dora@example.com');
set role authenticated;
select public.set_rsvp_status(:'event2', 'declined');
reset role;
select test.login('eve@example.com');
set role authenticated;
select (public.accept_invitation(:'e2_t2', 'Eve') ->> 'result') = 'accepted' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL accept after decline frees a spot');
reset role;
select test.login('dora@example.com');
set role authenticated;
select test.expect_error(format('select public.set_rsvp_status(%L, %L)', :'event2', 'attending'), 'capacity');
reset role;

\echo '-- organizer can close RSVPs'
select test.login('henry@example.com');
set role authenticated;
select token as e2_t3 from public.organizer_create_invitations(:'event2', 1) \gset
select public.organizer_set_rsvp_open(:'event2', false);
select (public.get_invitation(:'e2_t3') ->> 'status') = 'closed' as ok \gset
select test.ok(:'ok'::boolean, 'FAIL closed');
reset role;
