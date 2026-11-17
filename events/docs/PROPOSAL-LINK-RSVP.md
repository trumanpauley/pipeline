# Proposal: invitation-link RSVP (no email code for guests)

Status: **proposal — not implemented.** Nothing in the database or auth flow has
changed. This describes an additive migration (`0002`) that would let guests RSVP
with just a name, while organizers keep Supabase email-code sign-in.

## How it works today

| Who        | Identity                                    | How they come back                 |
| ---------- | ------------------------------------------- | ---------------------------------- |
| Guest      | Supabase Auth user, email verified by code  | `/me` → email → code               |
| Organizer  | Same, plus a `role = 'host'` guest row      | `/organizer` → email → code        |

Every RPC uses `auth.uid()` and the caller's *verified* email
(`event_verified_email()`). Guests must enter an email and a 6-digit code before
the RSVP is saved.

## Proposed model: a private "guest pass"

Two different secrets, never confused:

| Secret            | Purpose                               | Who has it            | Lifetime             |
| ----------------- | ------------------------------------- | --------------------- | -------------------- |
| Invitation token  | Lets **one** new person RSVP          | Shared by the inviter | Single use (today)   |
| Guest pass        | Proves "I am this guest" afterwards   | Only that guest       | Until rotated        |

1. Guest opens `/i/<invite token>` and sees the event (unchanged).
2. Enters **name**; **email optional**; marketing opt-in unchecked and separate.
3. `rsvp_with_invitation(token, name, email?, marketing)` (callable by `anon`)
   runs the same locked, capacity-checked logic as `accept_invitation`, then
   generates a 256-bit **pass**, stores only `sha256(pass)`, and returns the pass
   once.
4. The browser stores the pass (localStorage) and the guest's private page
   becomes `/p/<pass>` — the Apple Wallet "pass" of the event. "Add to Home
   Screen" keeps it one tap away.
5. Every guest action takes the pass instead of a session:
   `guest_dashboard_by_pass`, `rotate_invitation_by_pass`,
   `set_rsvp_by_pass`, `set_marketing_by_pass`, `request_removal_by_pass`.
   Each hashes the pass, finds the guest, and authorises server-side.

### What possession of a link does and does not prove

* An **invitation token** proves only "someone sent you this". It never grants
  access to an existing guest and is consumed on use.
* A **pass** proves "this browser RSVP'd as this guest" — not email ownership.
* An email typed without a code is stored as **unverified**
  (`email_verified_at is null`). It is **never** used to link accounts, reclaim a
  pass, or sign in. Before sending marketing to it, send one confirmation email
  (double opt-in), recorded in `event_consents`.
* Optional: "Verify email" on the guest page runs today's code flow and sets
  `email_verified_at`, which enables self-service reclaim on a new device.

### Private details

`private_details` is returned only by `guest_dashboard_by_pass` (valid pass,
RSVP = attending) or the existing session-based `guest_dashboard`. The anon
`get_invitation` keeps returning public fields only.

### Limits and abuse

* **Single-use invites + 2 per guest + capacity** already bound how many guests
  can ever be created (≤ 400). Nothing about this changes.
* Tokens: 144-bit invite tokens and 256-bit passes can't be guessed; passes are
  stored hashed so a database leak doesn't expose them.
* **Self-invites**: without verification, someone could use their own two links
  on made-up names. Mitigations: organizer can remove guests; optional per-event
  setting `require_verified_email` that keeps today's flow; dedupe by email when
  given.
* **Request rate**: PostgREST has no per-IP limit. If abuse appears, put a
  Vercel Edge Function in front of the anon RPCs with a simple IP rate limit
  (no secrets needed in the browser either way).
* **Forwarded pass**: anyone with the pass controls that guest's RSVP and
  slots. The UI labels it "Your pass — don't share", separate from the
  "Share" invitation buttons; organizers can **rotate a guest's pass** from the
  dashboard if one leaks or is lost.

### Lost pass

* Verified email → sign in with code (today's flow) → new pass issued.
* No verified email → organizer re-issues a pass from the guest list and sends
  it to them directly.

## Supabase changes (migration `0002`, additive)

```sql
alter table event_guests
  add column pass_hash text unique,          -- sha256 of the pass, hex
  add column pass_rotated_at timestamptz,
  add column email_verified_at timestamptz;

-- email becomes optional for pass guests
alter table event_guests drop constraint event_guests_check;
alter table event_guests add check (anonymized_at is not null or email is not null or pass_hash is not null);

-- backfill: existing guests were verified by code
update event_guests set email_verified_at = created_at where email is not null;
```

New security-definer functions (anon-executable, all validated server-side):
`rsvp_with_invitation`, `guest_dashboard_by_pass`, `rotate_invitation_by_pass`,
`set_rsvp_by_pass`, `set_marketing_by_pass`, `request_removal_by_pass`.
Organizer-only: `organizer_rotate_guest_pass`, `organizer_set_require_verified`.

RLS is unchanged: anon still cannot select any table directly. Organizer
access, `event_is_host`, and every existing function keep working, so the
current code-based flow continues to work side by side (useful for a
`require_verified_email` event).

## Frontend changes

* RSVP sheet: name, optional email, consent → **Confirm** (no code step).
* New route `/p/:pass` (same event page design), pass saved to localStorage;
  `/e/:eventId` stays for signed-in users and organizers.
* Menu gains "Verify email" (optional) for guests without a verified email.

## Tests to add

Pass hashing and lookup; wrong/rotated pass rejected; anon can't read private
details without a pass; unverified email never links or reclaims; capacity and
single-use races repeated through `rsvp_with_invitation`; removal anonymises
pass guests and clears `pass_hash`.

## Recommendation

Ship it as an **option per event**, defaulting to link RSVP for this party, and
keep email-code verification as the required path for organizers and as an
optional upgrade for guests. Estimated effort: one migration, ~6 functions,
one new route, plus tests.
