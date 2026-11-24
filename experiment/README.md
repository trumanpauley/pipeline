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
| `/join/:token` | Invitation: landing → one-tap classification → "First L." name (+ category) + consent → in. Older `/i/:token` links still work. |
| `/`          | Participant home: the current experiment, reveals, invite slots, branch tree, privacy |
| `/admin`     | Admin dashboard: experiments (create, pause, seed links, per-experiment analytics and tree), metrics, CSV exports |

### Onboarding and accounts

Nobody types an email before the referral stage:

1. **Landing → one relationship question → first name + research consent.** On Continue, the app
   calls Supabase `signInAnonymously()`. That creates a real, unique auth user (no email, no
   password), and the participant, their answers and their links are tied to it.
2. **The session is kept in the browser,** so returning on the same phone needs no sign-in.
3. **At the end of the invitation experiment** (after the second invitation, or after "answer one
   question instead"), an optional early-access screen ("Be part of what's next.") asks for an
   email, with a separate, unticked box: *I'm interested in participating in future Pipeline
   experiments*. **Join Early Access** puts the email on the list; there's no password, code or
   account. **Not Now** stores nothing except that the screen was dismissed (on the server, so it
   never reappears), and participation is unaffected. An *Early access* card on the home screen and
   a row in *Your data* let people join later, change either choice, or unsubscribe. See
   [Early access](#early-access).
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
- **Two active links** per participant by default; each experiment sets its own number (*Invites per participant*). A revoked link, or one used by someone who
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
- **Experiments** (name, description, instruction, invites per participant, categories, pause):
  `/admin` → Experiments
- **Without redeploying:** Supabase → Table editor → `experiment_settings` (`reveals`, `unlock_on`,
  `methods` to enable or disable a method, `feedback_question`)
- **Adding or renaming a stored option value:** update both `METHODS` in `src/config/experiment.ts`
  and the `method_options` setting.
- **Schema changes:** add `supabase/migrations/003_*.sql`. Don't edit an applied migration.

## Setup

### 1. Supabase

Use a **new Supabase project** (free tier is fine). The existing Pipeline app's migration adds a
trigger that creates a `profiles` row for every new auth user, so sharing a project would add empty
Pipeline profiles for experiment participants. Table and function names don't collide, so sharing a
project still works if you have to.

1. **SQL Editor, new project:** paste all of `supabase/setup.sql` and click **Run**. It's every
   migration below in one file and one transaction, so it either installs completely or changes
   nothing. (Regenerate it with `sh scripts/build-setup-sql.sh` after adding a migration.)

   **SQL Editor, existing project:** paste and run, in order, `supabase/migrations/001_experiment_schema.sql`,
   `002_anonymous_onboarding.sql`, `003_share_tracking.sql`, `004_phone_ready.sql` and
   `005_name_moderation.sql`, `006_circular_strength.sql`, `007_invited_names.sql` and
   `008_live_invitation_tracking.sql`, `009_pipeline_community.sql` and
   `010_multi_experiment.sql`, `011_early_access.sql`, `012_connection_strength_abc.sql` and
   `013_copy_safe_name_check.sql`, `014_community_onboarding.sql` and
   `015_optional_relationship_question.sql`, `016_invitation_sharing.sql` and
   `017_waitlist_overview.sql` and `018_launch_updates.sql`. If you've already run some,
   run only the ones after them.
   (013 matters if you pasted 005 or `setup.sql` from a browser: that can drop invisible
   characters and break every name check with "invalid regular expression".)
2. **Make yourself an admin:**
   ```sql
   insert into public.admins (email) values ('you@example.com');
   ```
   **Sign in without emails (recommended):** in **Authentication → Users → Add user → Create new
   user**, enter the same email and a password and tick **Auto Confirm User**. On `/admin`, tap
   **Use a password instead**. No email is sent, so Supabase's email limit never gets in the way,
   and the browser stays signed in. The admin page has a tab per experiment (plus Overview), each
   showing that group's seed links, tree, numbers, ABC results and question preview.
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

#### Invitation links and Vercel Deployment Protection

Every deployment gets its own URL (`pipeline-experiment-<hash>-<team>.vercel.app`). By default
Vercel protects those deployment URLs with **Vercel Authentication**, so anyone without access to
your Vercel team is sent to a Vercel sign-in page. Only the production domain
(`pipeline-experiment.vercel.app`, or your custom domain) is public.

- **Links always use the production domain.** `scripts/vercel-build.sh` sets
  `VITE_PUBLIC_APP_URL` from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, so a link created from any
  deployment URL still points at the public address. To use a custom domain, set
  `VITE_PUBLIC_APP_URL` (e.g. `https://pipeline.example.com`, no trailing slash) in Vercel →
  Settings → Environment Variables, then redeploy.
- **Share and open the production domain,** not the URL of a single deployment.
- **Keep Deployment Protection off the production domain.** In Vercel → your project →
  Settings → Deployment Protection, *Vercel Authentication* should be set to **Standard
  Protection** (protects previews only) or turned off. *All Deployments* and *Password
  Protection* on production would put every invitation behind a sign-in.
- **No sign-in is needed to open an invitation.** The link opens straight to the landing page,
  and `open_invitation` runs for signed-out visitors. Unknown, used, revoked or damaged links show
  "This link isn't active." (or the matching message); they never show a sign-in screen.

### 4. Launch

1. Open `/admin` → **Experiments** → **New experiment** (or use *The Pipeline Experiment*, which
   holds everything created before experiments existed). See [Experiments](#experiments).
2. On the experiment's card → **Seed links & tree** → generate links. Set "Your name, as invitees
   see it" to your first name; invitees will be asked "How close are you to {name}?". Copy each
   link and send each person their own. Each link works once.
3. Watch the dashboard. The CSV exports cover participants, invitations, classifications,
   reciprocal pairs, feedback, the waitlist and the Pipeline Community (`community.csv`,
   `research_pool.csv`). Only participants (linked emails), waitlist and the community files
   contain email addresses.

## Experiments

Run several networking experiments side by side (for example *Harvard Baseball* and *Harvard
Students*) from the admin dashboard, without code changes. Migration `010` adds this; everything
created before it lives in the default experiment, *The Pipeline Experiment*, and works as before.

**Each experiment has** a name, a group description, an invitation instruction ("Invite two
Harvard Baseball players, current or alumni."), invitations per participant (default 2), optional
participant categories (e.g. *Current Student*, *Alumni*; leave empty to not ask) and a status
(active or paused). Participants see the name, description and instruction on their home screen
and the instruction again when they invite someone; categories are asked on the join screen.

**Links.** Seed links are made per experiment on its card (**Seed links & tree**), each a unique,
single-use, separately tracked link with its own Copy button. Referral links belong to the
sender's experiment. A link's experiment is stored with its token in Supabase when it's created and
can never change (a trigger blocks changing a token or its experiment, and deleting invitations),
so a link always opens the same experiment, whatever is deployed later. Links look like
`https://<VITE_PUBLIC_APP_URL>/join/TOKEN`; earlier `/i/TOKEN` and `#/i/TOKEN` links keep working.

**Pausing** stops new joins, answers and links: a paused experiment's links show "This experiment is
paused." and record nothing. People already in keep their home screen and data. Resume any time.

**People, not names.** A participant row is one person's membership in one experiment
(`unique (user_id, experiment_id)`):
- Someone already in one experiment who opens another experiment's link joins it with the same
  login. No second account is created, and their home screen gets a switcher.
- Within an experiment, a person is counted once. A further invitation to someone already in is
  recorded as an extra connection (`status = 'duplicate'`); the invitation they joined through is
  their **primary referral**, which places them in the tree.
- One browser holds one membership per experiment.
- Name similarity is never used to match people: two "Sarah M." are two participants.
- The full graph (primary and extra connections, across experiments) is in `connections.csv`.
  `person_key`, a salted hash of the login, links one person's memberships across experiments
  without exposing who they are.

**Names** are a first name and last initial ("James P."). Input is tidied on the server ("james
p" → "James P."), and a full surname is refused, so it's never stored. The same rule applies to the
names inviters type. Names from before this change are kept as they are. On the join screen,
"Enter your first name and last initial." types itself in above the field the first time it's
focused (about 1.2s, once, instant with reduced motion). A short note below explains how the name
is used, with a longer explanation on request.

**Analytics** (per experiment, from Supabase records):
- participants, people and links created (including seed links), opened and accepted;
- extra connections;
- median response time (first open → joined; link created → joined also shown);
- maximum depth and the category split;
- the referral tree.

Exports: `experiments.csv`, `connections.csv`, and experiment, category and `person_key` columns
in `participants.csv` and `invitations.csv`.

**Security.** All experiment admin functions check the admin on the server
(`px_require_admin`). The `experiments` table and `connections` view aren't readable by
participants or anonymous visitors. Participants only ever receive their own experiment's public
details (name, description, instruction, categories).

## Community onboarding (per experiment)

Migration `014`. Each experiment's join screen can speak to its own community. Set this up in the
admin experiment form under **Join screen**:
- **Welcome message:** no longer shown (the join screen goes straight to its questions); the
  stored text is kept for later use.
- **Eligibility question (optional):** e.g. "Have you played for Harvard Baseball?". You choose
  the answer that continues, the answer that stops, and the message shown for "No".
- **Participant types:** e.g. "Current player, Former player / alumnus".

Experiments without these settings keep their current join screen.

On the join screen, the eligibility question comes first, with nothing pre-selected:
- **No:** shows the message, with no way to continue.
- **Yes:** shows the participant types, then the name and consent.

The server re-checks eligibility: a new participant in a screening experiment can't join (and so
can't create links) without the eligible answer. Only these display settings go into the public
invitation data. Participant types map to the ABC scenario groups (anything with "alum" →
alumni; "current" or "student" → student).

The admin **Participant experience simulator** runs the real screens for the chosen group,
without saving anything: landing, relationship question, connection strength and comfort, the
join screen (eligibility, types, name, consent), and the ABC questions when the chosen
generation qualifies.

**Skipping "Where do you know them from?"** (migration `015`). In a community where everyone
knows each other the same way (one team, one chapter), untick **Ask "Where do you know them
from?"** under **Join screen**. Then:
- invitees go from the landing screen straight to connection strength and comfort;
- inviters get their link right after typing the name.

No answer is stored for the skipped question (not a placeholder), and the server still requires
one in experiments that ask it. Answers given earlier are kept. Migration 015 switches it off for
Harvard Baseball and PSK.

## Invitation settings: link names, link previews, messages

Migration `016`, plus the Vercel functions in `api/`. Each experiment can look like its own
initiative when its links are shared. Edit an experiment in the admin dashboard; the
**Invitation settings** section has:
- **Experiment title:** the link-preview title, e.g. "Harvard Baseball Network Experiment".
- **URL slug:** e.g. `harvard-baseball`.
  - Invitation links become `/harvard-baseball/TOKEN`, and `/harvard-baseball` is the experiment's
    public page ("invitation only").
  - The token still identifies the one invitation and its sender, so referral attribution and
    trees are unchanged.
  - `/join/TOKEN` links (every link already sent) keep working.
  - Slugs are 3–40 lowercase letters, numbers and single hyphens, and unique. App routes (`admin`,
    `join`, `api`, …) are refused.
- **Link preview description** and **link preview image.** Uploads are cropped to 1200×630 JPEG
  and stored in the public `experiment-previews` bucket; only admins can upload. Without an
  image, a title card is generated (`/api/og`).
- **Initial invitation message:** sent with seed links. Each seed row has **Share message**.
- **Participant forwarding message:** sent with participants' own links. The invite sheet shows
  it; **Share invitation** opens the phone's share sheet (Web Share API), and **Copy message**
  copies the message and link elsewhere. Nothing is sent automatically.
- **Officially authorized:** until this is ticked, the server refuses wording that suggests
  official sponsorship or endorsement ("official", "sponsored by", "on behalf of", "approved
  by", …).

A live preview next to the fields shows an iMessage-style message, the link card and the full
shared text, for both messages, as you type.

**How link previews work.** iMessage, WhatsApp and other apps build previews from the page's
HTML without running JavaScript. `vercel.json` sends `/join/TOKEN`, `/i/TOKEN`, `/SLUG/TOKEN` and
`/SLUG` to `api/page.js`, which returns the app's `index.html` with that experiment's Open Graph
and Twitter Card tags written in (title, description, image, `summary_large_image`). The app then
loads as usual.
- The function reads the public `experiment_share_meta` function with the publishable key, so it
  only gets display settings, never a sender or participant.
- Experiments without settings, and unknown links, get the generic preview.
- It uses the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` environment variables
  as the build; Vercel functions read them at run time, so no new variables are needed.

**Testing a preview after deploying:**
1. Open `https://YOUR-DOMAIN/harvard-baseball` and view the page source: the `og:` tags are
   there.
2. Paste a link into a message to yourself, or use a preview checker (e.g. opengraph.xyz, the
   LinkedIn Post Inspector, Facebook's Sharing Debugger).
3. Apps cache previews per link, so test with a new invitation link after changing settings.
   Generated images change address whenever the settings are saved.

Preview deployments behind Vercel's Deployment Protection can't be read by crawlers; test on
production.

## Connection strength and the ABC experiment

Migration `012`. It changes no existing records.

**Connection strength (every invitee).** After their assigned relationship question, the invitee
rates the person who invited them on a five-bar meter, "How close are you to {name}?":
1 Barely know them · 2 Acquaintance · 3 Know them fairly well · 4 Good friend · 5 Very close
friend. They then answer the 1–5 comfort question ("How comfortable would you feel asking {name}
for an introduction?"), unless that was already their assigned question.
- Ratings go in `relationship_ratings`, one row per invitation and direction (rater → ratee). Only
  the invitee's rating (`inbound`) is collected now, but the inviter's rating of the same
  relationship can be added later without schema changes.
- The view `relationship_strength` adds the comfort answer from either place.
- The 5-point meter supersedes method A (3-point "How close are you to…?"), so A is out of the
  rotation for new links and nobody is asked the same thing twice. Existing A answers are kept. To
  bring it back: `update experiment_settings set value = value || '["strength"]' where key = 'methods';`

**Groups.** Participants pick *Current Harvard student* or *Harvard alumnus/alumna* on the join
screen (the original experiment now asks this too; new experiments start with these two
categories). The group is stored in `participants.classification`. Each experiment's
`abc_scenarios` lists its groups and their scenario text (`{name}` = Jane/John), so other
communities can have their own later.

**ABC experiment (generation 3 and deeper).** Generation 1 joined from a seed link, and
generation 2 are their invitees. In "depth" terms, counting seed participants as 0, it starts at
depth 2. The threshold is set per experiment in `abc_min_depth`, and `abc_enabled` turns it off.
- **When:** right after joining, a centred dialog shows the scenario: students see "Imagine
  {Jane/John} is an incoming Harvard student looking for advice on which classes to take.",
  alumni see "…a Harvard junior looking for advice about internship opportunities."
- **Questions:** two 1–5 questions follow, cold ("…if {name} sent you a message asking for
  advice?"; no platform named, since people answer texts and email more readily than LinkedIn) and warm ("…if {inviter} personally introduced {name} to you?").
- **Random assignment:** Jane/John and the question order are drawn at random once and stored, so
  they stay the same if the person comes back.
- **Resuming and locking:** answers are saved one at a time, so "Not now" or a refresh resumes at
  the unanswered question. They're locked once both are in, and each participant has one row.
- **Missing group:** people who joined before groups were asked are asked first.
- **Invitations are unaffected** whether or not someone answers.

**Admin.**
- The *ABC experiment* panel shows:
  - eligible, completed and completion rate, with results by experiment;
  - average cold, warm and introduction advantage (warm − cold), with distributions;
  - connection-strength distribution, advantage by strength, and strength vs comfort;
  - students vs alumni and results by generation;
  - checks for order and name effects.
- It filters by experiment and group, with anonymised `abc.csv` and `relationships.csv` exports.
- These are self-reported answers, so differences are associations, not causes.
- *Preview participant questions* runs the meter, comfort question and ABC flow for any group,
  name, order and generation, without saving anything.
- **Mark as test** on an experiment lets you rehearse the real flow end to end on a phone; its
  data stays out of the ABC analytics unless you pick it in the filter.

**Phone layout.** Question dialogs are now centred cards over the blurred page, with the heading in
the upper third. They're sized to the visible screen (safe areas, browser bars, keyboard), so
options never sit under the toolbar. Full-page questions use the same placement.

## Invitation landing background

The "{Name} invited you." page has a slow, sparse network drawn on a full-screen canvas behind
the text (`src/components/NetworkBackground.tsx`). It uses no library: plain Canvas with
`requestAnimationFrame`, about 4 KB.
- About 20–35 nodes on phones, a few blue accents and thin, gently curved lines.
- It fades behind the centred text, with a soft dark gradient for contrast.
- It pauses when the page is hidden, caps the pixel ratio and draws a still frame with reduced
  motion. It falls back to a static picture without Canvas and never takes taps.

Every visual setting (density, speed, opacities, colours, centre fade, glow) is in the
`NETWORK` object at the top of that file.

## Launch updates (migration 018)

Additive and safe to run more than once; nothing is dropped and existing links, participants and
data are untouched. Run `supabase/migrations/018_launch_updates.sql` in the Supabase SQL editor.

- **Community branding.** Per experiment (admin → the group's tab → edit): *Community name*,
  *Introductory message* (`welcome_message`), *Completion thank-you message*, plus the title, link
  preview and share messages that already existed. An experiment with a community name opens with
  the community first (“{Name} invited you to” / the title / “How connected are we?” / the intro),
  discloses Pipeline (“An independent networking experiment by Pipeline.”) and says what is recorded
  and how it may be used before anyone submits. Experiments without a community name look exactly as
  before. Nothing implies sponsorship by a university or team.
- **Settings.** *Allow additional invitations*, *Enable optional feedback*, *Enable optional
  waitlist signup* (all per experiment). ABC questions keep their existing switch. Only the new
  columns are touched; other experiments aren't changed.
- **Referral kinds** (`invitations.kind`): `seed_personal`, `seed_broadcast`, `standard`,
  `additional`. Existing links were backfilled. A *broadcast* seed stores no inviter name, so it
  never implies a personal relationship and no strength is recorded. Labels (e.g. “Founder 1 —
  Current players”) are admin-only.
- **Additional invitations.** After completing, “Invite someone else” makes one individual link at
  a time (name + the 0–100 “how well do you know them” slider + the normal sharing message). They
  are stored apart from the standardised data (the answer goes on `invitations.sender_strength`, not
  `classifications`), never change completion, and are capped per participant (`max_additional_invites`,
  default 60) and rate-limited.
- **Feedback.** “Help us improve” → `experiment_feedback`. Not linked to participant, invitation or
  rating; stores only the text, the experiment, the *week* sent, an optional contact email (only with
  explicit consent), and a review status. Not readable through the API. Giving an email never
  subscribes anyone to Pipeline updates. It can't be erased with “Delete my data” (there is nothing
  to match it to). Rate limiting uses a salted hash of the network address, deleted within two days.
- **Admin.** *Launch analytics* (overview tiles, per-kind funnel, additional-invite stats, depth,
  timing, overlap; every rate shows its denominator), a *Feedback* tab (filter, mark reviewed,
  anonymous vs contact offered), a *Waitlist* tab (source, date, experiment, consent), seed type and
  label when creating links, and referral-tree filters (seed, type, group, strength, depth).
- **Duplicate participants.** A second invitation to an existing participant is recorded as a
  `duplicate` against the same person (the first referral stays primary; its relationship answer is
  kept) and shows in the overlap numbers. People are never merged by name.
- **Logo.** `public/logo.svg` / `logo-mark.svg` / `favicon.svg` are the same files as `landing/`.

## Early access

Optional email signup at the end of the invitation experiment (migrations `009` and `011`; the
table is still called `community_signups`). **Join Early Access** records the early-access consent
(`updates`); the checkbox records consent to be contacted about future experiments
(`research_invites`). Each signup also stores the participant and the experiment they were in
(`experiment_id`, e.g. Harvard Baseball).

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
- **Admin.** The dashboard's *Early access* panel shows:
  - total signups and the percentage of participants who signed up;
  - how many are interested in future experiments;
  - the share of people who reached the end;
  - "Not now" choices and unsubscribes;
  - signups by experiment.

  It has two admin-only CSVs:
  - `research_pool.csv`: only people with an active *future experiments* consent (participant
    id, email, experiment, generation). It contains no relationship data and is the list to use
    when recruiting for the next experiment.
  - `community.csv`: every signup, with its experiment, both consents and all timestamps.

### Completion screen and the Pipeline site

When a participant finishes (after the second invitation, or after answering one question instead),
a minimal **Experiment complete** screen explains that nothing more is required, with a prominent
**Explore Pipeline** button to the public site and an optional early-access email. Joining is never
required, is never pre-ticked, and someone already on the list isn't asked again.

- The link is `https://pipeline-networking.com/?source=experiment`. Only that non-identifying tag is
  sent: no names, link tokens, ratings or experiment ids are ever in the URL. Set `VITE_LANDING_URL`
  (no trailing slash) in Vercel to point somewhere else.
- Signing up here still goes through `join_community`, so consent text, timestamp and experiment are
  recorded by the server. Experiment participants are never added to the marketing list automatically.
- **One waitlist view.** Migration `017` adds the admin-only `admin_waitlist_overview()`, which
  combines `landing_waitlist` (the website) and `community_signups` (this experiment), de-duplicated
  by email; the admin page shows it under *Waitlist* (total, sources, last 7 days, recent). It is
  additive and safe to run more than once; until it's run the panel says so and everything else
  works. Waitlist records are not readable through the public API.

## Try it on a phone (no Supabase, no Codespace)

`npm run build:demo` produces a static site in `dist-demo/` with the whole backend running inside
the page. It uses the real schema and both migrations in PGlite, which is Postgres compiled to
WebAssembly. Host it anywhere and open it on a phone.

**Easiest: a free Vercel project for the demo**
1. In Vercel, **Add New → Project**, import this repo, and set **Root Directory** to `experiment`.
2. Under **Environment Variables**, add `PIPELINE_DEMO` = `1`. No Supabase variables are needed.
3. Deploy, then open the production `*.vercel.app` URL on your phone (see
   [Invitation links and Vercel Deployment Protection](#invitation-links-and-vercel-deployment-protection)).

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
- **Reveals and early access:**
  - both reveals, and the early-access screen after the second invitation and after the skip
    question;
  - joining with and without the future-experiments box;
  - "Not Now" storing nothing and never reappearing, and joining later from the home card;
  - adding, changing and withdrawing consent, with timestamps kept;
  - duplicate emails creating nothing and revealing nothing;
  - signups stored and counted per experiment, and admin-only stats and exports;
  - nothing readable through the table API.
- **Email linking:** an email linked to the *same* identity, then sign-in on a second phone showing
  the same network.
- **Abuse protections:** self-referral by account and by browser, one participant per browser,
  link reuse, duplicate credit, invite limits, invalid values, guessed tokens, and per-IP rate
  limits on joins, opens and community sign-ups.
- **Privacy and admin:** branch privacy, RLS on every table, admin numbers, community CSVs, and data
  deletion (including the anonymous auth user).
- **Names:** "First L." only. The instruction types once on first focus, typing still works while
  it animates, and the field doesn't move. The disclosure and longer explanation are checked. A
  first name alone or a full surname is refused, and nothing is saved.
- **Connection strength and ABC:**
  - the meter (tap, slide, keyboard and screen-reader text) and the comfort question;
  - ratings stored per relationship and direction, and linked when the invitee joins;
  - generation 3 gets the scenario, with the group asked first if missing;
  - random Jane/John and order kept on resume, resuming half-way, answers locked once complete,
    invalid values refused;
  - admin stats and filters, test experiments left out, the anonymised CSV, and the preview
    saving nothing.
- **Multiple experiments:** the admin creates an experiment in the dashboard and makes per-experiment
  seed links (unique, `/join/TOKEN`, copied one at a time). The test then follows seed →
  generation 1 → generation 2 with categories, and checks:
  - a second invitation to someone already in becomes an extra connection, not a second participant;
  - two people with the same name stay separate;
  - an existing account joins a second experiment without a new account, and the switcher works;
  - pausing records nothing and keeps data, and resuming makes the link work again;
  - links can't change experiment, token, or be deleted;
  - per-experiment analytics, tree and exports are correct, and admin access is enforced;
  - erasure covers every experiment.

It saves screenshots to `test-results/`.

`npm run test:mobile` checks the phone experience on the browser-only demo build, with no database
needed. On every text-entry screen, the field and its button must stay above a simulated iPhone
keyboard. On the landing page, typing must advance one letter at a time with the caret always
visible, even through a 300ms freeze. The landing caret must sit right after the last typed letter, be gone once typing ends,
and not be left behind if the browser pauses the page. Nothing may overlap or be cut off at
320×568. The name instruction must type in about 1–1.5s, never block typing, not restart on
refocus, and appear at once with reduced motion. Screenshots go to `test-results/mobile/`.

It needs PostgreSQL 14+ and Playwright's Chromium:

```bash
PX_DATABASE_URL=postgres://postgres@127.0.0.1:5432/px npm run test:e2e
```

The test drops and recreates the `px` database at that URL.
