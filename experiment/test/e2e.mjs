// End-to-end test: admin creates seed links → seed participant joins → two
// further referral generations, plus the abuse cases (self-invite, reuse,
// duplicate credit, limits), the feedback path, RLS, exports and deletion.
//
// Requires a local PostgreSQL (see README → Testing). Usage:
//   PX_DATABASE_URL=postgres://postgres@127.0.0.1:54329/px node test/e2e.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { startMockSupabase } from './mock-supabase.mjs';

// Use the project's Playwright if installed, else a globally installed one.
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.PX_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/px';
const ADMIN_DB = DB.replace(/\/[^/]+$/, '/postgres');
const API_PORT = 54321;
const APP_PORT = 5199;
const APP = `http://localhost:${APP_PORT}`;
const API = `http://localhost:${API_PORT}`;
const SHOTS = path.join(root, 'test-results');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const ok = (cond, msg) => {
  if (!cond) throw new Error(`✗ ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
};
const step = (s) => console.log(`\n▸ ${s}`);

// ---------- fresh database ----------
step('Reset database and apply migration');
{
  const admin = new pg.Client({ connectionString: ADMIN_DB });
  await admin.connect();
  await admin.query('drop database if exists px with (force)');
  await admin.query('create database px');
  await admin.end();
  const psql = (f) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -q -f ${f}`, { stdio: 'pipe' });
  psql(path.join(root, 'test/local-supabase-shim.sql'));
  psql(path.join(root, 'supabase/migrations/001_experiment_schema.sql'));
  ok(true, 'migration applied to a fresh database');
}
const db = new pg.Pool({ connectionString: DB });
const q = async (sql, args) => (await db.query(sql, args)).rows;
await q(`insert into public.admins (email) values ('admin@test.dev')`);

