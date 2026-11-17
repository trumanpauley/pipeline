# Pipeline Events — architecture

## What exists today

The repository root is the Pipeline networking prototype: a static vanilla-JS app
(`index.html`, `app.js`, `styles.css`) with its own Supabase migrations
(`supabase/migrations/001…002`). Migration 001 installs a trigger on `auth.users`
that creates a **public** Pipeline profile for every new auth user.

Pipeline Events lives in `events/` and is deliberately self-contained:

| Concern            | Decision                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| Frontend           | Vite + React + TypeScript SPA, no UI framework, mobile-first CSS         |
| Backend            | Supabase (Postgres + Auth). **A separate Supabase project from Pipeline.** |
| Hosting            | Separate Vercel project, Root Directory = `events`                       |
| Server logic       | Postgres functions (`security definer`) called via `supabase.rpc()`      |
| Auth               | Supabase email one-time code (OTP). No passwords.                        |
| External services  | None beyond Supabase/Vercel (Supabase needs SMTP configured for volume)  |

Why a separate Supabase project: guests signing in to the Pipeline project would
fire the profile trigger and appear in Pipeline discovery, and event referral
edges must stay separate from permanent Pipeline relationships. A separate
project makes that separation physical. Moving anyone into Pipeline later is an
explicit step limited to guests who opted in (`pipeline_marketing` consent).

## Request flow

```
Guest taps /i/<token>  ──► rpc get_invitation(token)        (anon; no emails returned)
   enters name + email + optional consent
   ──► auth.signInWithOtp(email)  ──► 6-digit code by email
   ──► auth.verifyOtp(email, code)          (proves email ownership)
   ──► rpc accept_invitation(token, name, consent)
          locks event row  → capacity check (≤ capacity attending)
          locks invite row → must be 'open'
          inserts guest, referral edge, consent records, 2 new invites
   ──► /e/<event_id>  personal dashboard  (rpc guest_dashboard)
```

Returning guests open `/me`, enter their email, receive a code and land on their
dashboard. That is the "reclaim" mechanism: identity = verified email, so a guest
on a new phone gets their RSVP and both invitation slots back.

A 6-digit code (rather than a magic link) is used because invite links are mostly
opened inside in-app browsers (iMessage, Instagram, WhatsApp). A magic link opens
in a different browser and loses the in-progress RSVP; a code does not.

## Supabase schema (`events/supabase/migrations/0001_pipeline_events.sql`)

```
events                    one row per event; capacity (default 400), rsvp_open,
                          public info + private_details (only shown to guests)
event_guests              one node per person per event
                          role: host | guest, rsvp_status: attending | declined
                          depth (0 = host), user_id (auth), email, anonymized_at
event_invitations         single-use links: inviter_guest_id, slot, token,
                          status: open | accepted | revoked
                          unique (inviter_guest_id, slot); trigger: guests ≤ slot 2
event_referrals           the referral edge: inviter_guest_id → invitee_guest_id,
                          invitation_id. invitee unique (a tree, one parent each)
event_consent_texts       versioned wording of every consent we ask for
event_consents            append-only log: guest, consent_text_id, granted,
                          source, created_at  (records *when* and *what*)
event_removal_requests    guest-initiated data removal requests, processed by host
```

Referral edges are a separate table from invitations so the graph can be
queried/visualised directly (`select inviter_guest_id, invitee_guest_id from
event_referrals`), and they have no relation to Pipeline's `follows` /
`acquaintances`.

### Server-side guarantees

* **Two-invitation limit** — invitations are only created inside
  `accept_invitation` (slots 1 and 2), `unique (inviter_guest_id, slot)` makes a
  third row impossible, and a trigger rejects slot > 2 for non-hosts.
* **Capacity (400)** — `accept_invitation` and `set_rsvp_status('attending')`
  take `select … for update` on the event row, so all capacity-changing writes
  for an event are serialised; the count and insert happen under the lock.
* **Single use** — the invitation row is locked `for update` and must be
  `open`; `accepted_guest_id` is unique; one guest per (event, user) and per
  (event, email).
* **Tokens** — 144 bits from `gen_random_bytes`, base64url. Rotating an unused
  link replaces the token in place (the old link dies, the slot stays).

### Row Level Security

RLS is enabled on every table and **there are no insert/update/delete policies**:
every write goes through a `security definer` function that checks
`auth.uid()` and the caller's verified email. Select policies:

* guests read their own guest row, own invitations, own consent records;
* hosts (organizers) read everything for events they host;
* `anon` reads nothing directly — the landing page uses `get_invitation(token)`,
  which returns the event's public info and the inviter's name only.

Other guests' emails are never returned to guests: `guest_dashboard` returns
names only (for the path and accepted invites). Only hosts see emails.

### Organizer access

An organizer is an `event_guests` row with `role = 'host'`, linked to a
verified email. Events and hosts are created only by
`admin_create_event(...)`, which is not executable by `anon`/`authenticated` —
run it in the Supabase SQL editor. Hosts can mint additional root invitations
from the organizer dashboard (hosts are not limited to two).

### Consent

The RSVP form shows server-provided consent text. On acceptance we record
`event_rsvp` (the necessary-processing notice) and `pipeline_marketing`
(granted **or** declined; unchecked by default). Guests can change marketing
consent later; every change is a new row, never an update.

### Data removal

A guest submits a removal request from their dashboard. The host processes it:
the guest node is anonymised (`full_name = 'Removed guest'`, email and user link
cleared), marketing consent is withdrawn, open invitations are revoked. The node,
referral edges and consent log remain because they are necessary event records
(capacity history, the invitation tree, proof of consent).

## Frontend routes

```
/i/:token          invitation landing → RSVP form → code → accepted
/me                sign in with code, list my events
/e/:eventId        personal dashboard: path to host, two slots, share, RSVP, privacy
/organizer         host dashboard: stats, growth, guests, removal requests, CSV
```

## Stages

1. Schema + SQL tests (incl. concurrent acceptance) — `npm run test:db`
2. Invitation landing + RSVP + OTP + accept
3. Guest dashboard (path, slots, share, rotate link, RSVP change)
4. Organizer dashboard + CSV
5. Consent changes + removal requests
