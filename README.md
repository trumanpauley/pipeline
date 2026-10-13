# Pipeline

A lightweight networking-platform prototype for exploring how resume details can become an editable professional profile.

## Run locally

Open `index.html` in a browser, or start a local static server from this folder:

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Supabase setup

Pipeline uses the browser-safe Supabase publishable/anon key. Never put a Supabase
service-role key in this repository or in browser code.

1. Create a project at [supabase.com](https://supabase.com).
2. In the Supabase SQL Editor, run:
   - [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
   - [`supabase/migrations/002_onboarding_and_groups.sql`](supabase/migrations/002_onboarding_and_groups.sql)
3. In Authentication → Providers, enable Email.
4. In Authentication → URL Configuration, set the Site URL to the hosted Pipeline
   URL. For local development, add `http://localhost:4173` to Additional Redirect URLs.
5. Copy `supabase-config.example.js` to `supabase-config.js`.
6. From Project Settings → API, copy the Project URL and public publishable/anon
   key into `supabase-config.js`.
7. Start the static server and open `http://localhost:4173`.

The migration creates the `profile-photos` private Storage bucket and owner-scoped
policies. Row Level Security is enabled on every application table. The
`public_profiles` view exposes only fields intended for public discovery; private
matching data and unapproved resume entries are not available through that view.
Migration `002_onboarding_and_groups.sql` seeds canonical campus groups and adds onboarding support.

## User experiences

Pipeline Beta 1.1 supports two distinct operating modes:

1. **Real User Accounts**: Registered and authenticated Supabase users begin with a blank profile, 0 groups, 0 follows, 0 acquaintances, and 0 fake connections. First-time users are guided through a multi-step profile onboarding flow. Real profiles and group memberships persist to Supabase with helpful empty states instead of fictional connections.
2. **Demo Experience**: Available without signing up via "Explore Demo Profile" on the welcome screen. Explores the fictional John Harvard demonstration network with sample connections, groups, and Grid visualization. Clearly labeled with a persistent demo banner and an easy exit option to return to the login screen. Changes made in demo mode are local and isolated from real accounts.

## Prototype interactions

- Upload a PDF, DOCX, or TXT resume and review structured sections and entries before using the details on your profile.
- Edit, approve, reject, or add profile details. Review state is saved in browser local storage.
- Send and withdraw suggested connection requests, save roles, search suggested people, and explore the dashboard.
- Browse the Opportunities tab: search, filter by location, type, and industry, sort, bookmark, view details, and post jobs or group collaborations (saved in local storage). The "Your Network" sections and "Explore Connections" links use sample Grid data and are labeled as unverified prototype data; "I'm Interested" is stored only in your browser.

Resume extraction happens in the browser. PDF.js preserves positioned text, font size, and font-weight signals; JSZip reads DOCX paragraph, run, style, spacing, indentation, and table structure. The parser stores normalized section and entry JSON separately from the review UI, while retaining source lines and uncertain text for confirmation. Scanned image-only PDFs still need OCR, and unusual layouts may require manual review. Uploaded files are processed locally and are not sent to a server.
