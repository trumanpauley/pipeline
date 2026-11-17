# The Pipeline Experiment

A referral-based experiment about how people are connected. Each participant arrives through a
single-use link, classifies their relationship with whoever invited them, and can invite two people.
Inviting unlocks two reveals: the company name, then what Pipeline is building.

- **Frontend:** Vite + React + TypeScript single-page app (no router or UI libraries)
- **Backend:** Supabase only: anonymous auth (plus optional email codes) and Postgres. All logic lives
  in SQL functions protected by Row Level Security, so there's no server code and no service-role key
  anywhere.
- **Hosting:** Vercel (static)

## Architecture

```
Phone browser ──► Vercel (static SPA)
      │
      └──► Supabase
             ├─ Auth: anonymous sign-in on join; optional email link/sign-in
             └─ Postgres: tables (RLS on, no direct writes)
                          + SECURITY DEFINER RPC functions = the whole "API"
```

| Route        | What it is                                                                 |
|--------------|-----------------------------------------------------------------------------|
| `/i/:token`  | Invitation: landing → one-tap classification → first name + consent → in   |
| `/`          | Participant home: reveals, two invite slots, branch tree, early access, privacy |
| `/admin`     | Admin dashboard: metrics, seed links, method comparison, tree, CSV exports  |

### Onboarding and accounts

Nobody types an email before the referral stage:

1. **Landing → one relationship question → first name + research consent.** On Continue, the app
   calls Supabase `signInAnonymously()`. That creates a real, unique auth user (no email, no
   password), and the participant, their answers and their links are tied to it.
