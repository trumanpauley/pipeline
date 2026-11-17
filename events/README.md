# Pipeline Events

Mobile-first invitations and referrals for a private event (up to 400 guests).
Guests open a unique link, RSVP with name + email (confirmed with an emailed
code), and get two single-use links to invite others. The invitation tree is
stored for later visualisation.

Architecture and schema: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
src/                React + TypeScript app (Vite)
supabase/migrations Schema, RLS and server functions (run once)
supabase/templates  Email template with the one-time code
supabase/tests      Database tests (functional + concurrency)
```

## 1. Supabase (one-time)

Use a **new Supabase project**, separate from the Pipeline networking app (see
the architecture doc for why).

1. **SQL editor** → paste and run `supabase/migrations/0001_pipeline_events.sql`.
2. **Authentication → Sign In / Providers → Email**: enabled. "Confirm email" can
   stay on. Set the email OTP length to 6 and expiry to 3600 seconds.
3. **Authentication → Emails → Templates**: for both **Confirm signup** and
   **Magic Link**, paste `supabase/templates/otp-code.html` and set the subject to
   `Your Pipeline Events code: {{ .Token }}`. Without `{{ .Token }}` guests get
   a link instead of a code.
4. **Authentication → Emails → SMTP settings**: configure a custom SMTP sender
   (any provider: Resend, Postmark, SES, Google Workspace…). Supabase's built-in
   mailer only sends a few emails per hour and will block guests otherwise. Then
   raise **Rate limits → emails per hour** to a few hundred.
5. **Authentication → URL configuration**: Site URL = your Vercel URL.
6. **Create the event** in the SQL editor (the organizer doesn't need to have
   signed in yet; they're linked by email on first sign-in):

   ```sql
   select public.admin_create_event(
     p_slug          => 'pipeline-launch',
     p_name          => 'Pipeline Launch Party',
     p_host_email    => 'organizer@example.com',
     p_host_name     => 'Your Name',
     p_starts_at     => '2026-12-05 20:00-05',
     p_location_name => 'Cambridge, MA',
     p_description   => 'An evening with friends of Pipeline.',
     p_private_details => 'Exact address and door code, shown only to RSVPed guests',
     p_capacity      => 400
   );
   -- optional co-organizer:
   -- select public.admin_add_host('<event id>', 'cohost@example.com', 'Co Host');
   ```

## 2. Run locally

```bash
cd events
cp .env.example .env.local   # fill in Project URL + publishable/anon key
npm install
npm run dev
```

Open `/organizer`, sign in with the organizer email, and create invitation links.

## 3. Deploy to Vercel

New Vercel project from this repo with **Root Directory = `events`**
(framework preset: Vite). Environment variables:

| Name                            | Value                                  |
| ------------------------------- | -------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://<ref>.supabase.co`            |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable / anon key (never service role) |

`vercel.json` rewrites all paths to the SPA and sets basic security headers.

## Tests

```bash
npm test          # unit tests (CSV export, stats)
npm run typecheck
npm run test:db   # needs local PostgreSQL 15+ binaries (initdb, pg_ctl, psql)
```

`test:db` boots a throwaway Postgres, applies the migration on a minimal
Supabase stand-in, and checks RLS, privacy, consent logging, removal, reclaim,
the two-invite limit, a 40-way race for one link, and 500 concurrent RSVPs
against a 400-person event (exactly 400 get in).

## Operating notes

* **Organizer access** is a guest row with `role = 'host'`; only the SQL-editor
  functions `admin_create_event` / `admin_add_host` create one.
* **Removal requests** appear at the top of the organizer dashboard. "Remove
  data" anonymises the guest (name → "Removed guest", email cleared), withdraws
  marketing consent and revokes their unused links, but keeps the anonymous node,
  referral edges and consent log as event records. To also delete their login,
  remove the user under Authentication → Users.
* **Changing consent wording**: insert a new row in `event_consent_texts`
  (e.g. `pipeline_marketing.v2`), set `is_current = false` on the old one and
  `true` on the new one. Past records keep pointing at the text they agreed to.
* **Exports**: guests, referral edges (for the future Grid) and the full consent
  log, as CSV, from the organizer dashboard.
