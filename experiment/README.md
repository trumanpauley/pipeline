# The Pipeline Experiment

A referral-based experiment about how people are connected. Each participant arrives through a
single-use link, classifies their relationship with whoever invited them, and can invite two people.
Inviting unlocks two reveals: the company name, then what Pipeline is building.

- **Frontend:** Vite + React + TypeScript single-page app (no router or UI libraries)
- **Backend:** Supabase only: email-OTP/magic-link auth and Postgres. All logic lives in SQL functions
  protected by Row Level Security, so there's no server code and no service-role key anywhere.
- **Hosting:** Vercel (static)

## Architecture

```
Phone browser ──► Vercel (static SPA)
      │
      └──► Supabase
             ├─ Auth: email one-time code / magic link
             └─ Postgres: tables (RLS on, no direct writes)
                          + SECURITY DEFINER RPC functions = the whole "API"
```

| Route        | What it is                                                                 |
|--------------|-----------------------------------------------------------------------------|
| `/i/:token`  | Invitation: landing → one-tap classification → email + consent → code      |
| `/`          | Participant home: reveals, two invite slots, branch tree, privacy controls  |
| `/admin`     | Admin dashboard: metrics, seed links, method comparison, tree, CSV exports  |

### Data model (`supabase/migrations/001_experiment_schema.sql`)

| Table                 | Purpose |
|-----------------------|---------|
| `participants`        | One node per person. `parent_id` is the inviter, `depth` is the generation (seeds = 1), `method` is the randomly assigned classification method, plus consent timestamps and reveal progress. |
| `invitations`         | Single-use links. `token` (122 random bits), `status`: `created → opened → accepted`, or `duplicate` (opened by someone already in, so no credit) / `revoked`. A `sender_id` of null marks a seed link. |
| `classifications`     | One row per (invitation, direction). `outbound` = sender rates recipient *before* the link exists; `inbound` = recipient rates sender after opening. Stores method, value and response time. |
| `feedback`            | The optional question that unlocks the reveals without inviting anyone. |
| `experiment_settings` | Tunable parameters (see below). |
| `admins`              | Emails allowed to use `/admin`. |

### Experiment rules (enforced in SQL)

- **Random assignment:** when a link is first opened, the server picks a method among `methods`,
  balancing toward the least-assigned one so small cohorts stay comparable. Participants keep that
  method for every classification they make.
  - A: strength (close friend / acquaintance / weak connection)
  - B: context (class / team / club / work / social / other)
  - C: comfort asking for an introduction (1–5)
- **Two active links** per participant (`max_invites`). A revoked link, or one used by someone who
  was already a participant, frees its slot. There's a lifetime cap of `max_links_total`.
- **No loops or double credit:** each participant has exactly one parent, set once when they join.
  Existing participants are never re-parented; their visit to another link is recorded as
  `duplicate`. Accepting your own link is rejected (`self_invite`).
- **Reveals** unlock when a link is generated (`unlock_on = "created"`) or, if you set
  `unlock_on = "accepted"`, when an invitee actually joins. Answering the feedback question unlocks
  both reveals. Reveal text is served by the database, so it isn't visible in the JS bundle.
- **Privacy:** participants see only their own invitations, the nicknames they gave them, and an
  anonymous shape of their branch. Nobody else's classifications, names or emails are shown.
- **Deletion:** "Delete my data" erases name, email, answers, feedback and the auth account, and
  closes unused links. An anonymous node remains so other people's branches stay intact.

### Changing the experiment

- **Copy, question wording, method labels:** `src/config/experiment.ts`
- **Without redeploying:** Supabase → Table editor → `experiment_settings` (`reveals`, `unlock_on`,
  `max_invites`, `methods` to enable or disable a method, `feedback_question`)
- **Adding or renaming a stored option value:** update both `METHODS` in `src/config/experiment.ts`
  and the `method_options` setting.
- **Schema changes:** add `supabase/migrations/002_*.sql`. Don't edit 001 after it's been applied.

## Setup

### 1. Supabase

Use a **new Supabase project** (free tier is fine). The existing Pipeline app's migration adds a
trigger that creates a `profiles` row for every new auth user, so sharing a project would add empty
Pipeline profiles for experiment participants. Table and function names don't collide, so sharing a
project still works if you have to.

1. **SQL Editor:** paste and run `supabase/migrations/001_experiment_schema.sql`.
2. **Make yourself an admin:**
   ```sql
   insert into public.admins (email) values ('you@example.com');
   ```
3. **Authentication → Sign In / Providers → Email:** enable it. Keep "Confirm email" on.
4. **Authentication → URL Configuration:**
   - Site URL: `https://YOUR-DOMAIN`
   - Redirect URLs: add `https://YOUR-DOMAIN/**` and `http://localhost:5173/**`
5. **Authentication → Emails → Templates:** add the 6-digit code to both the **Confirm signup** and
   **Magic Link** templates. New users get Confirm signup; returning users get Magic Link. Codes
   are what make sign-in work inside Instagram, iMessage and other in-app browsers. For example:
   ```html
   <h2>Your code: {{ .Token }}</h2>
   <p>Or <a href="{{ .ConfirmationURL }}">tap here to continue</a>.</p>
   ```
   Subject suggestion: `Your Pipeline Experiment code`.
6. **Custom SMTP (needed before launch):** Supabase's built-in email sender only allows a few emails
   per hour. Under **Authentication → Emails → SMTP Settings**, connect a provider such as Resend,
   Postmark or SES (all have free tiers), then raise the email rate limit under
   **Authentication → Rate Limits**.
7. **Project Settings → API:** copy the Project URL and the **publishable/anon** key.

### 2. Run locally

```bash
cd experiment
```

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then:

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173/admin, sign in with your admin email, and generate a seed link.

### 3. Deploy to Vercel

1. Import the GitHub repo into Vercel as a **new project**.
2. Set **Root Directory** to `experiment`. The framework (Vite), build command and SPA rewrites come
   from `vercel.json`.
3. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Deploy, then put the production URL into Supabase's Site URL and Redirect URLs (step 1.4).

### 4. Launch

1. Open `/admin` → **Seed invitations** → generate 10 links. Set "Your name, as invitees see it"
   to your first name; invitees will be asked "How close are you to {name}?".
2. Send each person their own link. Each link works once.
3. Watch the dashboard. The CSV exports cover participants (the only file with emails),
   invitations, classifications, reciprocal pairs and feedback.

## Testing

`npm run test:e2e` runs a full browser test on an iPhone viewport against the real SQL migration on
a local PostgreSQL. `test/mock-supabase.mjs` stands in for Supabase Auth and PostgREST's `/rpc`,
running each call with the same role switch and JWT claims that Supabase uses, so RLS and the
functions behave as they do in production.

It covers: the admin creating seed links → a seed participant joining → generation 2 (via a magic
link opened in a *different* browser) → generation 3; both reveals; opened vs joined status;
self-invites, link reuse, duplicate credit, invite limits, invalid values and guessed tokens; the
feedback path; branch privacy (no names, emails, ids or classifications leak); direct-table RLS;
dashboard numbers; CSV export; data deletion; and marketing consent. It saves screenshots to
`test-results/`.

It needs PostgreSQL 14+ and Playwright's Chromium:

```bash
PX_DATABASE_URL=postgres://postgres@127.0.0.1:5432/px npm run test:e2e
```

The test drops and recreates the `px` database at that URL.
