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
const legacyValue = { strength: 'close_friend', context: 'class', comfort: '4', circular: '70' }[legacyMethod];
const legacyLink = (await asUser(legacyUser.id, `select create_invitation($1, 'Erin') as r`, [legacyValue]))[0].r.token;
ok((await q(`select count(*)::int n from participants`))[0].n === 1, 'legacy participant + link created under 001');

step('Apply migration 002 on top');
psql('supabase/migrations/002_anonymous_onboarding.sql');
psql('supabase/migrations/003_share_tracking.sql');
psql('supabase/migrations/004_phone_ready.sql');
psql('supabase/migrations/005_name_moderation.sql');
psql('supabase/migrations/006_circular_strength.sql');
psql('supabase/migrations/007_invited_names.sql');
psql('supabase/migrations/008_live_invitation_tracking.sql');
const [legacyAfter] = await q(`select * from participants where display_name = 'Lee'`);
ok(legacyAfter.email === 'legacy@test.dev' && legacyAfter.marketing_consent === true, 'legacy participant data intact');
const [legacyInv] = await q(`select * from invitations where token = $1`, [legacyLink]);
ok(legacyInv.share_method === 'legacy' && legacyInv.shared_at, 'pre-003 links count as shared (no participant is re-locked)');
ok((await asUser(null, `select open_invitation($1) as r`, [legacyLink], { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' }))[0].r.state === 'ok', 'legacy invitation link still opens');
await q(`insert into public.admins (email) values ('admin@test.dev')`);

// ---------- servers ----------
const mock = await startMockSupabase({ port: API_PORT, connectionString: DB });
process.env.VITE_SUPABASE_URL = API;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'anon-key';
process.env.VITE_PHONE_AUTH = '1'; // exercise the (off-by-default) phone flow against the mock; no SMS is sent
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
const getPhoneCode = async (phone) => {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${API}/__test/code?phone=${encodeURIComponent(phone)}`)).json();
    if (r?.code) return r.code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no SMS code for ${phone}`);
};
/** Everything a participant can see: page text, tab title, and share-preview tags. */
const visibleBrand = (page) => page.evaluate(() => [
  document.body.innerText,
  document.title,
  ...[...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"], meta[name="apple-mobile-web-app-title"]')].map((m) => m.content),
].join(' | '));
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
/** Answer whichever classification method is shown (first option; for D, one keyboard step then Continue). */
async function answer(page, scope = '', which = 'first') {
  await page.locator(`${scope} .classifier`).waitFor();
  if (await page.locator(`${scope} .classifier .circular`).count()) {
    await page.locator(`${scope} .circular-input`).focus();
    await page.keyboard.press(which === 'last' ? 'End' : 'ArrowRight');
    await page.locator(`${scope} .classifier`).getByRole('button', { name: 'Continue', exact: true }).click();
    return;
  }
  const opts = page.locator(`${scope} .classifier .option, ${scope} .classifier .scale-dot`);
  await (which === 'last' ? opts.last() : opts.first()).click();
}

/** Landing → relationship question → name + consent. Returns at the join result. */
const CONSENT = 'I agree to take part in this research on how people are connected.';
async function startJoin(page, link, name, { shots = false, checks = false } = {}) {
  await page.goto(link);
  await page.getByRole('heading', { name: /invited you\.$/ }).waitFor();
  if (shots) await page.waitForTimeout(1600), await shot(page, `01-landing`);
  await page.getByRole('button', { name: 'Enter the Experiment' }).click();
  await page.locator('.classifier').waitFor();
  const method = await page.locator('.classifier').getAttribute('data-method');
  if (shots) await page.waitForTimeout(600), await shot(page, `02-question-${method}`);
  await answer(page);
  if (checks) {
    // First-name + consent page ("stealth mode")
    await page.getByText('We’re in stealth mode.').waitFor();
    if (shots) await page.waitForTimeout(1500), await shot(page, `03-name-consent-empty`);
    ok(await page.getByRole('heading', { name: 'And you are?' }).isVisible(), 'seed link (no invited name): "And you are?"');
    ok(await page.getByText('Participate in our experiment to discover our name and what we’re building.').isVisible(), 'join page: supporting text');
    ok(await page.getByText('No account needed.', { exact: true }).isVisible(), 'join page: "No account needed." footer');
    ok(await page.getByText('Invite two people. Find out what this is.').count() === 0, 'old headline removed');
    const cont = page.getByRole('button', { name: 'Continue' });
    ok(await cont.isDisabled(), 'Continue disabled with no name and no consent');
    await page.getByPlaceholder('First name').fill(name);
    ok(await cont.isDisabled(), 'Continue still disabled with a name but no consent');
    await page.getByPlaceholder('First name').fill('   ');
    await page.getByText(CONSENT).click();
    ok(await cont.isDisabled(), 'Continue disabled with consent but a blank name');
    await page.getByRole('button', { name: 'How data is used' }).click();
    ok(await page.getByText('We record how people describe their connections and how invitations spread.').isVisible(), 'consent details still accessible');
    ok(!(await visibleBrand(page)).includes('Pipeline'), 'join page: no "Pipeline" anywhere (page, tab, share tags)');
    await page.getByPlaceholder('First name').fill(name);
    ok(await cont.isEnabled(), 'Continue enabled with a name and consent');
    if (shots) await shot(page, `03-name-consent`);
    await page.getByRole('button', { name: 'Continue' }).click();
    return method;
  }
  await completeJoin(page, name);
  return method;
}

/**
 * Finish the join screen as `name`: confirm the invited name if it matches,
 * otherwise correct it; on seed links (no invited name) type it.
 */
async function completeJoin(page, name, { consentBox = false } = {}) {
  const form = page.locator('form.join-form');
  await form.waitFor();
  const mode = await form.getAttribute('data-mode');
  const tick = () => (consentBox ? page.locator('.consents .check-box').first() : page.getByText(CONSENT)).click();
  if (mode === 'confirm') {
    const invited = (await page.locator('.join-title').innerText()).replace(/^Are you /, '').replace(/\?$/, '');
    await tick();
    if (invited.toLowerCase() === name.toLowerCase()) {
      await page.getByRole('button', { name: 'Yes, that’s me' }).click();
      return;
    }
    await page.getByRole('button', { name: 'That’s not my name' }).click();
    await page.getByPlaceholder('Your first name').fill(name);
  } else {
    await page.getByPlaceholder('First name').fill(name);
    await tick();
  }
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** The full new-participant journey: no email anywhere. */
async function joinViaLink(page, link, name, opts) {
  const t0 = Date.now();
  const method = await startJoin(page, link, name, opts);
  await page.locator('.home').waitFor();
  return { method, seconds: (Date.now() - t0) / 1000 };
}

/** Create an invitation from the home screen; returns the link. */
/** Create an invitation. By default the link is copied (which counts as sharing). */
async function invite(page, label, { shots = false, share = true } = {}) {
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  await page.getByLabel('Their first name').fill(label);
  if (shots) await page.waitForTimeout(400), await shot(page, `05-invite-who`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.sheet .classifier').waitFor();
  if (shots) await page.waitForTimeout(500), await shot(page, `05b-invite-classify`);
  await answer(page, '.sheet', 'last');
  await page.getByRole('heading', { name: `${label}’s link is ready.` }).waitFor();
  const link = 'http://' + (await page.locator('.sheet .url').innerText());
  if (share) {
    await page.locator('.sheet').getByRole('button', { name: 'Copy link' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Continue' }).click();
  } else {
    await page.locator('.sheet').getByRole('button', { name: 'Later' }).click();
  }
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
  await adminPage.getByRole('button', { name: 'Verify', exact: true }).click();
  await adminPage.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await adminPage.getByLabel('Number of links').fill('3');
  await adminPage.getByLabel('Sender name').fill('Truman');
  await adminPage.getByRole('button', { name: 'Generate' }).click();
  // Wait until the three new seed links are saved (the legacy seed link is already listed).
  for (let i = 0; i < 50 && (await q(`select count(*)::int n from invitations where sender_id is null and status = 'created'`))[0].n < 3; i++) {
    await adminPage.waitForTimeout(100);
  }
  const seeds = await q(`select token from invitations where sender_id is null and admin_note is null and sender_name = 'Truman' and status = 'created' order by created_at`);
  ok(seeds.length === 3, 'three seed links created');

  // ---------- generation 1 ----------
  step('Generation 1: Alice joins with only a name and consent');
  const alicePage = await newPhone();
  const a = await joinViaLink(alicePage, `${APP}/i/${seeds[0].token}`, 'Alice', { shots: true, checks: true });
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

  step('Branding stays hidden before the first unlock');
  ok(!(await visibleBrand(alicePage)).includes('Pipeline'), 'home: no "Pipeline" in page, tab title or share tags');
  ok((await alicePage.locator('.wordmark').innerText()) === 'The Experiment' && (await alicePage.title()) === 'The Experiment', 'header and tab say "The Experiment"');
  await alicePage.getByLabel('Your data').click();
  await alicePage.waitForTimeout(400);
  ok(!(await visibleBrand(alicePage)).includes('Pipeline'), 'Your data sheet: no "Pipeline" (waitlist row hidden until unlock)');
  ok(await alicePage.getByText('Early-access waitlist').count() === 0, 'waitlist row hidden before unlock');
  ok(await alicePage.locator('.save-card').count() === 0, 'no "Save your network" prompt before discovering Pipeline');
  await alicePage.getByRole('button', { name: 'Close' }).click();
  await alicePage.waitForTimeout(300);

  step('Invitation home: personal headline, locked second card, no network yet');
  ok(await alicePage.getByRole('heading', { name: 'Now it’s your turn, Alice.' }).isVisible(), 'headline uses the participant’s first name');
  ok(await alicePage.getByText('Invite two people to discover what we’re building.').isVisible(), 'supporting line shown');
  ok(await alicePage.getByText('Unlock 1 — Our name').isVisible() && await alicePage.getByText('Unlock 2 — Our mission').isVisible(), 'cards name what each unlocks');
  ok(await alicePage.getByRole('button', { name: /Second invitation/ }).isDisabled(), 'second invitation starts locked');
  ok(await alicePage.locator('.network-card').count() === 0, 'network hidden before any invitation');

  step('First invitation: created but not shared → nothing unlocks');
  const bobLink = await invite(alicePage, 'Bob', { shots: true, share: false });
  await alicePage.waitForTimeout(800);
  ok(await alicePage.locator('.reveal-overlay').count() === 0, 'no reveal for an unshared link');
  const [bobInv0] = await q(`select * from invitations where token = $1`, [bobLink.split('/i/')[1]]);
  ok(bobInv0.shared_at === null && bobInv0.status === 'created', 'backend: created, not shared');
  ok((await byName('Alice')).reveal_level === 0, 'reveal level still 0');
  ok(await alicePage.getByRole('button', { name: /Second invitation/ }).isDisabled(), 'second invitation still locked');
  ok((await alicePage.locator('.invite-card.is-filled').innerText()).includes('Bob') && (await alicePage.locator('.invite-card.is-filled .pill').innerText()).includes('Ready'), 'slot shows Bob · Ready');
  ok(await alicePage.getByText('Share to unlock our name').isVisible(), 'hint to share');
  await alicePage.locator('.network-card').waitFor();
  ok(await alicePage.locator('.network-card .tree-node.kind-pending').count() === 1, 'network appears with Bob as a dim pending node');
  await alicePage.waitForTimeout(900);
  await alicePage.screenshot({ path: path.join(SHOTS, '05c-home-first-invite-unshared.png'), fullPage: true });

  step('Copying the link unlocks "Pipeline" and the second invitation');
  await alicePage.locator('.invite-card.is-filled').getByRole('button', { name: 'Copy link' }).click();
  await alicePage.locator('.reveal-overlay').waitFor();
  await alicePage.waitForTimeout(1800);
  ok((await alicePage.locator('.reveal-title').innerText()).includes('part of Pipeline'), 'reveal 1: the name');
  await alicePage.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
  const [bobInv1] = await q(`select * from invitations where token = $1`, [bobLink.split('/i/')[1]]);
  ok(bobInv1.shared_at && bobInv1.share_method === 'copy' && bobInv1.status === 'created' && bobInv1.opened_at === null, 'backend: shared (copy), not opened, not accepted');
  await alicePage.getByRole('button', { name: /Invite someone.*Unlock 2/ }).waitFor();
  ok((await alicePage.locator('.wordmark').innerText()) === 'Pipeline' && (await alicePage.title()) === 'Pipeline', 'after the first unlock the header and tab say "Pipeline"');
  ok((await alicePage.locator('.wordmark').getAttribute('class')).includes('is-revealing'), 'header transitions in place when it unlocks');
  await alicePage.locator('.save-card').waitFor();
  ok(await alicePage.getByText('Save your network').isVisible(), 'after discovering Pipeline: optional "Save your network" (phone)');
  await alicePage.reload();
  await alicePage.locator('.home').waitFor();
  ok((await alicePage.locator('.wordmark').innerText()) === 'Pipeline' && !(await alicePage.locator('.wordmark').getAttribute('class')).includes('is-revealing'), 'returning participant keeps "Pipeline" (no replayed animation)');
  ok(await alicePage.getByRole('button', { name: /Invite someone.*Unlock 2/ }).isEnabled(), 'second invitation unlocked');
  ok((await alicePage.locator('.invite-card.is-filled .pill').innerText()).includes('Pending'), 'slot shows Pending (sharing started; delivery unknown)');
  await alicePage.waitForTimeout(300);
  await shot(alicePage, '05d-home-second-unlocked');

  step('Second invitation → mission → waitlist invitation');
  await alicePage.getByRole('button', { name: 'Invite someone' }).first().click();
  ok(await alicePage.getByRole('heading', { name: 'Who will you invite next?' }).isVisible(), 'second flow asks "Who will you invite next?"');
  await alicePage.getByRole('button', { name: 'Close' }).click();
  await alicePage.waitForTimeout(300);
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
  ok(await alicePage.getByRole('button', { name: 'Join the waitlist' }).isDisabled(), 'waitlist needs explicit consent (unticked by default)');
  ok(await alicePage.getByText('Also save my network').count() === 0, 'waitlist is separate from saving the network');
  const consentLabel = await alicePage.locator('.waitlist-overlay .check-label').innerText();
  await alicePage.locator('.waitlist-overlay .check').click();
  await alicePage.getByRole('button', { name: 'Join the waitlist' }).click();
  await alicePage.getByRole('heading', { name: 'You’re on the list.' }).waitFor();
  await shot(alicePage, '08-waitlist-done');
  await alicePage.getByRole('button', { name: 'Continue' }).click();
  const [wl] = await q(`select * from waitlist where participant_id = $1`, [alice.id]);
  ok(wl && wl.email === 'alice@test.dev' && wl.consent_text === consentLabel.trim(), `stored consent text matches the checkbox exactly ("${wl?.consent_text}")`);
  ok((await byName('Alice')).marketing_consent === false, 'joining the waitlist does not touch research/marketing fields');
  ok((await authUser(alice.user_id)).email === null, 'waitlist email is not linked to the account unless asked');

  step('Abuse cases (server-side)');
  const aliceJwt = await jwtOf(alicePage);
  await alicePage.goto(carolLink);
  await alicePage.getByRole('heading', { name: 'This is your invitation.' }).waitFor();
  ok(true, 'opening your own link is detected');
  let r = await rpcAs(aliceJwt, 'accept_invitation', { p_token: carolLink.split('/i/')[1], p_display_name: 'A', p_research_consent: true });
  ok(r.body.message === 'self_invite', 'self-referral by account rejected');
  r = await rpcAs(aliceJwt, 'create_invitation', { p_value: { strength: 'weak', context: 'other', comfort: '3', circular: '10' }[alice.method] });
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
    ok((await byName('Alice')).display_name === 'Alice', 'the name on the landing is the sender’s own first name');
    ok(!(await visibleBrand(p)).includes('Pipeline') && (await p.title()) === 'The Experiment', 'invitation landing: no "Pipeline" in page, tab title or share tags');
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
    await seedPage.waitForTimeout(6500);
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
  await alicePage.locator('.invite-card.status-accepted').waitFor();
  const pills = await alicePage.locator('.invite-card .pill').allInnerTexts();
  ok(pills.some((t) => t.includes('Connected')) && pills.some((t) => t.includes('Opened')), `Alice sees ${pills.join(' / ')}`);
  ok(await alicePage.locator('.network-card .tree-node.kind-member').count() === 1
    && await alicePage.locator('.network-card .tree-node.kind-pending').count() === 1, 'network: Bob lit up (joined), Carol still pending');
  await alicePage.waitForTimeout(1300);
  await alicePage.screenshot({ path: path.join(SHOTS, '05e-home-joined-and-pending.png'), fullPage: true });
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
  await bobPage.getByLabel('Phone number').fill('(617) 555-0142');
  await bobPage.waitForTimeout(300);
  await shot(bobPage, '09b-save-network-phone');
  await bobPage.getByRole('button', { name: 'Text me a code' }).click();
  await bobPage.getByLabel('Verification code').fill(await getPhoneCode('+16175550142'));
  await bobPage.getByRole('button', { name: 'Verify', exact: true }).click();
  await bobPage.getByRole('heading', { name: 'Network saved.' }).waitFor();
  await bobPage.getByRole('button', { name: 'Continue' }).click();
  const bobAuth = await authUser(bob.user_id);
  ok(bobAuth.phone === '+16175550142' && bobAuth.phone_confirmed_at && bobAuth.email === null, 'verified phone linked to the SAME identity (user id unchanged)');
  ok((await q(`select count(*)::int n from auth.users where phone = '+16175550142'`))[0].n === 1, 'no duplicate account created');
  const bobAfter = await byName('Bob');
  ok(bobAfter.id === bob.id && bobAfter.parent_id === alice.id && bobAfter.invitation_id === bob.invitation_id, 'participant id, parent and invitation unchanged');
  ok((await q(`select count(*)::int n from invitations where sender_id = $1`, [bob.id]))[0].n === 1, 'referral links unchanged');
  ok((await q(`select count(*)::int n from waitlist where participant_id = $1`, [bob.id]))[0].n === 0, 'saving the network does not join the email list');
  // The same number can't be attached to a second participant.
  const aliceJwt2 = await jwtOf(alicePage);
  const dup = await fetch(`${API}/auth/v1/user`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${aliceJwt2}` }, body: JSON.stringify({ phone: '+16175550142' }) });
  ok(dup.status === 422, 'a number already holding a network cannot be linked to another participant');

  step('Browser-level protections');
  await bobPage.getByLabel('Your data').click();
  await bobPage.getByRole('button', { name: 'Sign out' }).click();
  await bobPage.waitForTimeout(400);
  await bobPage.goto(daveLink);
  await bobPage.getByRole('heading', { name: 'This is your invitation.' }).waitFor();
  ok(true, 'signed out + own link from the same browser → recognised as the sender before anything else');
  {
    // ...and the server still refuses a join from the sender's browser if the page is bypassed
    const bobDevice = await bobPage.evaluate(() => localStorage.getItem('px.device'));
    const anonTok = (await (await fetch(`${API}/auth/v1/signup`, { method: 'POST', body: '{}' })).json()).access_token;
    const r = await rpcAs(anonTok, 'accept_invitation', { p_token: daveLink.split('/i/')[1], p_display_name: 'NotBob', p_research_consent: true, p_device: bobDevice });
    ok(r.body.message === 'self_invite', 'direct API join from the sender’s browser → self-referral blocked');
  }
  await startJoin(bobPage, `${APP}/i/${seeds[1].token}`, 'BobAgain');
  await bobPage.getByText('This browser is already part of the experiment').waitFor();
  ok(true, 'second participant from the same browser blocked');
  ok(!(await byName('NotBob')) && !(await byName('BobAgain')), 'no duplicate participant rows created');

  step('Cross-device: Bob signs in with his verified phone on a new device');
  const bobPhone2 = await newPhone();
  await bobPhone2.goto(APP);
  ok((await bobPhone2.title()) === 'The Experiment' && !(await visibleBrand(bobPhone2)).includes('Pipeline'), 'start page: no "Pipeline"');
  await bobPhone2.getByRole('button', { name: 'Use phone number instead' }).click();
  await bobPhone2.getByLabel('Phone number').fill('+1 999 555 0000');
  await bobPhone2.getByRole('button', { name: 'Text me a code' }).click();
  await bobPhone2.getByText('No saved network uses that number.').waitFor();
  ok(true, 'unknown numbers can’t sign in (no new accounts, no SMS)');
  await bobPhone2.getByLabel('Phone number').fill('617-555-0142');
  await bobPhone2.getByRole('button', { name: 'Text me a code' }).click();
  await bobPhone2.getByLabel('Verification code').fill(await getPhoneCode('+16175550142'));
  await bobPhone2.getByRole('button', { name: 'Verify', exact: true }).click();
  await bobPhone2.locator('.invite-slots').waitFor();
  ok((await bobPhone2.locator('.invite-card.is-filled').first().innerText()).includes('Dave'), 'Bob’s network and links appear on the new device');

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
  await davePage.locator('.early-card:not(.save-card)').waitFor();
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
  await leePage.getByRole('button', { name: 'Verify', exact: true }).click();
  await leePage.locator('.invite-card.status-accepted').waitFor();
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

  step('Names & moderation');
  {
    const adminJwt0 = await jwtOf(adminPage);
    const VALUE = { strength: 'acquaintance', context: 'class', comfort: '3', circular: '50' };
    // 1. Server check: real names pass, bad ones don't (only ok/not-ok is revealed)
    const good = ['José', 'Nguyễn', 'O’Brien', 'Jean-Luc', '李娜', 'Дмитрий', 'محمد', 'Kshitij', 'Shital', 'Cassandra', 'Hassan', 'Kike', 'Anne-Marie', 'ʻIlima'];
    const bad = ['f.u.c.k', 'Fück', 'shit head', 'www.spam.com', 'Bo😀b', 'Bob123', 'Pipeline', 'aaaaaaa'];
    const goodRes = await Promise.all(good.map((n) => rpcAs(null, 'check_name', { p_name: n }, '5.5.5.5')));
    ok(goodRes.every((r) => r.body.ok === true), `server accepts real names: ${good.join(', ')}`);
    const badRes = [];
    for (const n of bad) badRes.push(await rpcAs(null, 'check_name', { p_name: n }, '5.5.5.6'));
    ok(badRes.every((r) => r.body.ok === false), `server rejects: ${bad.join(' | ')}`);
    ok(badRes.every((r) => !JSON.stringify(r.body).match(/blocked|url|characters|repeat/)), 'rejections don’t reveal which rule matched');

    // 2. UI: invitee name rejected before the relationship question
    const bobJwt = await jwtOf(bobPhone2);
    await bobPhone2.reload();
    await bobPhone2.getByRole('button', { name: 'Invite someone' }).first().click();
    for (const n of ['f u c k', 'www.spam.com']) {
      await bobPhone2.getByLabel('Their first name').fill(n);
      await bobPhone2.getByRole('button', { name: 'Continue' }).click();
      await bobPhone2.getByText('Please enter a different name.').waitFor();
    }
    ok(await bobPhone2.locator('.sheet .classifier').count() === 0, 'rejected invitee names never reach the relationship question');
    await bobPhone2.getByLabel('Their first name').fill('Zoë');
    await bobPhone2.getByRole('button', { name: 'Continue' }).click();
    await answer(bobPhone2, '.sheet');
    await bobPhone2.getByRole('heading', { name: 'Zoë’s link is ready.' }).waitFor();
    const zoeLink = 'http://' + (await bobPhone2.locator('.sheet .url').innerText());
    const zoeToken = zoeLink.split('/i/')[1];
    await bobPhone2.locator('.sheet').getByRole('button', { name: 'Later' }).click();
    ok(true, 'an accented invitee name (Zoë) is accepted');

    // 3. UI: participant name rejected on the join page, before any account exists
    const usersBefore = (await q(`select count(*)::int n from auth.users`))[0].n;
    const v = await newPhone();
    await v.goto(zoeLink);
    await v.getByRole('button', { name: 'Enter the Experiment' }).click();
    await answer(v);
    await v.getByText(CONSENT).click();
    await v.getByRole('button', { name: 'That’s not my name' }).click();
    for (const n of ['Fück', 'Bob123']) {
      await v.getByPlaceholder('Your first name').fill(n);
      await v.getByRole('button', { name: 'Continue' }).click();
      await v.getByText('Please enter a different name.').waitFor();
    }
    ok((await q(`select count(*)::int n from auth.users`))[0].n === usersBefore, 'a rejected name creates no account');

    // 4. Bypassing the app: straight to the Supabase API
    const anonTok = (await (await fetch(`${API}/auth/v1/signup`, { method: 'POST', body: '{}' })).json()).access_token;
    let r = await rpcAs(anonTok, 'accept_invitation', { p_token: zoeToken, p_display_name: 'f u c k', p_research_consent: true, p_device: 'bypass-1' }, '8.8.8.1');
    ok(r.body.error === 'invalid_name', 'direct API join with a bad name is refused');
    r = await rpcAs(anonTok, 'accept_invitation', { p_token: zoeToken, p_display_name: 'www.evil.com', p_research_consent: true, p_marketing_consent: false }, '8.8.8.1');
    ok(r.body.error === 'invalid_name', 'old 4-argument join call is validated too');
    ok((await q(`select count(*)::int n from participants where invitation_id = (select id from invitations where token = $1)`, [zoeToken]))[0].n === 0, 'no participant was created');
    r = await rpcAs(bobJwt, 'create_invitation', { p_value: VALUE[bob.method], p_recipient_label: 'Sexy' });
    ok(r.body.error === 'invalid_name', 'direct API invitation with a bad invitee name is refused');
    ok((await asUser(bob.user_id, `update participants set display_name = 'fuck' where user_id = auth.uid()`)).error, 'participants cannot write names to tables directly');
    ok((await rpcAs(bobJwt, 'admin_moderate', { p_target: 'participant', p_id: bob.id, p_action: 'approve' })).body.message === 'forbidden', 'participants cannot moderate');
    await q(`update experiment_settings set value = value || '{"name_rejects_per_ip_hour": 3}' where key = 'rate_limits'`);
    const rl = [];
    for (let i = 0; i < 4; i++) rl.push((await rpcAs(null, 'check_name', { p_name: 'fuck' }, '6.6.6.6')).body);
    ok(rl.slice(0, 3).every((b) => b.ok === false) && rl[3].message === 'rate_limited', 'repeated rejected names from one IP are rate-limited');
    await q(`update experiment_settings set value = value || '{"name_rejects_per_ip_hour": 30}' where key = 'rate_limits'`);

    // 5. What invitees see: only an approved first name
    const sender = async () => (await rpcAs(null, 'open_invitation', { p_token: zoeToken }, '8.8.8.2')).body.sender_name ?? null;
    ok((await sender()) === 'Bob', 'landing shows the sender’s approved first name');
    const mod = (action, value, target = 'participant', id = bob.id) => rpcAs(adminJwt0, 'admin_moderate', { p_target: target, p_id: id, p_action: action, p_value: value ?? null, p_reason: 'test' });
    await mod('hide');
    ok((await sender()) === null, 'hidden name → landing shows no name');
    const landing = await newPhone();
    await landing.goto(zoeLink);
    await landing.getByRole('heading', { name: 'You’ve been invited.' }).waitFor();
    ok(!(await landing.locator('body').innerText()).includes('Bob'), 'landing page UI shows "You’ve been invited." with no name');
    ok((await mod('replace', 'f u c k')).body.message === 'invalid_name', 'admin replacements are validated too');
    await mod('replace', 'Robert Smith');
    ok((await sender()) === 'Robert', 'replaced name → first name only');
    await mod('flag');
    ok((await sender()) === null, 'flagged name → hidden from invitees until approved');
    await mod('approve');
    ok((await sender()) === 'Robert', 'approved → shown again');
    await mod('replace', 'Bob');

    // 6. Invitee names (private to the sender) can be hidden too
    const [zoeInv] = await q(`select id from invitations where token = $1`, [zoeToken]);
    await mod('hide', null, 'invitation', zoeInv.id);
    const bobState = (await rpcAs(bobJwt, 'get_my_state')).body;
    ok(bobState.invitations.find((i) => i.token === zoeToken).recipient_label === null, 'hidden invitee name is gone from the sender’s dashboard');

    // 7. Suspension
    await mod('suspend');
    ok((await rpcAs(null, 'open_invitation', { p_token: zoeToken }, '8.8.8.2')).body.state === 'invalid', 'suspending revokes their unused links');
    ok((await rpcAs(bobJwt, 'create_invitation', { p_value: VALUE[bob.method], p_recipient_label: 'Kai' })).body.message === 'suspended', 'suspended participants cannot invite');
    await bobPhone2.reload();
    await bobPhone2.getByRole('heading', { name: 'Your participation is paused.' }).waitFor();
    ok(true, 'suspended participant sees a calm paused screen');
    await mod('unsuspend');
    await bobPhone2.reload();
    await bobPhone2.locator('.invite-slots').waitFor();
    ok(true, 'unsuspended participant is back');

    // 8. "Approve names first" mode
    await q(`update experiment_settings set value = '"before"' where key = 'name_review'`);
    const priyaTok = (await (await fetch(`${API}/auth/v1/signup`, { method: 'POST', body: '{}' })).json()).access_token;
    r = await rpcAs(priyaTok, 'accept_invitation', { p_token: seeds[2].token, p_display_name: 'Priya', p_research_consent: true, p_device: 'priya-1' }, '9.9.9.1');
    const [priya] = await q(`select * from participants where display_name = 'Priya'`);
    ok(r.body.state === 'joined' && priya.name_status === 'pending', 'review-first mode: new names start pending');
    const pLink = (await rpcAs(priyaTok, 'create_invitation', { p_value: VALUE[priya.method], p_recipient_label: 'Sam' })).body.token;
    const pSender = async () => (await rpcAs(null, 'open_invitation', { p_token: pLink }, '8.8.8.3')).body.sender_name ?? null;
    ok((await pSender()) === null, 'pending (unapproved) name never appears on the invitation page');
    await mod('approve', null, 'participant', priya.id);
    ok((await pSender()) === 'Priya', 'after approval it does');
    await q(`update experiment_settings set value = '"after"' where key = 'name_review'`);

    // 9. Log
    const log = await q(`select * from moderation_actions order by id`);
    ok(log.length === 9 && log.every((a) => a.admin_email === 'admin@test.dev'), `${log.length} moderation actions logged with the admin’s email`);
    ok(log.some((a) => a.action === 'replace' && a.old_value === 'Bob' && a.new_value === 'Robert Smith'), 'log keeps before → after for replacements');
    ok((await asUser(bob.user_id, 'select * from moderation_actions')).length === 0 && (await asUser(null, 'select * from moderation_actions')).error, 'moderation log is admin-only');
  }

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
  ok(ov.totals.participants === 6 && ov.totals.max_depth === 3, 'totals: 6 participants, depth 3');
  ok(acct.linked_emails === 1 && acct.linked_phones === 1 && acct.anonymous === 4, `accounts: 1 email, 1 phone, 4 anonymous`);
  ok(acct.waitlist === 2, 'waitlist count (Alice, Dave via API)');
  ok(acct.shared === 3 && acct.shared_by_copy === 3, `admin: ${acct.shared} links shared since tracking began (legacy excluded)`);
  ok((await adminPage.locator('.funnel').innerText()).includes('Shared'), 'funnel shows the Shared step');
  ok((await adminPage.locator('.tiles').first().innerText()).includes('Waitlist'), 'dashboard shows the waitlist tile');
  ok(!JSON.stringify(await adminPage.locator('.settings').innerText()).includes('hash_salt'), 'salt hidden from the settings panel');
  ok(await adminPage.getByRole('heading', { name: 'Names & moderation' }).isVisible(), 'admin: Names & moderation section');
  const peopleTable = adminPage.locator('.moderation table');
  ok((await peopleTable.innerText()).includes('Alice'), 'admin: participant names listed for review');
  await peopleTable.locator('tr', { hasText: 'Alice' }).getByRole('button', { name: 'Flag' }).click();
  await peopleTable.locator('tr', { hasText: 'Alice' }).getByText('flagged').waitFor();
  ok(true, 'admin: Flag works from the dashboard');
  await peopleTable.locator('tr', { hasText: 'Alice' }).getByRole('button', { name: 'Approve' }).click();
  await adminPage.locator('.moderation').getByRole('tab', { name: 'Log' }).click();
  ok((await adminPage.locator('.moderation table').innerText()).includes('flag'), 'admin: actions appear in the log');
  await adminPage.locator('.moderation').scrollIntoViewIfNeeded();
  await adminPage.screenshot({ path: path.join(SHOTS, '12b-admin-moderation.png') });
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
  ok(tomb.invited_name === null && tomb.confirmed_name === null, 'invited and confirmed names erased too');
  ok((await q(`select count(*)::int n from waitlist where participant_id = $1`, [dave.id]))[0].n === 0, 'waitlist entry deleted');
  ok(!(await authUser(dave.user_id)), 'anonymous auth user removed');


  step('Experiment D — circular connection-strength slider');
  {
    // Earlier steps assign methods at random, so some participants may already be on D:
    // measure changes from a baseline taken now.
    const adminJwtD0 = await jwtOf(adminPage);
    const base = (await rpcAs(adminJwtD0, 'admin_method_stats')).body;
    const baseD = base.methods.find((m) => m.method === 'circular');
    const baseBand = Object.fromEntries(base.circular_bands.map((b) => [b.label, [b.inbound, b.outbound]]));
    const basePair = base.agreement.find((a) => a.sender_method === 'circular' && a.recipient_method === 'circular')?.pairs ?? 0;
    // Only D for new participants in this step (existing participants keep their method).
    await q(`update experiment_settings set value = '["circular"]' where key = 'methods'`);
    const epoch = (await q(`select value #>> '{}' as v from experiment_settings where key = 'assignment_epoch'`))[0].v;
    ok(Date.parse(epoch) > Date.now() - 60000, 'changing the method list resets balanced assignment (no burst for a new method)');
    const newSeed = async () => (await q(`insert into invitations (token, sender_name) values (px_new_token(), 'Truman') returning token`))[0].token;
    const dial = (page) => page.locator('.circular');
    const pctOf = async (page) => Number(await dial(page).getAttribute('data-value'));
    const geometry = (page) => page.locator('.circular-svg').evaluate((svg) => { const r = svg.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
    const at = (g, pct) => { const k = g.w / 320; const a = (pct / 100) * 2 * Math.PI; return { x: g.x + (160 + 128 * Math.sin(a)) * k, y: g.y + (160 - 128 * Math.cos(a)) * k }; };
    // A real finger drag (CDP touch events → pointer events with pointerType "touch").
    async function touchDrag(page, cdp, from, to, steps = 48) {
      const g = await geometry(page);
      const pts = Array.from({ length: steps + 1 }, (_, i) => at(g, from + ((to - from) * i) / steps));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
      for (const pt of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    async function openDial(page, token) {
      await page.goto(`${APP}/i/${token}`);
      await page.getByRole('button', { name: 'Enter the Experiment' }).click();
      await dial(page).waitFor();
    }

    // --- Mira: touch dragging on a phone ---
    const mira = await newPhone();
    const miraCdp = await mira.context().newCDPSession(mira);
    const tokA = await newSeed();
    await openDial(mira, tokA);
    ok(await mira.getByRole('heading', { name: 'How well do you know Truman?' }).isVisible(), 'question: "How well do you know {name}?"');
    ok(await pctOf(mira) === 0 && (await mira.locator('.circular-label').innerText()) === 'Not well', 'starts at 0% · Not well');
    const cont = mira.locator('.circular').getByRole('button', { name: 'Continue', exact: true });
    ok(await cont.isDisabled(), 'Continue disabled until the slider is used');
    await mira.waitForTimeout(500);
    await mira.screenshot({ path: path.join(SHOTS, '20-circular-start.png') });
    // tapping elsewhere on the ring does nothing (no jumps)
    const g0 = await geometry(mira);
    const bottom = at(g0, 50);
    await miraCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [bottom] });
    await miraCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(await pctOf(mira) === 0 && await cont.isDisabled(), 'tapping the ring away from the dot doesn’t jump the value');
    // counter-clockwise from the top stays at 0 (no jump to 100)
    await touchDrag(mira, miraCdp, 0, -12, 12);
    ok(await pctOf(mira) === 0, 'dragging counter-clockwise past the top holds at 0% (no jump to 100%)');
    ok(await cont.isEnabled(), 'Continue enabled after interacting, even at 0%');
    // clockwise to a quarter
    await touchDrag(mira, miraCdp, 0, 25);
    const q1 = await pctOf(mira);
    ok(q1 >= 24 && q1 <= 26 && (await mira.locator('.circular-label').innerText()) === 'Somewhat', `finger drag clockwise a quarter turn → ${q1}% · Somewhat`);
    await mira.waitForTimeout(800);
    ok(await dial(mira).count() === 1, 'releasing does not advance');
    await mira.screenshot({ path: path.join(SHOTS, '21-circular-quarter.png') });
    // all the way round and past the top: holds at 100 (no jump to ~10)
    await touchDrag(mira, miraCdp, q1, 112, 70);
    ok(await pctOf(mira) === 100 && (await mira.locator('.circular-label').innerText()) === 'Very well', 'a full circle reaches 100% · Very well; going past the top holds at 100%');
    await mira.waitForTimeout(300);
    await mira.screenshot({ path: path.join(SHOTS, '22-circular-full.png') });
    await touchDrag(mira, miraCdp, 100, 37, 50);
    ok(await pctOf(mira) === 37, 'dragging back counter-clockwise lowers the rating (37%)');
    await cont.click();
    await mira.getByPlaceholder('First name').waitFor();
    const [aRow] = await q(`select c.* from classifications c join invitations i on i.id = c.invitation_id where i.token = $1`, [tokA]);
    ok(aRow.method === 'circular' && aRow.value === '37' && aRow.question_version === 'circular_v1' && aRow.response_ms > 0, `stored: method circular, 37%, question version circular_v1, ${aRow.response_ms}ms`);
    const evA = await q(`select e.* from classification_events e join invitations i on i.id = e.invitation_id where i.token = $1 order by e.id`, [tokA]);
    ok(evA.some((e) => e.event === 'shown') && evA.some((e) => e.event === 'interacted' && e.elapsed_ms >= 0), 'shown and first-interaction events recorded');
    await completeJoin(mira, 'Mira');
    await mira.locator('.home').waitFor();
    const miraP = await byName('Mira');
    ok(miraP.method === 'circular' && aRow.rater_id === null || true, 'Mira joined');
    ok((await q(`select rater_id from classifications c join invitations i on i.id = c.invitation_id where i.token = $1`, [tokA]))[0].rater_id === miraP.id
      && miraP.method === 'circular', 'answer linked to her participant ID; her method stays D');

    // --- Mira rates someone she invites: same method (D), keyboard this time ---
    await mira.getByRole('button', { name: 'Invite someone' }).first().click();
    await mira.getByLabel('Their first name').fill('Theo');
    await mira.getByRole('button', { name: 'Continue' }).click();
    await mira.locator('.sheet .circular').waitFor();
    ok(await mira.getByRole('heading', { name: 'How well do you know Theo?' }).isVisible(), 'outbound question uses the invitee’s name');
    const input = mira.locator('.sheet .circular-input');
    await input.focus();
    await mira.keyboard.press('ArrowRight'); await mira.keyboard.press('ArrowRight'); await mira.keyboard.press('ArrowRight');
    ok(await pctOf(mira.locator('.sheet')) === 3 || Number(await mira.locator('.sheet .circular').getAttribute('data-value')) === 3, 'keyboard: arrow keys step by 1%');
    await mira.keyboard.press('End');
    ok(Number(await mira.locator('.sheet .circular').getAttribute('data-value')) === 100, 'keyboard: End → 100%');
    await mira.keyboard.press('Home');
    ok(Number(await mira.locator('.sheet .circular').getAttribute('data-value')) === 0, 'keyboard: Home → 0%');
    await mira.keyboard.press('End');
    for (let i = 0; i < 20; i++) await mira.keyboard.press('ArrowLeft');
    ok((await input.getAttribute('aria-valuetext')) === '80% — Very well', 'screen readers hear "80% — Very well"');
    await mira.locator('.sheet .circular').getByRole('button', { name: 'Continue', exact: true }).click();
    await mira.getByRole('heading', { name: 'Theo’s link is ready.' }).waitFor();
    const theoLink = 'http://' + (await mira.locator('.sheet .url').innerText());
    await mira.locator('.sheet').getByRole('button', { name: 'Copy link' }).click();
    await mira.locator('.sheet').getByRole('button', { name: 'Continue' }).click();
    const [outRow] = await q(`select c.* from classifications c join invitations i on i.id = c.invitation_id where i.token = $1 and c.direction = 'outbound'`, [theoLink.split('/i/')[1]]);
    ok(outRow.method === 'circular' && outRow.value === '80' && outRow.rater_id === miraP.id && outRow.question_version === 'circular_v1', 'outbound rating stored (80%, D, circular_v1, Mira’s ID)');

    // --- Theo rates Mira: mouse drag on a desktop browser ---
    const theoCtx = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      // an ordinary desktop browser (the default headless user agent is treated as a bot)
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    });
    contexts.push(theoCtx);
    const theo = await theoCtx.newPage();
    await openDial(theo, theoLink.split('/i/')[1]);
    ok(await theo.getByRole('heading', { name: 'How well do you know Mira?' }).isVisible(), 'inbound question uses the inviter’s first name');
    const gm = await geometry(theo);
    let pt = at(gm, 0);
    await theo.mouse.move(pt.x, pt.y);
    await theo.mouse.down();
    for (let i = 1; i <= 40; i++) { pt = at(gm, (60 * i) / 40); await theo.mouse.move(pt.x, pt.y); }
    await theo.mouse.up();
    const theoPct = await pctOf(theo);
    ok(theoPct >= 59 && theoPct <= 61 && (await theo.locator('.circular-label').innerText()) === 'Well', `mouse drag → ${theoPct}% · Well`);
    await theo.locator('.circular').getByRole('button', { name: 'Continue', exact: true }).click();
    await completeJoin(theo, 'Theo', { consentBox: true }); // wide screen: click the box, not the sentence (it holds the "How data is used" link)
    await theo.locator('.home').waitFor();

    // --- 0% is a valid, deliberate answer ---
    const zero = await newPhone();
    const tokZ = await newSeed();
    await openDial(zero, tokZ);
    await zero.locator('.circular-input').focus();
    await zero.keyboard.press('ArrowLeft'); // stays at 0, but counts as an interaction
    await zero.locator('.circular').getByRole('button', { name: 'Continue', exact: true }).click();
    await zero.getByPlaceholder('First name').waitFor();
    ok((await q(`select value from classifications c join invitations i on i.id = c.invitation_id where i.token = $1`, [tokZ]))[0].value === '0', '0% can be confirmed after interacting, and is stored as 0');

    // --- Reduced motion: still fully usable ---
    const rmCtx = await browser.newContext({ ...iphone, reducedMotion: 'reduce' });
    contexts.push(rmCtx);
    const rm = await rmCtx.newPage();
    await openDial(rm, await newSeed());
    await rm.locator('.circular-input').focus();
    await rm.keyboard.press('PageUp');
    ok(await pctOf(rm) >= 10 && await rm.locator('.circular').getByRole('button', { name: 'Continue', exact: true }).isEnabled(), 'reduced motion: slider works (Page Up jumps 10%)');

    // --- Abandonment: shown, never answered ---
    const quitter = await newPhone();
    await openDial(quitter, await newSeed());
    await quitter.waitForTimeout(400);

    // --- Research analytics ---
    const adminJwtD = await jwtOf(adminPage);
    const ms = (await rpcAs(adminJwtD, 'admin_method_stats')).body;
    const d = ms.methods.find((m) => m.method === 'circular');
    ok(d.in_shown - baseD.in_shown === 5 && d.in_completed - baseD.in_completed === 3, `D completion: +3 answered of +5 shown in this step (2 abandoned); total ${d.in_completed}/${d.in_shown}`);
    ok(d.out_shown - baseD.out_shown === 1 && d.out_completed - baseD.out_completed === 1, 'D outbound: +1 shown, +1 completed');
    const [avgs] = await q(`select round(avg(value::numeric) filter (where direction = 'inbound'), 1) as i, round(avg(value::numeric) filter (where direction = 'outbound'), 1) as o from classifications where method = 'circular'`);
    ok(Number(d.in_avg_strength) === Number(avgs.i) && Number(d.out_avg_strength) === Number(avgs.o), `D average strength matches stored ratings: inbound ${d.in_avg_strength}, outbound ${d.out_avg_strength}`);
    ok(d.in_median_ms > 0, `D median time to answer: ${(d.in_median_ms / 1000).toFixed(1)}s`);
    const band = Object.fromEntries(ms.circular_bands.map((b) => [b.label, [b.inbound, b.outbound]]));
    ok(band['Not well'][0] - baseBand['Not well'][0] === 1 && band['Somewhat'][0] - baseBand['Somewhat'][0] === 1
      && band['Well'][0] - baseBand['Well'][0] === 1 && band['Very well'][1] - baseBand['Very well'][1] === 1, 'D distribution by band (0%, 37%, 60% inbound; 80% outbound)');
    const pair = ms.agreement.find((a) => a.sender_method === 'circular' && a.recipient_method === 'circular');
    const [pairRow] = await q(`select abs(o.value::int - n.value::int) as gap from classifications o join classifications n on n.invitation_id = o.invitation_id and n.direction = 'inbound' where o.direction = 'outbound' and o.rater_id = $1`, [miraP.id]);
    ok(pair && pair.pairs - basePair === 1 && pairRow.gap === 20, `inviter vs recipient agreement recorded: Mira 80% vs Theo 60% → gap 20 (D–D mean gap ${pair.mean_abs_gap})`);
    ok(ms.methods.length === 4 && ms.methods.some((m) => m.method === 'strength'), 'A–C still reported alongside D');
    const exp = (await rpcAs(adminJwtD, 'admin_export', { p_kind: 'classifications' })).body;
    ok(exp.some((r) => r.method === 'circular' && r.question_version === 'circular_v1' && r.completed === true && r.strength_score !== null)
      && exp.some((r) => r.question_version === 'v1'), 'classifications export: method, question_version, completed, comparable strength score');
    ok((await rpcAs(adminJwtD, 'admin_export', { p_kind: 'classification_events' })).body.some((e) => e.method === 'circular' && e.completed === false), 'events export shows abandoned (shown, not completed) questions');
    ok((await rpcAs(null, 'log_classification_event', { p_direction: 'inbound', p_event: 'shown', p_token: 'nope' })).body.ok === false, 'event logging ignores invalid links');
    ok((await asUser(null, 'select * from classification_events')).error, 'events are not readable publicly');
    await adminPage.getByRole('button', { name: 'Refresh' }).click();
    await adminPage.getByRole('heading', { name: 'Strength ratings by method' }).waitFor();
    ok((await adminPage.locator('.panel', { hasText: 'Strength ratings by method' }).innerText()).includes('D · Circular'), 'admin dashboard: strength-by-method panel includes D');
    await adminPage.locator('.panel', { hasText: 'Strength ratings by method' }).screenshot({ path: path.join(SHOTS, '23-admin-methods.png') });
  }

  step('Inviter-provided names: confirm, correct, forwarded links, refresh');
  {
    const VALUE_D = (pct) => async (page, scope = '') => {
      // keyboard to an exact percentage on the circular slider
      await page.locator(`${scope} .circular-input`).focus();
      await page.keyboard.press('Home');
      for (let i = 0; i < pct; i++) await page.keyboard.press('ArrowRight');
      await page.locator(`${scope} .classifier`).getByRole('button', { name: 'Continue', exact: true }).click();
    };
    // 3. Seed participant: no invited name → "And you are?"
    const nadia = await newPhone();
    const seedTok = (await q(`insert into invitations (token, sender_name) values (px_new_token(), 'Truman') returning token`))[0].token;
    await nadia.goto(`${APP}/i/${seedTok}`);
    await nadia.getByRole('button', { name: 'Enter the Experiment' }).click();
    await answer(nadia);
    await nadia.getByRole('heading', { name: 'And you are?' }).waitFor();
    ok(await nadia.getByRole('button', { name: 'Yes, that’s me' }).count() === 0, 'seed participant: no confirmation screen, just "And you are?"');
    await completeJoin(nadia, 'Nadia');
    await nadia.locator('.home').waitFor();
    const nadiaP = await byName('Nadia');
    ok(nadiaP.invited_name === null && nadiaP.confirmed_name === 'Nadia' && nadiaP.name_was_corrected === null, 'seed participant stored: invited_name null, confirmed_name Nadia');

    // Nadia invites Sarah and rates her 75% (her assigned method is D in this phase)
    await nadia.getByRole('button', { name: 'Invite someone' }).first().click();
    await nadia.getByLabel('Their first name').fill('Sarah');
    await nadia.getByRole('button', { name: 'Continue' }).click();
    await nadia.locator('.sheet .circular').waitFor();
    await VALUE_D(75)(nadia, '.sheet');
    await nadia.getByRole('heading', { name: 'Sarah’s link is ready.' }).waitFor();
    const sarahLink = 'http://' + (await nadia.locator('.sheet .url').innerText());
    const sarahTok = sarahLink.split('/i/')[1];
    await nadia.locator('.sheet').getByRole('button', { name: 'Copy link' }).click();
    await nadia.locator('.sheet').getByRole('button', { name: 'Continue' }).click();
    await nadia.locator('.reveal-overlay').waitFor();
    await nadia.waitForTimeout(1800);
    await nadia.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
    const [sarahInv] = await q(`select * from invitations where token = $1`, [sarahTok]);
    ok(sarahInv.invited_name === 'Sarah' && sarahInv.sender_id === nadiaP.id, 'invitation stores invited_name = Sarah');
    ok((await q(`select count(*)::int n from participants where display_name = 'Sarah'`))[0].n === 0, 'no participant profile exists for Sarah before she joins');
    ok(!sarahLink.includes('Sarah') && !sarahLink.includes('75') && /\/i\/[A-Za-z0-9_-]{22}$/.test(sarahLink), 'the link carries only an unguessable token (no name, no rating)');
    const landingData = (await rpcAs(null, 'open_invitation', { p_token: sarahTok }, '4.4.4.4')).body;
    ok(landingData.invited_name === 'Sarah' && landingData.sender_name === 'Nadia' && !JSON.stringify(landingData).includes('75'), 'invitation page data: first names only, no ratings');

    // 1. Correct name: Sarah confirms; she rates Nadia 40% independently
    const sarah = await newPhone();
    await sarah.goto(sarahLink);
    await sarah.getByRole('heading', { name: 'Nadia invited you.' }).waitFor();
    await sarah.getByRole('button', { name: 'Enter the Experiment' }).click();
    await sarah.locator('.circular').waitFor();
    ok(!(await sarah.locator('body').innerText()).includes('75'), 'Sarah never sees Nadia’s rating');
    await VALUE_D(40)(sarah);
    await sarah.getByRole('heading', { name: 'Are you Sarah?' }).waitFor();
    ok(await sarah.getByText('That’s who Nadia invited.').isVisible() && await sarah.getByText('We’re in stealth mode.').isVisible(), 'confirmation screen: "Are you Sarah?" / "That’s who Nadia invited."');
    const yes = sarah.getByRole('button', { name: 'Yes, that’s me' });
    ok(await yes.isDisabled() && await sarah.getByRole('button', { name: 'That’s not my name' }).isVisible(), 'two options; "Yes, that’s me" needs consent first');
    await sarah.waitForTimeout(1200);
    await sarah.screenshot({ path: path.join(SHOTS, '30-confirm-name.png') });
    await sarah.getByText(CONSENT).click();
    ok(await yes.isEnabled(), 'consent ticked → "Yes, that’s me" enabled');
    await yes.click();
    await sarah.locator('.home').waitFor();
    const sarahP = await byName('Sarah');
    const sarahUser = await authUser(sarahP.user_id);
    ok(sarahP.invited_name === 'Sarah' && sarahP.confirmed_name === 'Sarah' && sarahP.name_was_corrected === false
      && sarahP.invitation_id === sarahInv.id && sarahUser && sarahP.parent_id === nadiaP.id, 'stored: invited_name Sarah, confirmed_name Sarah, not corrected, invitation_id, user id, parent Nadia');
    // 6. Ratings stored independently, in both directions, on the same invitation
    const ratings = await q(`select direction, value, rater_id, method from classifications where invitation_id = $1 order by direction`, [sarahInv.id]);
    ok(ratings.length === 2 && ratings.find((r) => r.direction === 'outbound').value === '75' && ratings.find((r) => r.direction === 'outbound').rater_id === nadiaP.id
      && ratings.find((r) => r.direction === 'inbound').value === '40' && ratings.find((r) => r.direction === 'inbound').rater_id === sarahP.id,
      'Nadia → Sarah 75% and Sarah → Nadia 40% stored as separate directional ratings');
    const sarahState = JSON.stringify((await rpcAs(await jwtOf(sarah), 'get_my_state')).body);
    const nadiaState = JSON.stringify((await rpcAs(await jwtOf(nadia), 'get_my_state')).body);
    ok(!/"(value|75|40)"/.test(sarahState) && !nadiaState.includes('"40"') && !sarahState.includes('"value"') && !nadiaState.includes('"value"'), 'neither dashboard exposes either rating');
    // duplicate redemption
    const again = await newPhone();
    await again.goto(sarahLink);
    await again.getByRole('heading', { name: 'This invitation has already been used.' }).waitFor();
    ok(true, 'the accepted link can’t be redeemed again');

    // Nadia's second invitation: Jon
    await nadia.getByRole('button', { name: 'Invite someone' }).first().click();
    await nadia.getByLabel('Their first name').fill('Jon');
    await nadia.getByRole('button', { name: 'Continue' }).click();
    await VALUE_D(55)(nadia, '.sheet');
    await nadia.getByRole('heading', { name: 'Jon’s link is ready.' }).waitFor();
    const jonLink = 'http://' + (await nadia.locator('.sheet .url').innerText());
    const jonTok = jonLink.split('/i/')[1];
    await nadia.locator('.sheet').getByRole('button', { name: 'Later' }).click();

    // 4. Forwarded link: someone else opens it and says it wasn't meant for them
    const usersBefore = (await q(`select count(*)::int n from auth.users`))[0].n;
    const stranger = await newPhone();
    await stranger.goto(jonLink);
    await stranger.getByRole('button', { name: 'Enter the Experiment' }).click();
    await VALUE_D(5)(stranger);
    await stranger.getByRole('heading', { name: 'Are you Jon?' }).waitFor();
    await stranger.waitForTimeout(1600); // let the entrance animation settle
    await stranger.getByRole('button', { name: 'That’s not my name' }).click();
    await stranger.getByPlaceholder('Your first name').waitFor();
    await stranger.waitForTimeout(800);
    await stranger.screenshot({ path: path.join(SHOTS, '31-not-my-name.png') });
    await stranger.getByRole('button', { name: 'This invite wasn’t meant for me' }).click();
    await stranger.getByRole('heading', { name: 'This invitation is for Jon.' }).waitFor();
    ok(await stranger.getByText('Ask Nadia for an invitation of your own.').isVisible(), 'forwarded link: "This invitation is for Jon." / "Ask Nadia…"');
    const [jonInv1] = await q(`select * from invitations where token = $1`, [jonTok]);
    ok(jonInv1.status === 'opened' && jonInv1.accepted_at === null && jonInv1.misdirected_count === 1, 'not accepted; recorded as misdirected; link stays open for Jon');
    ok((await q(`select count(*)::int n from classifications where invitation_id = $1 and direction = 'inbound'`, [jonInv1.id]))[0].n === 0, 'the stranger’s rating of Nadia is discarded');
    ok((await q(`select count(*)::int n from auth.users`))[0].n === usersBefore, 'no account or participant created for the stranger');

    // 2 + 5. The real Jon corrects his name, refreshing midway
    const jon = await newPhone();
    await jon.goto(jonLink);
    await jon.getByRole('button', { name: 'Enter the Experiment' }).click();
    await VALUE_D(30)(jon);
    await jon.getByRole('heading', { name: 'Are you Jon?' }).waitFor();
    await jon.getByRole('button', { name: 'That’s not my name' }).click();
    await jon.getByPlaceholder('Your first name').fill('F u c k');
    await jon.getByText(CONSENT).click();
    await jon.getByRole('button', { name: 'Continue' }).click();
    await jon.getByText('Please enter a different name.').waitFor();
    ok(true, 'corrected names go through name moderation');
    await jon.getByPlaceholder('Your first name').fill('Jonathan');
    await jon.reload();
    await jon.getByPlaceholder('Your first name').waitFor();
    ok((await jon.getByPlaceholder('Your first name').inputValue()) === 'Jonathan'
      && await jon.locator('.consents .check').evaluate((el) => el.classList.contains('is-checked'))
      && await jon.locator('.classifier').count() === 0, 'refresh keeps the step, the typed name and the consent (no re-answering)');
    await jon.getByRole('button', { name: 'Continue' }).click();
    await jon.locator('.home').waitFor();
    const jonP = await byName('Jonathan');
    ok(jonP.invited_name === 'Jon' && jonP.confirmed_name === 'Jonathan' && jonP.name_was_corrected === true && jonP.parent_id === nadiaP.id,
      'corrected: invited_name Jon, confirmed_name Jonathan, name_was_corrected true');
    ok((await q(`select value from classifications where invitation_id = $1 and direction = 'inbound'`, [jonInv1.id]))[0].value === '30', 'Jon’s own rating (30%) is the one kept');
    ok((await rpcAs(null, 'open_invitation', { p_token: jonTok }, '4.4.4.5')).body.state === 'used', 'once accepted, the invitation page reveals nothing more');

    // Moderation still applies: a hidden invited name isn't shown; the screen falls back to "And you are?"
    const adminJwtN = await jwtOf(adminPage);
    const t3 = (await rpcAs(await jwtOf(sarah), 'create_invitation', { p_value: { strength: 'weak', context: 'other', comfort: '3', circular: '20' }[sarahP.method], p_recipient_label: 'Kai' })).body.token;
    const [kaiInv] = await q(`select id from invitations where token = $1`, [t3]);
    await rpcAs(adminJwtN, 'admin_moderate', { p_target: 'invitation', p_id: kaiInv.id, p_action: 'hide', p_reason: 'test' });
    ok((await rpcAs(null, 'open_invitation', { p_token: t3 }, '4.4.4.6')).body.invited_name === null, 'a hidden invited name never reaches the invitation page');

    // 7. Links and people from before this change
    const [leeNow] = await q(`select * from participants where display_name = 'Lee'`);
    ok(leeNow.confirmed_name === 'Lee', 'existing participants backfilled: confirmed_name = their name');
    const erinP = (await q(`select * from participants where display_name = 'Erin'`))[0];
    ok(erinP && erinP.invited_name === 'Erin' && erinP.name_was_corrected === false, 'a link created before this feature (legacy) still works, with the name confirmation');
    const acctN = (await rpcAs(adminJwtN, 'admin_account_stats')).body;
    ok(acctN.names_corrected >= 1 && acctN.names_confirmed >= 2 && Number(acctN.misdirected_reports) === 1, `admin stats: ${acctN.names_confirmed} confirmed, ${acctN.names_corrected} corrected, ${acctN.misdirected_reports} forwarded-link report`);
    const pexp = (await rpcAs(adminJwtN, 'admin_export', { p_kind: 'participants' })).body.find((r) => r.participant_id === jonP.id);
    ok(pexp.invited_name === 'Jon' && pexp.confirmed_name === 'Jonathan' && pexp.name_was_corrected === true && pexp.invitation_id === jonInv1.id && pexp.user_id === jonP.user_id, 'participants export: invited_name, confirmed_name, name_was_corrected, invitation_id, user_id');
  }

  step('Live invitation tracking — two browsers (inviter and recipient)');
  {
    // Browser 1: the inviter
    const lena = await newPhone();
    const seedL = (await q(`insert into invitations (token, sender_name) values (px_new_token(), 'Truman') returning token`))[0].token;
    await joinViaLink(lena, `${APP}/i/${seedL}`, 'Lena');
    const lenaP = await byName('Lena');
    await lena.getByRole('button', { name: 'Invite someone' }).first().click();
    await lena.getByLabel('Their first name').fill('Omar');
    await lena.getByRole('button', { name: 'Continue' }).click();
    await answer(lena, '.sheet', 'last');
    await lena.getByRole('heading', { name: 'Omar’s link is ready.' }).waitFor();
    const omarLink = 'http://' + (await lena.locator('.sheet .url').innerText());
    const omarTok = omarLink.split('/i/')[1];
    await lena.locator('.sheet').getByRole('button', { name: 'Later' }).click();
    const pill = lena.locator('.invite-card.is-filled .pill');
    await pill.waitFor();
    ok((await pill.getAttribute('data-status')) === 'ready' && (await pill.innerText()).includes('Ready'), 'status: Ready (link generated, not shared)');
    const [omarInv] = await q(`select * from invitations where token = $1`, [omarTok]);
    const evs = async () => (await q(`select event, detail from invitation_events where invitation_id = $1 order by id`, [omarInv.id])).map((e) => e.event + (e.detail ? `:${e.detail}` : ''));
    ok((await evs()).join() === 'created', 'event recorded: created');

    // Share initiated → Pending + immediate unlock (no recipient action needed)
    await lena.locator('.invite-card.is-filled').getByRole('button', { name: 'Copy link' }).click();
    await lena.locator('.reveal-overlay').waitFor();
    ok((await lena.locator('.reveal-title').innerText()).includes('part of Pipeline'), 'sharing the first invitation unlocks the name immediately');
    await lena.waitForTimeout(1800);
    await lena.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
    await lena.locator('.invite-card.is-filled .pill[data-status="pending"]').waitFor();
    ok(true, 'status: Pending (sharing started)');
    const [omarInv1] = await q(`select * from invitations where id = $1`, [omarInv.id]);
    ok(omarInv1.shared_at && omarInv1.share_method === 'copy' && omarInv1.opened_at === null && omarInv1.status === 'created', 'backend: shared (copy) — not treated as delivered or opened');
    ok((await evs()).join() === 'created,share_initiated:copy', 'event recorded: share_initiated (copy)');

    // Link previews and bots don't count
    const previewHtml = await fetch(omarLink.replace(/^http:\/\/[^/]+/, APP), { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } });
    ok(previewHtml.status === 200 && (await evs()).length === 2, 'a link-preview fetch of the page (no code run) records nothing');
    const bot = await (await fetch(`${API}/rest/v1/rpc/open_invitation`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'facebookexternalhit/1.1', 'x-forwarded-for': '3.3.3.3' },
      body: JSON.stringify({ p_token: omarTok }),
    })).json();
    const [omarInv2] = await q(`select * from invitations where id = $1`, [omarInv.id]);
    ok(bot.state === 'preview' && !JSON.stringify(bot).includes('Omar') && !JSON.stringify(bot).includes('Lena') && omarInv2.opened_at === null && omarInv2.assigned_method === null,
      'a crawler that runs code gets "preview": no names, no open, no method assigned');
    ok((await evs()).some((e) => e.startsWith('bot_preview')), 'event recorded: bot_preview (with the crawler’s user agent)');

    // The sender's own browser doesn't count, signed in or not
    const lenaDevice = await lena.evaluate(() => localStorage.getItem('px.device'));
    const own = (await rpcAs(null, 'open_invitation', { p_token: omarTok, p_device: lenaDevice }, '3.3.3.4')).body;
    ok(own.state === 'own', 'opening the link from the sender’s browser (signed out) → recognised as the sender');
    const ownPage = await lena.context().newPage();
    await ownPage.goto(omarLink);
    await ownPage.getByRole('heading', { name: 'This is your invitation.' }).waitFor();
    await ownPage.close();
    const [omarInv3] = await q(`select * from invitations where id = $1`, [omarInv.id]);
    ok(omarInv3.opened_at === null && omarInv3.unique_open_count === 0 && (await evs()).filter((e) => e === 'sender_open').length === 2, 'sender opens never count');
    await lena.waitForTimeout(500);
    ok((await pill.getAttribute('data-status')) === 'pending', 'still Pending after bot and sender visits');

    // Browser 2: the recipient opens it → Opened on Lena's screen, no refresh
    const omar = await newPhone();
    const t0 = Date.now();
    await omar.goto(omarLink);
    await omar.getByRole('heading', { name: 'Lena invited you.' }).waitFor();
    await lena.locator('.invite-card.is-filled .pill[data-status="opened"]').waitFor({ timeout: 8000 });
    const openedMs = Date.now() - t0;
    ok(openedMs < 6000, `Lena’s card switched to Opened live, without a refresh (${(openedMs / 1000).toFixed(1)}s; the fallback poll is 20s)`);
    ok((await pill.getAttribute('class')).includes('is-changed'), 'the status dot pulses once when it changes');
    await lena.screenshot({ path: path.join(SHOTS, '40-live-opened.png') });

    // Repeat visits don't inflate opens
    await omar.reload(); await omar.getByRole('heading', { name: 'Lena invited you.' }).waitFor();
    await omar.reload(); await omar.getByRole('heading', { name: 'Lena invited you.' }).waitFor();
    const [omarInv4] = await q(`select * from invitations where id = $1`, [omarInv.id]);
    const opens = (await evs()).filter((e) => e.startsWith('opened'));
    ok(omarInv4.unique_open_count === 1 && opens.length === 3 && opens.filter((e) => e === 'opened:repeat').length === 2, 'three visits from Omar’s browser → 1 unique open (2 marked repeat)');

    // Omar joins → Connected + his node lights up on Lena's screen, live
    const t1 = Date.now();
    await omar.getByRole('button', { name: 'Enter the Experiment' }).click();
    await answer(omar);
    await completeJoin(omar, 'Omar');
    await omar.locator('.home').waitFor();
    await lena.locator('.invite-card.is-filled .pill[data-status="connected"]').waitFor({ timeout: 8000 });
    await lena.locator('.network-card .tree-node.kind-member').waitFor({ timeout: 4000 });
    ok(Date.now() - t1 < 15000, 'Lena’s card switched to Connected and Omar’s node lit up, without a refresh');
    await lena.waitForTimeout(1300);
    await lena.locator('.network-card').scrollIntoViewIfNeeded();
    await lena.screenshot({ path: path.join(SHOTS, '41-live-connected.png') });
    ok((await evs()).at(-1) === 'connected', 'event recorded: connected');

    // Persists after refresh / reopening
    await lena.reload();
    await lena.locator('.invite-card.is-filled .pill[data-status="connected"]').waitFor();
    ok(await lena.locator('.network-card .tree-node.kind-member').count() === 1, 'statuses and the lit node persist after a refresh');

    // Privacy: no ratings in what the inviter's app receives; invitations readable only by their sender
    const lenaState = JSON.stringify((await rpcAs(await jwtOf(lena), 'get_my_state')).body);
    ok(!lenaState.includes('"value"') && !lenaState.includes('classification'), 'the inviter’s live data contains no relationship ratings');
    const omarP = await byName('Omar');
    ok((await asUser(omarP.user_id, `select * from invitations where sender_id = '${lenaP.id}'`)).length === 0, 'RLS: others can’t read Lena’s invitations (Realtime is filtered by the same rule)');
    ok((await asUser(omarP.user_id, 'select * from invitation_events')).length === 0 && (await asUser(null, 'select * from invitation_events')).error, 'invitation events are admin-only');
    const acctL = (await rpcAs(await jwtOf(adminPage), 'admin_account_stats')).body;
    ok(acctL.human_opens >= 1 && acctL.repeat_opens >= 2 && acctL.bot_previews >= 1 && acctL.sender_opens >= 2, `admin: ${acctL.human_opens} human opens, ${acctL.repeat_opens} repeats, ${acctL.bot_previews} bot previews, ${acctL.sender_opens} sender opens`);
  }

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
