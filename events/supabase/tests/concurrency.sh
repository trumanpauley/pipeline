#!/usr/bin/env bash
# Concurrency tests: run many accept_invitation calls in parallel sessions.
# Invoked by run.sh with PG* env vars and PSQL_CMD set.
set -euo pipefail
PSQL=($PSQL_CMD)
q() { "${PSQL[@]}" -At -c "$1"; }

accept() { # email token
  $PSQL_CMD -At -c "select test.login('$1');" -c "set role authenticated;" \
    -c "select public.accept_invitation('$2', 'Guest $1') ->> 'result';" 2>/dev/null | tail -1 || true
}
export -f accept
export PSQL_CMD

echo "-- 40 people race for one invitation link"
EV=$(q "select public.admin_create_event('race-one', 'Race', 'race-host@example.com', 'Race Host')")
TOKEN=$(q "select test.login('race-host@example.com'); set role authenticated;
           select token from public.organizer_create_invitations('$EV', 1);" | tail -1)
seq 1 40 | xargs -P 40 -I{} bash -c "accept racer{}@example.com $TOKEN" > /tmp/race_one.$$ || true
WINNERS=$(grep -c '^accepted$' /tmp/race_one.$$ || true)
GUESTS=$(q "select count(*) from public.event_guests where event_id = '$EV' and role = 'guest'")
rm -f /tmp/race_one.$$
[ "$WINNERS" = "1" ] && [ "$GUESTS" = "1" ] || { echo "FAIL single-use: winners=$WINNERS guests=$GUESTS"; exit 1; }
echo "   1 winner, 1 guest row"

echo "-- 500 people race for a 400-person event"
EV=$(q "select public.admin_create_event('race-cap', 'Cap', 'cap-host@example.com', 'Cap Host')")
q "select test.login('cap-host@example.com'); set role authenticated;
   do \$\$ begin for i in 1..10 loop perform public.organizer_create_invitations('$EV', 50); end loop; end \$\$;" >/dev/null
[ "$(q "select count(*) from public.event_invitations where event_id = '$EV'")" = "500" ] || { echo "FAIL setup"; exit 1; }
q "select token from public.event_invitations where event_id = '$EV' order by slot" > /tmp/race_cap.$$
nl -nln /tmp/race_cap.$$ | xargs -P 64 -L1 bash -c 'accept cap$0@example.com $1' > /tmp/race_cap_out.$$ || true
ACCEPTED=$(grep -c '^accepted$' /tmp/race_cap_out.$$ || true)
ATTENDING=$(q "select count(*) from public.event_guests where event_id = '$EV' and rsvp_status = 'attending'")
rm -f /tmp/race_cap.$$ /tmp/race_cap_out.$$
[ "$ACCEPTED" = "399" ] && [ "$ATTENDING" = "400" ] || { echo "FAIL capacity: accepted=$ACCEPTED attending=$ATTENDING"; exit 1; }
echo "   399 accepted + host = 400 attending, 101 turned away"

echo "-- every guest holds exactly two invitations"
BAD=$(q "select count(*) from public.event_guests g where g.role = 'guest' and
         (select count(*) from public.event_invitations i where i.inviter_guest_id = g.id) <> 2")
[ "$BAD" = "0" ] || { echo "FAIL invitation counts: $BAD guests"; exit 1; }
echo "   ok"