// ---------- servers ----------
const mock = await startMockSupabase({ port: API_PORT, connectionString: DB });
process.env.VITE_SUPABASE_URL = API;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'anon-key';
const vite = await createServer({ root, server: { port: APP_PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch();
const iphone = devices['iPhone 13'];
const contexts = [];
const newPhone = async () => {
  const c = await browser.newContext({ ...iphone, permissions: ['clipboard-read', 'clipboard-write'] });
  // Force the copy fallback path (navigator.share is unavailable in headless).
  contexts.push(c);
  const page = await c.newPage();
  page.on('pageerror', (e) => console.error('    [pageerror]', e.message));
  return page;
};
const getCode = async (email) => {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${API}/__test/code?email=${encodeURIComponent(email)}`)).json();
    if (r?.code) return r.code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no code for ${email}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const participant = async (email) => (await q(`select * from participants where email = $1`, [email]))[0];

/** Full new-participant journey through an invitation link. */
async function joinViaLink(page, link, { name, email, useMagicLink = false, shots = false }) {
  const t0 = Date.now();
  await page.goto(link);
  await page.getByRole('heading', { name: "You're connected." }).waitFor();
  if (shots) await page.waitForTimeout(1600), await shot(page, `01-landing-${name}`);
  await page.getByRole('button', { name: 'Enter the Experiment' }).click();
  await page.locator('.classifier').waitFor();
  const method = await page.locator('.classifier').getAttribute('data-method');
  if (shots) await page.waitForTimeout(600), await shot(page, `02-classify-${method}`);
  await page.locator('.classifier .option, .classifier .scale-dot').first().click();
  await page.getByPlaceholder('First name').fill(name);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByText('I agree to take part in this research.').click();
  if (shots) await shot(page, `03-join-${name}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Enter the code' }).waitFor();
  if (useMagicLink) {
    // Simulate tapping the email link in a *different* browser (no localStorage).
    const { url } = await (await fetch(`${API}/__test/magic-link?email=${encodeURIComponent(email)}`)).json();
    const other = await newPhone();
    await other.goto(url);
    await other.locator('.home').waitFor();
    return { page: other, method, seconds: (Date.now() - t0) / 1000 };
  }
  await page.getByLabel('Verification code').fill(await getCode(email));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.locator('.home').waitFor();
  return { page, method, seconds: (Date.now() - t0) / 1000 };
}

/** Create an invitation from the home screen; returns the link. */
async function invite(page, label, { shots = false } = {}) {
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  await page.getByLabel('Who are you inviting').fill(label);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.sheet .classifier').waitFor();
  if (shots) await page.waitForTimeout(500), await shot(page, `05-invite-classify`);
  await page.locator('.sheet .classifier .option, .sheet .classifier .scale-dot').last().click();
  await page.getByRole('heading', { name: 'Your link is ready.' }).waitFor();
  if (shots) await shot(page, `06-link-ready`);
  const link = 'http://' + (await page.locator('.sheet .url').innerText());
  await page.getByRole('button', { name: 'Done' }).click();
  return link;
}

try {
  // ---------- admin seeds ----------
  step('Admin signs in and generates seed invitations');
  const adminPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await adminPage.goto(`${APP}/admin`);
  await adminPage.getByLabel('Email').fill('admin@test.dev');
  await adminPage.getByRole('button', { name: 'Email me a code' }).click();
  await adminPage.getByLabel('Verification code').fill(await getCode('admin@test.dev'));
  await adminPage.getByRole('button', { name: 'Verify' }).click();
  await adminPage.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await adminPage.getByLabel('Number of links').fill('3');
  await adminPage.getByLabel('Sender name').fill('Truman');
  await adminPage.getByLabel('Note').fill('pilot');
  await adminPage.getByRole('button', { name: 'Generate' }).click();
  await adminPage.getByText('/i/').first().waitFor();
  const seeds = await q(`select token from invitations where sender_id is null order by created_at`);
  ok(seeds.length === 3, 'three seed links created');
  ok(seeds.every((s) => /^[A-Za-z0-9_-]{22}$/.test(s.token)), 'tokens are 22-char base64url (122 random bits)');

  // ---------- generation 1 ----------
  step('Generation 1: Alice opens a seed link and joins (email code)');
  const a = await joinViaLink(await newPhone(), `${APP}/i/${seeds[0].token}`, {
    name: 'Alice', email: 'alice@test.dev', shots: true,
  });
  const alicePage = a.page;
  await alicePage.waitForTimeout(800);
  await shot(alicePage, '04-home-empty');
  ok((await alicePage.locator('.display').innerText()).includes('Two invitations'), 'home shows locked state');
  const alice = await participant('alice@test.dev');
  ok(alice && alice.depth === 1 && alice.parent_id === null, 'Alice is generation 1 with no parent');
  ok(alice.method === a.method, `Alice's method persisted (${alice.method})`);
  ok(alice.research_consent_at && alice.marketing_consent === false, 'research consent stored, marketing off');
  const inbound = await q(`select c.* from classifications c join invitations i on i.id = c.invitation_id where i.token = $1`, [seeds[0].token]);
  ok(inbound.length === 1 && inbound[0].direction === 'inbound' && inbound[0].rater_id === alice.id, 'inbound answer recorded and linked to Alice');
  ok(inbound[0].response_ms > 0, `response time captured (${inbound[0].response_ms}ms)`);
  console.log(`    journey time (automated): ${a.seconds.toFixed(1)}s`);

  step('Alice invites Bob → first reveal');
  const bobLink = await invite(alicePage, 'Bob', { shots: true });
  await alicePage.locator('.reveal-overlay').waitFor();
  await alicePage.waitForTimeout(1800);
  await shot(alicePage, '07-reveal-1');
  ok((await alicePage.locator('.reveal-title').innerText()).includes('part of Pipeline'), 'reveal 1: company name');
  await alicePage.getByRole('button', { name: 'Continue' }).click();
  ok((await participant('alice@test.dev')).reveal_level === 1, 'reveal level 1 stored');

  step('Alice invites Carol → second reveal');
  const carolLink = await invite(alicePage, 'Carol');
  await alicePage.locator('.reveal-overlay').waitFor();
  await alicePage.waitForTimeout(2200);
  await shot(alicePage, '08-reveal-2');
  ok((await alicePage.locator('.reveal-title').innerText()).includes('better way to navigate'), 'reveal 2: mission');
  await alicePage.getByRole('button', { name: 'Continue' }).click();
  await alicePage.waitForTimeout(600);
  await shot(alicePage, '09-home-two-links');
  ok(await alicePage.getByRole('button', { name: 'Invite someone' }).count() === 0, 'both slots used');
  ok((await alicePage.locator('.pill').allInnerTexts()).every((t) => t.includes('Link ready')), 'links show "Link ready" (not opened)');
  const out = await q(`select * from classifications where rater_id = $1 and direction = 'outbound'`, [alice.id]);
  ok(out.length === 2 && out.every((c) => c.method === alice.method), 'outbound classifications stored with her method');

  step('Abuse cases');
  await alicePage.goto(carolLink);
  await alicePage.getByRole('heading', { name: 'This is your invitation.' }).waitFor();
  ok(true, 'opening your own link is detected');
  const aliceJwt = await alicePage.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
    return JSON.parse(localStorage.getItem(k)).access_token;
  });
  const rpcAs = async (jwt, fn, args = {}) => {
    const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify(args),
    });
    return { status: r.status, body: await r.json() };
  };
  const carolToken = carolLink.split('/i/')[1];
  let r = await rpcAs(aliceJwt, 'accept_invitation', { p_token: carolToken, p_display_name: 'A', p_research_consent: true, p_marketing_consent: false });
  ok(r.body.message === 'self_invite', 'self-invite rejected by the server');
  const okValue = { strength: 'weak', context: 'other', comfort: '3' }[alice.method];
  r = await rpcAs(aliceJwt, 'create_invitation', { p_value: okValue });
  ok(r.body.message === 'invite_limit', 'third active invitation rejected');
  r = await rpcAs(aliceJwt, 'create_invitation', { p_value: 'definitely-not-valid' });
  ok(r.body.message === 'invalid_value', 'invalid classification value rejected');
  r = await rpcAs(null, 'get_my_state');
  ok(r.status >= 400, 'anonymous caller cannot read participant state');
  r = await rpcAs(null, 'admin_overview');
  ok(r.status >= 400, 'anonymous caller cannot read admin data');
  r = await rpcAs(aliceJwt, 'admin_overview');
  ok(r.body.message === 'forbidden', 'participants cannot read admin data');
  r = await rpcAs(null, 'open_invitation', { p_token: 'AAAAAAAAAAAAAAAAAAAAAA' });
  ok(r.body.state === 'invalid', 'guessed token is invalid');

  // ---------- generation 2 ----------
  step('Generation 2: Bob joins via Alice\'s link (magic link opened in another browser)');
  const b = await joinViaLink(await newPhone(), bobLink, { name: 'Bob', email: 'bob@test.dev', useMagicLink: true });
  const bobPage = b.page;
  const bob = await participant('bob@test.dev');
  ok(bob && bob.depth === 2 && bob.parent_id === alice.id, 'Bob is generation 2, child of Alice');
  ok(bob.display_name === 'Bob', 'name carried across browsers via auth metadata');
  const bobInv = (await q(`select * from invitations where token = $1`, [bobLink.split('/i/')[1]]))[0];
  ok(bobInv.status === 'accepted' && bobInv.accepted_by === bob.id, 'Alice→Bob invitation accepted');

  step('Opened vs accepted are distinguished');
  const carolAnon = await newPhone();
  await carolAnon.goto(carolLink);
  await carolAnon.getByRole('button', { name: 'Enter the Experiment' }).waitFor();
  await alicePage.goto(APP);
  await alicePage.locator('.slot-accepted').waitFor();
  const pills = await alicePage.locator('.pill').allInnerTexts();
  ok(pills.some((t) => t.includes('Joined')) && pills.some((t) => t.includes('Opened')), `Alice sees ${pills.join(' / ')}`);

  step('Duplicate credit: Bob (already in) opens Carol\'s link');
  await bobPage.goto(carolLink);
  await bobPage.getByRole('button', { name: 'Enter the Experiment' }).click();
  await bobPage.locator('.classifier .option, .classifier .scale-dot').first().click();
  await bobPage.locator('.home').waitFor();
  await bobPage.getByText('already part of the experiment').waitFor();
  const carolInv = (await q(`select * from invitations where token = $1`, [carolToken]))[0];
  ok(carolInv.status === 'duplicate', 'invitation marked duplicate, not accepted');
  ok((await participant('bob@test.dev')).parent_id === alice.id, 'Bob is not re-parented (no loop / no double credit)');
  await alicePage.reload();
  await alicePage.locator('.slots').waitFor();
  ok(await alicePage.getByRole('button', { name: 'Invite someone' }).count() === 1, 'Alice gets her slot back');

  step('Bob invites Dave');
  const daveLink = await invite(bobPage, 'Dave');
  await bobPage.locator('.reveal-overlay').waitFor();
  await bobPage.getByRole('button', { name: 'Continue' }).click({ timeout: 8000 });

  // ---------- generation 3 ----------
  step('Generation 3: Dave joins via Bob\'s link');
  const d = await joinViaLink(await newPhone(), daveLink, { name: 'Dave', email: 'dave@test.dev' });
  const davePage = d.page;
  const dave = await participant('dave@test.dev');
  ok(dave && dave.depth === 3 && dave.parent_id === bob.id, 'Dave is generation 3, child of Bob');
  const reused = await newPhone();
  await reused.goto(daveLink);
  await reused.getByRole('heading', { name: 'This invitation has already been used.' }).waitFor();
  ok(true, 'an accepted link cannot be reused');

  step('Dave unlocks reveals through the feedback question instead');
  await davePage.getByText('Answer one question instead').click();
  await davePage.getByLabel('Your answer').fill('Not wanting to impose on people.');
  await davePage.getByRole('button', { name: 'Submit and reveal' }).click();
  await davePage.locator('.reveal-overlay').waitFor();
  await davePage.waitForTimeout(1500);
  await davePage.getByRole('button', { name: 'Continue' }).click();
  await davePage.waitForTimeout(1500);
  await davePage.getByRole('button', { name: 'Continue' }).click();
  const daveNow = await participant('dave@test.dev');
  ok(daveNow.reveal_level === 2 && daveNow.revealed_via === 'feedback', 'both reveals unlocked via feedback');

  step('Branch visualization shows only permitted data');
  await alicePage.reload();
  await alicePage.locator('.tree svg').waitFor();
  await alicePage.waitForTimeout(1200);
  await shot(alicePage, '10-home-branch');
  const aliceState = await rpcAs(aliceJwt, 'get_my_state');
  const branch = aliceState.body.branch;
  ok(branch.length === 3, 'Alice\'s branch has 3 nodes (Alice, Bob, Dave)');
  const flat = JSON.stringify(aliceState.body);
  ok(!flat.includes('dave@test.dev') && !flat.includes('Dave') && !flat.includes(bob.id), 'no emails, names, or ids of descendants leak');
  ok(!/close_friend|acquaintance|"weak"|"class"|"social"/.test(JSON.stringify(branch)), 'no relationship classifications in branch data');
  ok(branch.find((n) => n.g === 1)?.label === 'Bob', 'Alice sees her own private nickname for Bob');

  step('RLS: direct table access');
  const rls = async (role, sub, sql) => {
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query(`set local role ${role}`);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
      return (await c.query(sql)).rows;
    } catch (e) {
      return { error: e.message };
    } finally {
      await c.query('rollback');
      c.release();
    }
  };
  ok((await rls('anon', null, 'select * from participants')).error, 'anon cannot select participants');
  ok((await rls('anon', null, 'select * from invitations')).error, 'anon cannot select invitations');
  const own = await rls('authenticated', bob.user_id, 'select id from participants');
  ok(own.length === 1 && own[0].id === bob.id, 'participant sees only their own row');
  const cls = await rls('authenticated', bob.user_id, 'select * from classifications');
  ok(cls.every((c) => c.rater_id === bob.id), 'participant sees only their own classifications');
  ok((await rls('authenticated', bob.user_id, `update participants set reveal_level = 2`)).error, 'participants cannot write tables directly');
  ok((await rls('authenticated', bob.user_id, `insert into admins values ('x@y.z')`)).error, 'participants cannot make themselves admin');

  step('Admin dashboard');
  await adminPage.getByRole('button', { name: 'Refresh' }).click();
  await adminPage.waitForTimeout(1500);
  await adminPage.screenshot({ path: path.join(SHOTS, '11-admin.png'), fullPage: true });
  const ov = (await rpcAs(await adminPage.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
    return JSON.parse(localStorage.getItem(k)).access_token;
  }), 'admin_overview')).body;
  ok(ov.totals.participants === 3 && ov.totals.verified_emails === 3, 'totals: 3 participants, 3 verified');
  ok(ov.totals.max_depth === 3, 'tree depth 3');
  ok(ov.invitations.generated === 3 && ov.invitations.accepted === 2 && ov.invitations.duplicate === 1, 'invitation counts');
  ok(ov.reciprocity.pairs === 3, `reciprocal pairs recorded (${ov.reciprocity.pairs})`);
  ok(ov.methods.length === 3, 'per-method performance rows');
  const tileText = await adminPage.locator('.tiles').first().innerText();
  ok(tileText.includes('Participants') && tileText.includes('3'), 'dashboard renders tiles');

  const [download] = await Promise.all([
    adminPage.waitForEvent('download'),
    adminPage.getByRole('button', { name: 'classifications.csv' }).click(),
  ]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  ok(csv.split('\n')[0].includes('direction') && csv.trim().split('\n').length === 8, 'classifications CSV export (7 rows)');

  step('Right to erasure: Dave deletes his data');
  await davePage.getByLabel('Your data').click();
  await davePage.getByText('Delete my data').click();
  await davePage.getByRole('button', { name: 'Delete permanently' }).click();
  await davePage.getByText('Your data has been deleted.').waitFor();
  const tomb = (await q(`select * from participants where id = $1`, [dave.id]))[0];
  ok(tomb.email === null && tomb.display_name === null && tomb.user_id === null && tomb.deleted_at, 'personal data erased, anonymous node kept');
  ok((await q(`select count(*)::int n from classifications where rater_id = $1`, [dave.id]))[0].n === 0, 'Dave\'s answers deleted');
  ok((await q(`select count(*)::int n from feedback where participant_id = $1`, [dave.id]))[0].n === 0, 'Dave\'s feedback deleted');
  ok((await q(`select count(*)::int n from auth.users where email = 'dave@test.dev'`))[0].n === 0, 'auth user removed');

  step('Marketing consent can be changed');
  await bobPage.goto(APP);
  await bobPage.getByLabel('Your data').click();
  await bobPage.getByText('Email me about Pipeline').click();
  await bobPage.waitForTimeout(500);
  ok((await participant('bob@test.dev')).marketing_consent === true, 'marketing consent toggled on');

  console.log(`\n✔ ${passed} checks passed. Screenshots in test-results/`);
} catch (e) {
  console.error(`\n${e.stack || e.message}`);
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await browser.close();
  await vite.close();
  await mock.close();
  await db.end();
}
