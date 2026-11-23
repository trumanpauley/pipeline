// Click-through preview with no Supabase project: a local Postgres plus the
// mock auth/RPC server. Every email "receives" the code 123456.
//   PX_DATABASE_URL=postgres://postgres@127.0.0.1:54329/px node test/demo.mjs
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createServer } from 'vite';
import { startMockSupabase } from './mock-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.PX_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/px';
const PORT = Number(process.env.PORT || 5173);

const admin = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
await admin.connect();
await admin.query('drop database if exists px with (force)');
await admin.query('create database px');
await admin.end();
for (const f of [
  'test/local-supabase-shim.sql',
  'supabase/migrations/001_experiment_schema.sql',
  'supabase/migrations/002_anonymous_onboarding.sql',
  'supabase/migrations/003_share_tracking.sql',
  'supabase/migrations/004_phone_ready.sql',
  'supabase/migrations/005_name_moderation.sql',
  'supabase/migrations/006_circular_strength.sql',
  'supabase/migrations/007_invited_names.sql',
  'supabase/migrations/008_live_invitation_tracking.sql',
  'supabase/migrations/009_pipeline_community.sql',
  'supabase/migrations/010_multi_experiment.sql',
  'supabase/migrations/011_early_access.sql',
  'supabase/migrations/012_connection_strength_abc.sql',
  'supabase/migrations/013_copy_safe_name_check.sql',
  'supabase/migrations/014_community_onboarding.sql',
  'supabase/migrations/015_optional_relationship_question.sql',
]) {
  execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -q -f ${path.join(root, f)}`);
}
const db = new pg.Client({ connectionString: DB });
await db.connect();
await db.query(`insert into admins (email) values ('admin@demo.dev')`);
// Every demo visitor shares one local IP, so relax the per-IP limits here only.
await db.query(`update experiment_settings set value = '{"joins_per_ip_hour": 10000, "opens_per_ip_hour": 100000,
  "waitlist_per_ip_hour": 10000, "invites_per_participant_hour": 100}' where key = 'rate_limits'`);
const seeds = (await db.query(
  `insert into invitations (token, sender_name, admin_note)
   select px_new_token(), 'Truman', 'demo' from generate_series(1, 5) returning token`)).rows;
await db.end();

await startMockSupabase({ port: 54321, connectionString: DB, fixedCode: '123456' });
// The browser talks only to the Vite port; Vite proxies auth/rest to the mock.
// (One forwarded port is enough in Codespaces or any remote dev box.)
process.env.VITE_SUPABASE_URL = '/';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'anon-key';
process.env.VITE_DEMO = '1';
process.env.VITE_PHONE_AUTH = '1'; // demo only: no SMS is sent, every code is 123456
const vite = await createServer({ root, server: {
    port: PORT,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: {
      '/auth/v1': 'http://localhost:54321',
      '/rest/v1': 'http://localhost:54321',
      '/__test': 'http://localhost:54321',
      '/realtime/v1': { target: 'ws://localhost:54321', ws: true },
    },
  },
});
await vite.listen();

console.log(`\nDemo running on http://localhost:${PORT}  (every email code is 123456)`);
console.log(`Admin:        /admin  (admin@demo.dev)`);
seeds.forEach((s) => console.log(`Seed invite:  /i/${s.token}`));