2. **The session is kept in the browser,** so returning on the same phone needs no sign-in.
3. **After the mission reveal,** an optional **Pipeline Community** screen ("You're just getting
   connected.") asks for an email and two separate, unticked choices: *Invite me to future
   Pipeline experiments* and *Send me Pipeline updates and early access*. Joining needs at least
   one; with neither ticked nothing is stored. "Maybe later" stores nothing except that the screen
   was dismissed (on the server, so it never reappears), and participation is unaffected. A
   Pipeline Community card on the home screen and a row in *Your data* let people join later,
   change either choice, or unsubscribe. See [Pipeline Community](#pipeline-community).
4. **Saving the network (optional):** from that screen ("Also save my network to this email") or
   from **Your data → Save**, the participant links a verified email with a 6-digit code. The email
   is attached to the *same* Supabase user (`updateUser` + `verifyOtp`, type `email_change`), so
   nothing in the experiment data changes. After that they can sign in on any device from `/`.
5. Anonymous participants who tap **Sign out** are warned first that their network lives only in
   that browser.

**Protections against duplicates, self-referrals and automated abuse**

| Risk | Protection |
|------|------------|
| Same person joining twice from one browser | A random per-browser id (stored server-side only as a salted hash) allows one active participant per browser: `device_already_joined`. |
| Self-referral | Rejected when the accepting account is the sender, **or** the accepting browser is the sender's browser (e.g. after signing out). |
| Re-joining / double credit | Existing participants are never re-parented; their visit is recorded as `duplicate`. Each link works once. |
| Scripted sign-ups | Per-IP limits on joins, link opens and waitlist sign-ups; a per-participant hourly invite limit; and Supabase's own anonymous sign-in rate limit. Optional Cloudflare Turnstile CAPTCHA (see setup). IPs are stored only as salted hashes and purged after 2 days. |
| Friends-of-self on one network | Joins from the same network as the sender are flagged (not blocked) for review in the admin dashboard. |

Limits are editable in `experiment_settings.rate_limits`. Set `block_same_device` to `false` if
people genuinely share browsers.

### Data model (`supabase/migrations/001_experiment_schema.sql`, `002_anonymous_onboarding.sql`)

| Table                 | Purpose |
|-----------------------|---------|
| `participants`        | One node per person. `parent_id` is the inviter, `depth` is the generation (seeds = 1), `method` is the randomly assigned classification method, plus consent timestamps and reveal progress. |
| `invitations`         | Single-use links. `token` (122 random bits), `status`: `created → opened → accepted`, or `duplicate` (opened by someone already in, so no credit) / `revoked`. A `sender_id` of null marks a seed link. |
| `classifications`     | One row per (invitation, direction). `outbound` = sender rates recipient *before* the link exists; `inbound` = recipient rates sender after opening. Stores method, value and response time. |
| `feedback`            | The optional question that unlocks the reveals without inviting anyone. |
| `waitlist`            | Legacy early-access sign-ups (kept; active rows were copied into `community_signups` by `009`). |
| `community_signups`   | Optional Pipeline Community: one row per participant and per email; each consent (`research_invites`, `updates`) has its own exact text, timestamp and withdrawal timestamp; `unsubscribed_at`. No table access via the API at all. |
| `rate_events`         | Short-lived, hashed counters for rate limiting. |
| `experiment_settings` | Tunable parameters (see below). |
| `admins`              | Emails allowed to use `/admin`. |

### Experiment rules (enforced in SQL)

- **Random assignment:** when a link is first opened, the server picks a method among `methods`,
  balancing toward the least-assigned one so small cohorts stay comparable. Participants keep that
  method for every classification they make.
  - A: strength (close friend / acquaintance / weak connection)
  - B: context (class / team / club / work / social / other)
  - C: comfort asking for an introduction (1–5)
  - D: circular connection strength (0–100%). "How well do you know {name}?" The participant drags a
    dot clockwise around a circle; a full turn is 100%.
    - Bands: 0% Not well, 1–24% Not very well, 25–49% Somewhat, 50–74% Well, 75–100% Very well.
    - Only the dot itself can be dragged, so higher ratings take more physical movement. Crossing
      the top can't jump between 0% and 100%. Arrow keys and screen readers work through a native
      slider underneath.
    - Releasing never submits: Continue unlocks after the first interaction, so 0% is a deliberate
      answer.
    - Built as `src/components/CircularSlider.tsx`, used by `Classifier` for both rating the inviter
      and rating someone being invited.
- **Balanced assignment counts openings since the method list last changed**
  (`assignment_epoch`, reset automatically when `methods` changes). A newly added method therefore
  doesn't receive every new participant until it catches up. To stop assigning a method, remove it
  from `methods`; people already on it keep it.
- **Research data per answer:** participant ID, invitation, method, value (D: 0–100), question
  version (`v1`, `circular_v1`), response time and timestamp.
  - `classification_events` records when each question was shown and first touched, for every
    method, so completion, abandonment and time-to-first-touch can be compared.
  - Admin → **Strength ratings by method** compares A–D on a common 0–100 strength scale (B has
    none): average, median time, completion, abandonment, D's distribution, and
    inviter-versus-recipient agreement for every method pair.
  - Exports: `classifications.csv` (with `question_version`, `completed`, `strength_score`) and
    `classification_events.csv`.
- **Two active links** per participant (`max_invites`). A revoked link, or one used by someone who
  was already a participant, frees its slot. There's a lifetime cap of `max_links_total`.
- **No loops or double credit:** each participant has exactly one parent, set once when they join.
  Existing participants are never re-parented; their visit to another link is recorded as
  `duplicate`. Accepting your own link is rejected (`self_invite`).
- **Reveals** unlock when a participant **shares or copies** a link (`unlock_on = "shared"`, the
  default): the first share reveals the name, the second the mission. The second invitation card
  stays locked until the first link has been shared.
  - Set `unlock_on` to `"created"` to unlock on link creation, or `"accepted"` to wait until an
    invitee joins.
  - Answering the feedback question unlocks both reveals.
  - Reveal text is served by the database, so it isn't visible in the JS bundle.
- **Invitation lifecycle** is recorded as four separate facts: created, **shared** (`shared_at`,
  `share_method` `share`/`copy`, `share_count`), opened and accepted.
  - "Shared" means the participant *tapped* Share or Copy. It is not proof the link was received;
    only "opened" and "accepted" show that.
  - Links created before migration `003` are marked `share_method = 'legacy'`, so no existing
    participant gets re-locked. The admin "Shared" count excludes them.
- **Privacy:** participants see only their own invitations, the nicknames they gave them, and an
  anonymous shape of their branch. Nobody else's classifications, names or emails are shown.
- **Deletion:** "Delete my data" erases name, email, answers, feedback, waitlist entry, browser and
  network hashes, and the auth account (anonymous or not), and closes unused links. An anonymous node
  remains so other people's branches stay intact.
- **Compatibility:** `002` only adds things. Links, participants and answers created under `001`
  keep working, `accept_invitation` still accepts the old 4-argument call, and participants who
  joined with an email keep signing in with it. The old `marketing_consent` column is kept but no
  longer collected; the waitlist replaces it.

### Changing the experiment

- **Copy, question wording, method labels:** `src/config/experiment.ts`
- **Without redeploying:** Supabase → Table editor → `experiment_settings` (`reveals`, `unlock_on`,
  `max_invites`, `methods` to enable or disable a method, `feedback_question`)
- **Adding or renaming a stored option value:** update both `METHODS` in `src/config/experiment.ts`
  and the `method_options` setting.
- **Schema changes:** add `supabase/migrations/003_*.sql`. Don't edit an applied migration.

## Setup

### 1. Supabase

Use a **new Supabase project** (free tier is fine). The existing Pipeline app's migration adds a
trigger that creates a `profiles` row for every new auth user, so sharing a project would add empty
Pipeline profiles for experiment participants. Table and function names don't collide, so sharing a
project still works if you have to.

1. **SQL Editor:** paste and run, in order, `supabase/migrations/001_experiment_schema.sql`,
   `002_anonymous_onboarding.sql`, `003_share_tracking.sql`, `004_phone_ready.sql` and
   `005_name_moderation.sql`, `006_circular_strength.sql`, `007_invited_names.sql` and
   `008_live_invitation_tracking.sql` and `009_pipeline_community.sql`. If you've already run some, run
   only the ones after them.
2. **Make yourself an admin:**
   ```sql
   insert into public.admins (email) values ('you@example.com');
   ```
3. **Authentication → Sign In / Providers:**
   - Turn on **Allow anonymous sign-ins**. This is what makes onboarding email-free.
   - Keep **Email** enabled with "Confirm email" on (used for optional linking and sign-in).
4. **Authentication → URL Configuration:**
   - Site URL: `https://YOUR-DOMAIN`
   - Redirect URLs: add `https://YOUR-DOMAIN/**` and `http://localhost:5173/**`
5. **Authentication → Emails → Templates:** add the 6-digit code to the **Change Email Address**
   template (used when a participant saves their network to an email), and to **Magic Link** and
   **Confirm signup** (used for signing in). Codes are what make this work inside Instagram,
   iMessage and other in-app browsers. For example:
   ```html
   <h2>Your code: {{ .Token }}</h2>
   <p>Or <a href="{{ .ConfirmationURL }}">tap here to continue</a>.</p>
   ```
   Subject suggestion: `Your sign-in code`. Keep "Pipeline" out of these emails; a participant
   who hasn't unlocked the name yet may receive one.
6. **Custom SMTP (recommended):** email is now optional, so launch doesn't depend on it, but
   Supabase's built-in sender only allows a few emails per hour. Under **Authentication → Emails →
   SMTP Settings**, connect a provider such as Resend, Postmark or SES (all have free tiers), then
   raise the email rate limit under **Authentication → Rate Limits**.
   While you're there, check **Rate limit for anonymous users** (default 30 per hour per IP). A
   whole class on one campus Wi-Fi joining at once could hit it, so raise it if needed.
7. **Optional CAPTCHA:** create a free Cloudflare Turnstile widget, put its secret key in
   **Authentication → Attack Protection → Enable CAPTCHA protection** (provider: Turnstile), and set
   `VITE_TURNSTILE_SITE_KEY` in Vercel. It stays invisible unless Cloudflare suspects a bot.
   Set both or neither: with CAPTCHA on in Supabase but no site key, sign-ins will fail.
8. **Project Settings → API:** copy the Project URL and the **publishable/anon** key.

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

### Keeping the name hidden

Before a participant's first unlock, the app never shows "Pipeline": the header and browser tab say
"The Experiment", and the sharing preview says "You've been invited." The name appears once they
share their first link, and stays for returning visits. The admin dashboard always says Pipeline.

**Watch the web address.** Invite links use whatever domain the site is on, so a `pipeline-…`
address gives the name away in every link. Use a neutral domain for the real launch: either add one
in Vercel → **Domains** (a free `something.vercel.app` name if available, or your own) and make
it the primary domain, or create the Vercel project under a neutral name. The Supabase project URL
isn't visible to participants.

The JavaScript bundle still contains the word (for example the post-unlock header), so someone
reading the page source could find it. Reveal texts themselves are served by the database only
after unlocking.

### Live invitation statuses

Each invitation card shows its status, which updates live and persists after a refresh:

| Status | Means |
|---|---|
| **Ready** | Link generated, not shared yet |
| **Pending** | The inviter tapped Share or Copy. A website can't confirm a text or iMessage was delivered, so this only means sharing started. |
| **Opened** | A person opened the link |
| **Connected** | They finished joining. Their node lights up in the network. |

Reveals still unlock when sharing starts (first share → the name, second → the mission). They never
wait for the recipient.

**How "Opened" stays honest.**
- Opens only count when the invitation page's code actually runs in a browser. Link-preview fetchers
  (iMessage, Slack, WhatsApp…) that just read the page never count.
- Crawlers that do run code are excluded by user agent (`px_is_bot_ua`) and get a neutral page with
  no names.
- The sender's own browser never counts, signed in or not; it's recognised by its browser ID.
- Repeat visits from the same browser count once (`unique_open_count`).
- Every step is logged in `invitation_events` (created, share_initiated, opened, bot_preview,
  sender_open, connected). Admin-only; exportable as `invitation_events.csv`.

**Live updates.** The home page subscribes with Supabase Realtime to changes on *its own*
invitations. Row-level security means Realtime only streams rows the participant sent. Migration
`008` adds `invitations` to the `supabase_realtime` publication; Realtime is on by default in
Supabase. If Realtime is unavailable, the page polls every 20s while visible, and it always
refreshes when the app returns to the foreground.

### Inviter-provided names

When someone invites a person, they type that person's first name. It's stored on the invitation as
`invited_name`; no participant exists until the person actually joins.

**The recipient's journey.** They open the link, see the landing page, answer the relationship
question, then get:
- **"Are you Sarah?"**, with "That's who Nadia invited.", "Yes, that's me" and "That's not my name".
  Research consent must be ticked first.
- **"That's not my name"** shows a first-name field. A quiet "This invite wasn't meant for me" link
  handles forwarded links: the invitation is **not** accepted, the stranger's relationship answer is
  discarded, `misdirected_count` is recorded, and the link stays open for the intended person.
- **Seed links** (no invited name) show "And you are?" with the normal name field.
- **Refreshing** returns to the same step with the same choice, typed name and consent. Progress is
  kept on the device, per invitation.

**What's stored.**
- `participants`: `invited_name`, `confirmed_name` (confirmed or typed by the recipient), and
  `name_was_corrected`, which the server computes rather than trusting the browser. These sit
  alongside `invitation_id` and `user_id`.
- An inviter's suggestion is never treated as a verified identity.
- Both names go through name moderation. A hidden or replaced invitee name flows through
  automatically, because `invited_name` mirrors the moderated value.

**Ratings.** Each side's relationship rating is stored separately on the same invitation: outbound
by the inviter, inbound by the recipient. Neither is ever shown to the other or carried in the link.

### Names: validation, privacy and moderation

Participants type their own first name and the names of people they invite.

**Validation (in the database, `px_name_problem`).** It applies to joining, creating an invitation,
admin seed links and admin replacements. Every write goes through these database functions (tables
can't be written directly), so requests sent straight to the Supabase API are checked the same way
as the app.
- **Allowed:** letters from any script, with spaces, apostrophes (' ’ ʻ), hyphens and periods; up to
  40 characters. José, Nguyễn, O'Brien, Jean-Luc, 李娜, Дмитрий and محمد all pass.
- **Rejected:**
  - digits, symbols, emoji and invisible characters;
  - links (`www.`, `http`, `word.word`);
  - spam (5+ repeated letters, more than 6 words);
  - names matching `moderation_terms`.
- **Matching terms.** Accents are folded and spaces/dots are removed before matching, so "Fück",
  "f u c k" and "f.u.c.k" are caught. Most terms match **whole words only** to avoid false positives
  (Kshitij, Shital, Cassandra, Hassan, Analisa, "Kike" for Enrique all pass). Edit the list in
  Table editor → `moderation_terms`. It's never sent to the browser.
- **What people see.** The app checks names before creating anything and shows "Please enter a
  different name." The server never says which rule matched.
- **Rate limits.** Name checks are limited per IP (`name_checks_per_ip_hour`), and rejected names
  per IP (`name_rejects_per_ip_hour`).

**Privacy.**
- **Invitation pages** show the sender's **first name only**, and only when it's approved and the
  sender isn't suspended. Otherwise they say "You've been invited."
- **Participants' own dashboards** show their own name and the names they typed for their invitees.
- **Network views** contain no other names and no relationship answers. The admin tree uses IDs only.

**Moderation (admin dashboard → Names & moderation).**
- Review participant names and invitee names, with items that need review first.
- **Flag** hides a name from invitation pages until approved; **Hide** removes it from view;
  **Replace** sets a new, validated name.
- **Suspend** pauses a participant and revokes their unused links (they see "Your participation is
  paused.").
- Every action goes to `moderation_actions` with the admin's email and the before/after name.
  "Delete my data" scrubs the names from that log too.
- Set `name_review` to `"before"` to keep new names off invitation pages until you approve them.
  The default `"after"` shows them right away.

### Optional phone verification ("Save your network")

The app is ready for it, but it's **off** until you set `VITE_PHONE_AUTH=1`. Today participants save
their network with an email code, which keeps working until you switch.

How it works:
- A participant who has discovered Pipeline sees **Save your network** and enters their number.
- `supabase.auth.updateUser({ phone })` texts a code, and `verifyOtp({ type: 'phone_change' })`
  attaches the verified number to their **existing anonymous account**. Same user id, so participant
  row, links and answers are unchanged, and no second account is created. A number already linked
  to another participant is refused.
- Returning visitors choose **Use phone number instead** on the start page.
  `signInWithOtp({ phone, shouldCreateUser: false })` means only numbers already linked can sign in,
  so nobody can create accounts or SMS charges by guessing numbers.
- Pipeline updates are a separate email signup with its own unticked consent checkbox.

To switch it on:
1. **Pick an SMS provider.** Supabase doesn't send texts itself or charge for them; the provider
   does. Supported: Twilio, Twilio Verify, MessageBird, Vonage, Textlocal, or your own via a Send
   SMS hook.
   - **Twilio Verify is the simplest for US numbers.** It handles the sending number and carrier
     rules, and charges per successful verification (on the order of a few cents).
   - Plain Twilio Programmable SMS costs around a cent per text plus a monthly number fee. To text
     US phones you must first register for **A2P 10DLC** (or verify a toll-free number), which takes
     days and has small fees.
   - Prices change, so check the provider's current pricing.
2. **In Supabase → Authentication → Sign In / Providers → Phone:**
   - Enable it, choose the provider, and paste its credentials (for Twilio Verify: Account SID,
     Auth Token and Verify Service SID).
   - Keep "Enable phone confirmations" on.
   - Set the SMS message, for example `Your code is {{ .Code }}`.
   - To try it for free, add a test phone number with a fixed code under the phone provider's test
     settings: no text is sent for those numbers.
3. **Authentication → Rate Limits:** set "SMS messages per hour" to what you're willing to pay for;
   this caps cost if someone abuses the form. Turnstile CAPTCHA (step 7 above) also protects it.
4. **In Vercel**, add `VITE_PHONE_AUTH` = `1` to the real project and redeploy. From then on, Your
   data → Save and the home card use phone instead of email.

### 3. Deploy to Vercel

1. Import the GitHub repo into Vercel as a **new project**.
2. Set **Root Directory** to `experiment`. The framework (Vite), build command and SPA rewrites come
   from `vercel.json`.
3. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (and
   `VITE_TURNSTILE_SITE_KEY` if you enabled CAPTCHA).
4. Deploy, then put the production URL into Supabase's Site URL and Redirect URLs (step 1.4).

### 4. Launch

1. Open `/admin` → **Seed invitations** → generate 10 links. Set "Your name, as invitees see it"
   to your first name; invitees will be asked "How close are you to {name}?".
2. Send each person their own link. Each link works once.
3. Watch the dashboard. The CSV exports cover participants, invitations, classifications,
   reciprocal pairs, feedback, the waitlist and the Pipeline Community (`community.csv`,
   `research_pool.csv`). Only participants (linked emails), waitlist and the community files
   contain email addresses.

## Pipeline Community

Optional, shown once after the mission reveal (migration `009`).

- **Privacy.** Emails live only in `community_signups`, which has RLS on and no grants: the REST
  API can't read or write it. Participants see their own signup through `get_my_account()`;
  everything else goes through server-validated RPCs (`join_community`,
  `update_community_preferences`, `dismiss_community_prompt`). No password or account is created:
  the email is attached to the participant's existing anonymous identity.
- **Consent.** Each choice keeps the exact checkbox wording (setting `community_consent_texts`),
  when it was given and when it was withdrawn. Turning both off sets `unsubscribed_at`; the row is
  kept as the consent record and can be rejoined. "Delete my data" removes it entirely.
- **Duplicates.** One row per participant and one per email. Submitting an address that already
  belongs to someone else returns a normal success, changes nothing and creates nothing, so
  addresses can't be probed. Sign-ups are rate-limited per IP (`community_per_ip_hour`).
- **Admin.** The dashboard's *Pipeline Community* panel shows signups, each consent, conversion
  (active signups ÷ participants who reached the mission), "Maybe later" and unsubscribes, and
  signups by generation, with two admin-only CSVs:
  - `community.csv`: every signup with both consents and all timestamps.
  - `research_pool.csv`: only people with an active *future experiments* consent (participant
    id, email, generation). It contains no relationship data and is the list to use when
    Experiment 2 needs to contact people.

## Try it on a phone (no Supabase, no Codespace)

`npm run build:demo` produces a static site in `dist-demo/` with the whole backend running inside
the page. It uses the real schema and both migrations in PGlite, which is Postgres compiled to
WebAssembly. Host it anywhere and open it on a phone.

**Easiest: a free Vercel project for the demo**
1. In Vercel, **Add New → Project**, import this repo, and set **Root Directory** to `experiment`.
2. Under **Environment Variables**, add `PIPELINE_DEMO` = `1`. No Supabase variables are needed.
3. Deploy, then open the `*.vercel.app` URL on your phone.

The same repo can also have your real project. That one simply doesn't set `PIPELINE_DEMO`.

How the demo behaves:
- Everything stays **on that one device**: each phone gets its own private demo world, saved in
  the browser. An invite link opened on a *different* phone shows "This link isn't active".
- To see the invitee side, use **Fresh invite as a new visitor** in the demo box.
- Every email code is `123456`. The admin is `admin@demo.dev` (open `#/admin`).
- **Reset demo** wipes the device's demo data.
- The first visit downloads about 16 MB (the in-browser database), then it's cached.
- To test real multi-phone referrals, use the real deployment with Supabase.

The normal build never includes any of this: the demo backend is swapped for an empty stub, and
production `dist/` stays around 450 KB.

## Preview without Supabase

To click through the UI before connecting a real project, run a local demo. It uses a local
PostgreSQL and a simulated Supabase, and every email "receives" the code `123456`. Only one
port (5173) is used, so it works in GitHub Codespaces too.

In a Codespace or another Ubuntu/Debian machine, install Postgres once:

```bash
sudo apt-get update && sudo apt-get install -y postgresql
```

```bash
sudo service postgresql start
```

```bash
sudo su postgres -c "psql -c \"alter user postgres password 'postgres';\""
```

Use `sudo su postgres -c ...`, not `sudo -u postgres ...`. In Codespaces `sudo` needs no password
when running as root, but `sudo -u` asks for one you don't have. After a Codespace restart, run
`sudo service postgresql start` again before the demo.

Then run the demo:

```bash
npm install
```

```bash
PX_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/px npm run demo
```

Open http://localhost:5173 (in Codespaces, use the forwarded port 5173 in the Ports tab). Every
page shows a dashed demo box: **Fresh invite as a new visitor** signs you out and opens a brand-new
invitation link, so you can replay the flow as many times as you like; **Admin** opens the
dashboard (`admin@demo.dev`). Each start resets the `px` database.

## Testing

`npm run test:e2e` runs a full browser test on an iPhone viewport against the real SQL migration on
a local PostgreSQL. `test/mock-supabase.mjs` stands in for Supabase Auth and PostgREST's `/rpc`,
running each call with the same role switch and JWT claims that Supabase uses, so RLS and the
functions behave as they do in production.

It covers:

- **Upgrade path:** a participant and link created under migration `001` (email flow) still work
  after `002`, including a new participant joining their link and them signing in by email.
- **Email-free onboarding:** seed → generation 1 → 2 → 3 with no email field, on anonymous
  identities; the session survives reloads.
- **Reveals and Pipeline Community:** both reveals; the community screen right after the mission;
  signup with only future experiments, only updates, and both; the button disabled with neither;
  "Maybe later" storing nothing and never reappearing; joining later from the home card; changing
  and withdrawing consent (with timestamps kept); duplicate emails creating nothing and revealing
  nothing; admin-only stats and exports; nothing readable through the table API.
- **Email linking:** an email linked to the *same* identity, then sign-in on a second phone showing
  the same network.
- **Abuse protections:** self-referral by account and by browser, one participant per browser,
  link reuse, duplicate credit, invite limits, invalid values, guessed tokens, and per-IP rate
  limits on joins, opens and community sign-ups.
- **Privacy and admin:** branch privacy, RLS on every table, admin numbers, community CSVs, and data
  deletion (including the anonymous auth user).

It saves screenshots to `test-results/`.

`npm run test:mobile` checks the phone experience on the browser-only demo build, with no database
needed. On every text-entry screen, the field and its button must stay above a simulated iPhone
keyboard. On the landing page, typing must advance one letter at a time with the caret always
visible, even through a 300ms freeze. Screenshots go to `test-results/mobile/`.

It needs PostgreSQL 14+ and Playwright's Chromium:

```bash
PX_DATABASE_URL=postgres://postgres@127.0.0.1:5432/px npm run test:e2e
```

The test drops and recreates the `px` database at that URL.
