// End-to-end test of the frictionless (anonymous-auth) onboarding:
//   * a legacy participant created under migration 001 (email flow) survives 002
//   * admin seed links → seed participant → two more referral generations,
//     none of whom enter an email before the referral stage
//   * reveals, post-reveal waitlist, optional email linking + cross-device sign-in
//   * abuse cases: self-referral (account and browser), one participant per
//     browser, link reuse, duplicate credit, limits, rate limits, guessed tokens
//   * RLS, admin numbers, CSV exports, deletion
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
const psql = (f) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -q -f ${path.join(root, f)}`, { stdio: 'pipe' });

// ---------- fresh database at the *old* schema ----------
step('Database at migration 001 with a legacy (email-flow) participant');
{
  const admin = new pg.Client({ connectionString: ADMIN_DB });
  await admin.connect();
  await admin.query('drop database if exists px with (force)');
  await admin.query('create database px');
  await admin.end();
  psql('test/local-supabase-shim.sql');
  psql('supabase/migrations/001_experiment_schema.sql');
}
const db = new pg.Pool({ connectionString: DB });
const q = async (sql, args) => (await db.query(sql, args)).rows;

/** Run SQL as a given role/user, the way PostgREST would. */
async function asUser(sub, sql, args = [], headers = {}) {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${sub ? 'authenticated' : 'anon'}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role: 'authenticated' } : { role: 'anon' })]);
    await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
    const r = (await c.query(sql, args)).rows;
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    return { error: e.message };
  } finally {
    c.release();
  }
}

// Old flow: verified email user accepts a seed link with the 4-argument call.
const [legacySeed] = await q(`insert into invitations (token, sender_name) values (px_new_token(), 'Truman') returning token`);
const [legacyUser] = await q(`insert into auth.users (email, email_confirmed_at) values ('legacy@test.dev', now()) returning id`);
await asUser(legacyUser.id, `select accept_invitation($1, 'Lee', true, true)`, [legacySeed.token]);
const [{ method: legacyMethod }] = await q(`select method from participants where user_id = $1`, [legacyUser.id]);
const legacyValue = { strength: 'close_friend', context: 'class', comfort: '4' }[legacyMethod];
const legacyLink = (await asUser(legacyUser.id, `select create_invitation($1, 'Erin') as r`, [legacyValue]))[0].r.token;
ok((await q(`select count(*)::int n from participants`))[0].n === 1, 'legacy participant + link created under 001');

step('Apply migration 002 on top');
psql('supabase/migrations/002_anonymous_onboarding.sql');
const [legacyAfter] = await q(`select * from participants where display_name = 'Lee'`);
ok(legacyAfter.email === 'legacy@test.dev' && legacyAfter.marketing_consent === true, 'legacy participant data intact');
ok((await asUser(null, `select open_invitation($1) as r`, [legacyLink]))[0].r.state === 'ok', 'legacy invitation link still opens');
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
const byName = async (name) => (await q(`select * from participants where display_name = $1 and deleted_at is null`, [name]))[0];
const authUser = async (id) => (await q(`select * from auth.users where id = $1`, [id]))[0];
const jwtOf = (page) => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
  return k ? JSON.parse(localStorage.getItem(k)).access_token : null;
});
const rpcAs = async (jwt, fn, args = {}, ip) => {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.json() };
};
const answer = (page, scope = '') =>
  page.locator(`${scope} .classifier .option, ${scope} .classifier .scale-dot`).first().click();

/** Landing → relationship question → name + consent. Returns at the join result. */
async function startJoin(page, link, name, { shots = false } = {}) {
  await page.goto(link);
  await page.getByRole('heading', { name: /invited you\.$/ }).waitFor();
  if (shots) await page.waitForTimeout(1600), await shot(page, `01-landing`);
  await page.getByRole('button', { name: 'Enter the Experiment' }).click();
  await page.locator('.classifier').waitFor();
  const method = await page.locator('.classifier').getAttribute('data-method');
  if (shots) await page.waitForTimeout(600), await shot(page, `02-question-${method}`);
  await answer(page);
  await page.getByPlaceholder('First name').fill(name);
  await page.getByText('I agree to take part in this research.').click();
  if (shots) await shot(page, `03-name-consent`);
  await page.getByRole('button', { name: 'Continue' }).click();
  return method;
}

/** The full new-participant journey: no email anywhere. */
async function joinViaLink(page, link, name, opts) {
  const t0 = Date.now();
  const method = await startJoin(page, link, name, opts);
  await page.locator('.home').waitFor();
  return { method, seconds: (Date.now() - t0) / 1000 };
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
  const link = 'http://' + (await page.locator('.sheet .url').innerText());
  await page.getByRole('button', { name: 'Done' }).click();
  return link;
}
async function continueReveal(page) {
  await page.locator('.reveal-overlay').waitFor();
  await page.waitForTimeout(2200);
  await page.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
}

try {
  // ---------- admin seeds ----------
  step('Admin signs in and generates seed invitations');
  const adminPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await adminPage.goto(`${APP}/admin`);
  await adminPage.getByLabel('Email', { exact: true }).fill('admin@test.dev');
  await adminPage.getByRole('button', { name: 'Email me a code' }).click();
  await adminPage.getByLabel('Verification code').fill(await getCode('admin@test.dev'));
  await adminPage.getByRole('button', { name: 'Verify' }).click();
  await adminPage.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await adminPage.getByLabel('Number of links').fill('3');
  await adminPage.getByLabel('Sender name').fill('Truman');
  await adminPage.getByRole('button', { name: 'Generate' }).click();
  await adminPage.getByText('/i/').first().waitFor();
  const seeds = await q(`select token from invitations where sender_id is null and admin_note is null and sender_name = 'Truman' and status = 'created' order by created_at`);
  ok(seeds.length === 3, 'three seed links created');

  // ---------- generation 1 ----------
  step('Generation 1: Alice joins with only a name and consent');
  const alicePage = await newPhone();
  const a = await joinViaLink(alicePage, `${APP}/i/${seeds[0].token}`, 'Alice', { shots: true });
  ok(await alicePage.getByPlaceholder('Email').count() === 0, 'no email field before the referral stage');
  console.log(`    journey time (automated): ${a.seconds.toFixed(1)}s`);
  await alicePage.waitForTimeout(800);
  await shot(alicePage, '04-home-empty');
  const alice = await byName('Alice');
  const aliceAuth = await authUser(alice.user_id);
  ok(alice.depth === 1 && alice.parent_id === null, 'Alice is generation 1');
  ok(aliceAuth && aliceAuth.email === null, 'Alice has an anonymous Supabase identity (no email)');
  ok(alice.research_consent_at && alice.marketing_consent === false, 'research consent stored; no marketing subscription');
  ok(alice.device_hash && !alice.device_hash.includes('-'), 'browser id stored only as a hash');
  const inbound = await q(`select c.* from classifications c join invitations i on i.id = c.invitation_id where i.token = $1`, [seeds[0].token]);
  ok(inbound.length === 1 && inbound[0].rater_id === alice.id, 'relationship answer linked to her identity');

  await alicePage.reload();
  await alicePage.locator('.home').waitFor();
  ok(true, 'session persists across reloads without signing in');

  step('Alice invites Bob and Carol → reveals → waitlist invitation');
  const bobLink = await invite(alicePage, 'Bob', { shots: true });
  await continueReveal(alicePage);
  const carolLink = await invite(alicePage, 'Carol');
  await alicePage.locator('.reveal-overlay').waitFor();
  await alicePage.waitForTimeout(2200);
  await shot(alicePage, '06-reveal-2');
  await alicePage.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
  await alicePage.getByRole('heading', { name: 'Be first in.' }).waitFor();
  await alicePage.waitForTimeout(900);
  await shot(alicePage, '07-waitlist');
  ok(true, 'early-access screen appears after the second reveal');
  await alicePage.getByLabel('Email', { exact: true }).fill('Alice@Test.dev');
  await alicePage.getByRole('button', { name: 'Join the waitlist' }).click();
  await alicePage.getByRole('heading', { name: 'You’re on the list.' }).waitFor();
  await shot(alicePage, '08-waitlist-done');
  await alicePage.getByRole('button', { name: 'Continue' }).click();
  const [wl] = await q(`select * from waitlist where participant_id = $1`, [alice.id]);
  ok(wl && wl.email === 'alice@test.dev' && wl.consent_text.includes('early access'), 'waitlist entry with its own consent text');
  ok((await byName('Alice')).marketing_consent === false, 'joining the waitlist does not touch research/marketing fields');
  ok((await authUser(alice.user_id)).email === null, 'waitlist email is not linked to the account unless asked');

  step('Abuse cases (server-side)');
  const aliceJwt = await jwtOf(alicePage);
  await alicePage.goto(carolLink);
  await alicePage.getByRole('heading', { name: 'This is your invitation.' }).waitFor();
  ok(true, 'opening your own link is detected');
  let r = await rpcAs(aliceJwt, 'accept_invitation', { p_token: carolLink.split('/i/')[1], p_display_name: 'A', p_research_consent: true });
  ok(r.body.message === 'self_invite', 'self-referral by account rejected');
  r = await rpcAs(aliceJwt, 'create_invitation', { p_value: { strength: 'weak', context: 'other', comfort: '3' }[alice.method] });
  ok(r.body.message === 'invite_limit', 'third active invitation rejected');
  r = await rpcAs(aliceJwt, 'create_invitation', { p_value: 'nope' });
  ok(r.body.message === 'invalid_value', 'invalid classification value rejected');
  ok((await rpcAs(null, 'get_my_state')).status >= 400, 'anonymous visitors cannot read participant state');
  ok((await rpcAs(aliceJwt, 'admin_overview')).body.message === 'forbidden', 'participants cannot read admin data');
  ok((await rpcAs(null, 'open_invitation', { p_token: 'AAAAAAAAAAAAAAAAAAAAAA' })).body.state === 'invalid', 'guessed token is invalid');

  step('Invitation landing');
  {
    const p = await newPhone();
    await p.goto(bobLink);
    await p.getByRole('heading', { name: 'Alice invited you.' }).waitFor({ timeout: 5000 });
    ok(true, 'headline uses the inviter’s first name');
    const t0 = Date.now();
    await p.getByRole('button', { name: 'Enter the Experiment' }).click();
    await p.locator('.classifier').waitFor();
    ok(Date.now() - t0 < 1500, 'Enter works immediately, before the animation finishes');
    await p.goBack().catch(() => {});

    const seedPage = await newPhone();
    await seedPage.goto(`${APP}/i/${seeds[2].token}`);
    await seedPage.getByRole('heading', { name: 'Truman invited you.' }).waitFor();
    ok(!(await seedPage.locator('.landing-cta').getAttribute('class')).includes('is-shown'), 'button starts hidden while the sentence types');
    await seedPage.waitForTimeout(500);
    await shot(seedPage, '01b-landing-typing');
    await seedPage.waitForTimeout(3000);
    ok((await seedPage.locator('.landing-cta').getAttribute('class')).includes('is-shown'), 'button fades in after the sentence');
    ok((await seedPage.locator('.landing-follow .tw-rest').innerText()) === '', 'follow-up line fully typed');
    ok((await seedPage.locator('.landing-meta').getAttribute('class')).includes('is-shown'), '"Under two minutes · Voluntary" shown last');
    ok((await seedPage.locator('.landing-body .sr-only').innerText()).includes('Harvard startup'), 'screen readers get the full sentence');
    await shot(seedPage, '01c-landing-complete');

    const rc = await browser.newContext({ ...iphone, reducedMotion: 'reduce' });
    contexts.push(rc);
    const rm = await rc.newPage();
    await rm.goto(`${APP}/i/${seeds[2].token}`);
    await rm.getByRole('heading', { name: 'Truman invited you.' }).waitFor();
    ok((await rm.locator('.landing-cta').getAttribute('class')).includes('is-shown')
      && (await rm.locator('.landing-body .tw-rest').innerText()) === '', 'reduced motion: everything shown at once');

    const sk = await newPhone();
    await sk.goto(`${APP}/i/${seeds[2].token}`);
    await sk.getByRole('heading', { name: 'Truman invited you.' }).waitFor();
    await sk.mouse.click(200, 120);
    await sk.waitForTimeout(100);
    ok((await sk.locator('.landing-meta').getAttribute('class')).includes('is-shown'), 'a tap anywhere skips to the end');
  }

  // ---------- generation 2 ----------
  step('Generation 2: Bob joins through Alice’s link');
  const bobPage = await newPhone();
  await joinViaLink(bobPage, bobLink, 'Bob');
  const bob = await byName('Bob');
  ok(bob.depth === 2 && bob.parent_id === alice.id, 'Bob is generation 2, child of Alice');

  step('Opened vs joined, and duplicate credit');
  const carolAnon = await newPhone();
  await carolAnon.goto(carolLink);
  await carolAnon.getByRole('button', { name: 'Enter the Experiment' }).waitFor();
  await alicePage.goto(APP);
  await alicePage.locator('.slot-accepted').waitFor();
  const pills = await alicePage.locator('.pill').allInnerTexts();
  ok(pills.some((t) => t.includes('Joined')) && pills.some((t) => t.includes('Opened')), `Alice sees ${pills.join(' / ')}`);
  await bobPage.goto(carolLink);
  await bobPage.getByRole('button', { name: 'Enter the Experiment' }).click();
  await answer(bobPage);
  await bobPage.getByText('already part of the experiment').waitFor();
  ok((await q(`select status from invitations where token = $1`, [carolLink.split('/i/')[1]]))[0].status === 'duplicate', 'existing participant gets no new node or credit');

  step('Bob invites Dave, then saves his network to a verified email');
  const daveLink = await invite(bobPage, 'Dave');
  await continueReveal(bobPage);
  await bobPage.getByLabel('Your data').click();
  await bobPage.waitForTimeout(500);
  await shot(bobPage, '09-your-data-anonymous');
  await bobPage.locator('.account-row').getByRole('button', { name: 'Save' }).click();
  await bobPage.getByRole('heading', { name: 'Keep your network.' }).waitFor();
  await bobPage.getByLabel('Email', { exact: true }).fill('bob@test.dev');
  await bobPage.getByRole('button', { name: 'Send code' }).click();
  await bobPage.getByLabel('Verification code').fill(await getCode('bob@test.dev'));
  await bobPage.getByRole('button', { name: 'Verify' }).click();
  await bobPage.getByRole('heading', { name: 'Network saved.' }).waitFor();
  await bobPage.getByRole('button', { name: 'Continue' }).click();
  const bobAuth = await authUser(bob.user_id);
  ok(bobAuth.email === 'bob@test.dev' && bobAuth.email_confirmed_at, 'email linked to the SAME identity (user id unchanged)');
  ok((await byName('Bob')).id === bob.id, 'participant record and referrals unchanged');
  ok((await q(`select count(*)::int n from waitlist where participant_id = $1`, [bob.id]))[0].n === 0, 'linking an email does not join the waitlist');

  step('Browser-level protections');
  await bobPage.getByLabel('Your data').click();
  await bobPage.getByRole('button', { name: 'Sign out' }).click();
  await bobPage.waitForTimeout(400);
  await startJoin(bobPage, daveLink, 'NotBob');
  await bobPage.getByText('You can’t accept your own invitation.').waitFor();
  ok(true, 'signed out + own link from the same browser → self-referral blocked');
  await startJoin(bobPage, `${APP}/i/${seeds[1].token}`, 'BobAgain');
  await bobPage.getByText('This browser is already part of the experiment').waitFor();
  ok(true, 'second participant from the same browser blocked');
  ok(!(await byName('NotBob')) && !(await byName('BobAgain')), 'no duplicate participant rows created');

  step('Cross-device: Bob signs in with his linked email on a new phone');
  const bobPhone2 = await newPhone();
  await bobPhone2.goto(APP);
  await bobPhone2.getByLabel('Email', { exact: true }).fill('bob@test.dev');
  await bobPhone2.getByRole('button', { name: 'Email me a code' }).click();
  await bobPhone2.getByLabel('Verification code').fill(await getCode('bob@test.dev'));
  await bobPhone2.getByRole('button', { name: 'Verify' }).click();
  await bobPhone2.locator('.slots').waitFor();
  ok((await bobPhone2.locator('.slot-main').first().innerText()).includes('Dave'), 'Bob’s network and links appear on the new device');

  // ---------- generation 3 ----------
  step('Generation 3: Dave joins through Bob’s link');
  const davePage = await newPhone();
  await joinViaLink(davePage, daveLink, 'Dave');
  const dave = await byName('Dave');
  ok(dave.depth === 3 && dave.parent_id === bob.id, 'Dave is generation 3, child of Bob');
  const reused = await newPhone();
  await reused.goto(daveLink);
  await reused.getByRole('heading', { name: 'This invitation has already been used.' }).waitFor();
  ok(true, 'an accepted link cannot be reused');

  step('Dave takes the feedback path, then declines the waitlist');
  await davePage.getByText('Answer one question instead').click();
  await davePage.getByLabel('Your answer').fill('Not wanting to impose.');
  await davePage.getByRole('button', { name: 'Submit and reveal' }).click();
  await continueReveal(davePage);
  await continueReveal(davePage);
  await davePage.getByRole('heading', { name: 'Be first in.' }).waitFor();
  await davePage.getByRole('button', { name: 'Not now' }).click();
  await davePage.locator('.early-card').waitFor();
  await davePage.waitForTimeout(600);
  await shot(davePage, '10-home-early-access-card');
  ok((await q(`select count(*)::int n from waitlist where participant_id = $1`, [dave.id]))[0].n === 0, '"Not now" stores nothing');
  await davePage.reload();
  await davePage.locator('.home').waitFor();
  ok(await davePage.getByRole('heading', { name: 'Be first in.' }).count() === 0, 'waitlist screen does not nag again');

  step('Legacy participant keeps working');
  const erinPage = await newPhone();
  await joinViaLink(erinPage, `${APP}/i/${legacyLink}`, 'Erin');
  ok((await byName('Erin')).parent_id === legacyAfter.id, 'new anonymous participant joins under a legacy participant’s link');
  const leePage = await newPhone();
  await leePage.goto(APP);
  await leePage.getByLabel('Email', { exact: true }).fill('legacy@test.dev');
  await leePage.getByRole('button', { name: 'Email me a code' }).click();
  await leePage.getByLabel('Verification code').fill(await getCode('legacy@test.dev'));
  await leePage.getByRole('button', { name: 'Verify' }).click();
  await leePage.locator('.slot-accepted').waitFor();
  ok(true, 'legacy participant signs in by email and sees Erin joined');

  step('Rate limits');
  const daveJwt = await jwtOf(davePage);
  const results = [];
  for (let i = 0; i < 11; i++) results.push((await rpcAs(daveJwt, 'join_waitlist', { p_email: `d${i}@test.dev` }, '9.9.9.9')).body);
  ok(results.slice(0, 10).every((b) => b.ok) && results[10].message === 'rate_limited', 'waitlist: 11th signup from one IP within an hour is refused');
  await q(`update experiment_settings set value = jsonb_set(value, '{joins_per_ip_hour}', '0') where key = 'rate_limits'`);
  const anon = (await (await fetch(`${API}/auth/v1/signup`, { method: 'POST', body: '{}' })).json()).access_token;
  r = await rpcAs(anon, 'accept_invitation', { p_token: seeds[2].token, p_display_name: 'Bot', p_research_consent: true, p_device: 'bot-1' }, '7.7.7.7');
  ok(r.body.message === 'rate_limited', 'joins: per-IP limit refuses new participants');
  await q(`update experiment_settings set value = jsonb_set(value, '{joins_per_ip_hour}', '20') where key = 'rate_limits'`);
  await q(`update experiment_settings set value = jsonb_set(value, '{opens_per_ip_hour}', '0') where key = 'rate_limits'`);
  ok((await rpcAs(null, 'open_invitation', { p_token: seeds[2].token }, '7.7.7.7')).body.state === 'rate_limited', 'opens: per-IP limit');
  await q(`update experiment_settings set value = jsonb_set(value, '{opens_per_ip_hour}', '300') where key = 'rate_limits'`);
  ok((await q(`select count(*)::int n from rate_events where key_hash like '%.%'`))[0].n === 0, 'IPs are stored only as hashes');

  step('Branch visualization shows only permitted data');
  await alicePage.reload();
  await alicePage.locator('.tree svg').waitFor();
  await alicePage.waitForTimeout(1200);
  await shot(alicePage, '11-home-branch');
  const branch = (await rpcAs(aliceJwt, 'get_my_state')).body.branch;
  ok(branch.length === 3, 'Alice’s branch: Alice, Bob, Dave');
  ok(!JSON.stringify(branch).includes('Dave') && !JSON.stringify(branch).includes(bob.id), 'no names or ids of descendants leak');

  step('RLS');
  ok((await asUser(null, 'select * from participants')).error, 'anon cannot select participants');
  ok((await asUser(null, 'select * from waitlist')).error, 'anon cannot select waitlist');
  ok((await asUser(bob.user_id, 'select * from waitlist')).length === 0, 'participants cannot see others’ waitlist rows');
  ok((await asUser(bob.user_id, 'select * from rate_events')).error, 'rate limit records are private');
  ok((await asUser(bob.user_id, 'select id from participants')).length === 1, 'participant sees only their own row');
  ok((await asUser(bob.user_id, `update participants set reveal_level = 2`)).error, 'no direct writes');

  step('Admin dashboard');
  await adminPage.getByRole('button', { name: 'Refresh' }).click();
  await adminPage.waitForTimeout(1500);
  await adminPage.screenshot({ path: path.join(SHOTS, '12-admin.png'), fullPage: true });
  const adminJwt = await jwtOf(adminPage);
  const ov = (await rpcAs(adminJwt, 'admin_overview')).body;
  const acct = (await rpcAs(adminJwt, 'admin_account_stats')).body;
  ok(ov.totals.participants === 5 && ov.totals.max_depth === 3, 'totals: 5 participants, depth 3');
  ok(acct.linked_emails === 2 && acct.anonymous === 3, `accounts: 2 linked, 3 anonymous`);
  ok(acct.waitlist === 2, 'waitlist count (Alice, Dave via API)');
  ok((await adminPage.locator('.tiles').first().innerText()).includes('Waitlist'), 'dashboard shows the waitlist tile');
  ok(!JSON.stringify(await adminPage.locator('.settings').innerText()).includes('hash_salt'), 'salt hidden from the settings panel');
  const [download] = await Promise.all([
    adminPage.waitForEvent('download'),
    adminPage.getByRole('button', { name: 'waitlist.csv' }).click(),
  ]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  ok(csv.startsWith('email,') && csv.trim().split('\n').length === 3, 'waitlist CSV export (2 rows)');

  step('Right to erasure');
  await davePage.getByLabel('Your data').click();
  await davePage.getByText('Delete my data').click();
  await davePage.getByRole('button', { name: 'Delete permanently' }).click();
  await davePage.getByText('Your data has been deleted.').waitFor();
  const [tomb] = await q(`select * from participants where id = $1`, [dave.id]);
  ok(tomb.display_name === null && tomb.user_id === null && tomb.device_hash === null && tomb.deleted_at, 'personal data erased, anonymous node kept');
  ok((await q(`select count(*)::int n from waitlist where participant_id = $1`, [dave.id]))[0].n === 0, 'waitlist entry deleted');
  ok(!(await authUser(dave.user_id)), 'anonymous auth user removed');

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
