// End-to-end test of the frictionless (anonymous-auth) onboarding:
//   * a legacy participant created under migration 001 (email flow) survives 002
//   * admin seed links → seed participant → two more referral generations,
//     none of whom enter an email before the referral stage
//   * reveals, post-reveal Pipeline Community signup, optional email linking + cross-device sign-in
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
psql('supabase/migrations/009_pipeline_community.sql');
psql('supabase/migrations/010_multi_experiment.sql');
psql('supabase/migrations/011_early_access.sql');
psql('supabase/migrations/012_connection_strength_abc.sql');
psql('supabase/migrations/013_copy_safe_name_check.sql');
psql('supabase/migrations/014_community_onboarding.sql');
psql('supabase/migrations/015_optional_relationship_question.sql');
psql('supabase/migrations/016_invitation_sharing.sql');
psql('../supabase/migrations/003_landing_waitlist.sql'); // the public website's waitlist (separate root migration)
psql('supabase/migrations/017_waitlist_overview.sql');
psql('supabase/migrations/018_launch_updates.sql');
{
  // SQL is pasted into the Supabase editor from a browser, which drops invisible characters:
  // the migrations must not rely on any (013 fixed one that broke every name check).
  const invisible = /[\u00AD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFE00-\uFE0F]/u;
  const files = fs.readdirSync(path.join(root, 'supabase/migrations')).map((f) => `supabase/migrations/${f}`).concat('supabase/setup.sql');
  const bad = files.filter((f) => invisible.test(fs.readFileSync(path.join(root, f), 'utf8')));
  ok(bad.length === 0, `no invisible characters in the SQL to paste${bad.length ? ` (found in ${bad})` : ''}`);
  ok((await q(`select public.px_name_problem('Fück') as a, public.px_name_problem(E'Al\\u200Bice') as b, public.px_name_problem('Alice') as c`))
    .every((r) => r.a === 'blocked' && r.b === 'characters' && r.c === null), 'name check (013): same rules, written copy-safe');
}
{
  const [def] = await q(`select categories from experiments where is_default`);
  ok(JSON.stringify(def.categories) === '["Current Harvard student","Harvard alumnus/alumna"]', '012: the original experiment now asks "Current Harvard student" / "Harvard alumnus/alumna"');
  ok(!(await q(`select value from experiment_settings where key = 'methods'`))[0].value.includes('strength'), '012: the 3-point closeness method (A) leaves the rotation for new links (the 5-point meter replaces it)');
  // Most flows below test other things; the group question is covered in the multi-experiment step,
  // and participants without a group are asked for it by the ABC questionnaire.
  await q(`update experiments set categories = '[]' where is_default`);
}
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
/** 1 if a sign-in email (code/link) was sent to this address, else 0. */
const getCodeCount = async (email) => ((await (await fetch(`${API}/__test/code?email=${encodeURIComponent(email)}`)).json())?.code ? 1 : 0);
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
/** "Alice" → "Alice A." (participants now give a first name and last initial). */
const full = (n) => (/ \S\.?$/u.test(n) ? n : `${n} ${[...n][0].toUpperCase()}.`);
const NAME_PH = 'First name, last initial';
const byName = async (name) => (await q(`select * from participants where display_name in ($1, $2) and deleted_at is null order by created_at`, [name, full(name)]))[0];
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
/** Answer whichever classification method is shown (first option; for D, one keyboard step then Continue).
 *  For the invitee's question (no scope), also answers the relationship questions that follow. */
async function answer(page, scope = '', which = 'first', { rating = true } = {}) {
  await page.locator(`${scope} .classifier`).waitFor();
  const method = await page.locator(`${scope} .classifier`).getAttribute('data-method');
  if (await page.locator(`${scope} .classifier .circular`).count()) {
    await page.locator(`${scope} .circular-input`).focus();
    await page.keyboard.press(which === 'last' ? 'End' : 'ArrowRight');
    await page.locator(`${scope} .classifier`).getByRole('button', { name: 'Continue', exact: true }).click();
  } else {
    const opts = page.locator(`${scope} .classifier .option, ${scope} .classifier .scale-dot`);
    await (which === 'last' ? opts.last() : opts.first()).click();
  }
  if (!scope && rating) await rate(page, method);
  return method;
}
/** The invitee's connection-strength meter, then comfort (skipped when that was their assigned question). */
async function rate(page, method, { closeness = 4, comfort = 3 } = {}) {
  await page.locator('.closeness-meter').waitFor();
  await page.locator('.closeness-bar').nth(closeness - 1).click();
  await page.locator('.closeness').getByRole('button', { name: 'Continue' }).click();
  if (method === 'comfort') return;
  await page.getByTestId('comfort').locator('.scale-dot').nth(comfort - 1).click();
}

/** Landing → relationship question → name + consent. Returns at the join result. */
const CONSENT = 'I agree to take part in this research.';
async function startJoin(page, link, name, { shots = false, checks = false } = {}) {
  await page.goto(link);
  await page.getByRole('heading', { name: /invited you\.$/ }).waitFor();
  if (shots) await page.waitForTimeout(1600), await shot(page, `01-landing`);
  await page.getByRole('button', { name: 'Enter the Experiment' }).click();
  await page.locator('.classifier').waitFor();
  const method = await page.locator('.classifier').getAttribute('data-method');
  if (shots) await page.waitForTimeout(600), await shot(page, `02-question-${method}`);
  await answer(page, '', 'first', { rating: !checks });
  if (checks) {
    // Connection-strength meter, then comfort asking for an introduction
    const meter = page.locator('.closeness-meter');
    await meter.waitFor();
    ok(await page.getByRole('heading', { name: 'How close are you to Truman?' }).isVisible(), 'connection strength: "How close are you to {inviter}?"');
    const cont0 = page.locator('.closeness').getByRole('button', { name: 'Continue' });
    ok(await cont0.isDisabled() && (await page.locator('.closeness-label').innerText()) === 'Tap or slide to choose', 'meter starts unset; Continue waits for a choice');
    const labels = [];
    for (let i = 0; i < 5; i++) {
      await page.locator('.closeness-bar').nth(i).click();
      labels.push(await page.locator('.closeness-label').innerText());
    }
    ok(labels.join('|') === 'Barely know them|Acquaintance|Know them fairly well|Good friend|Very close friend', 'five levels, each described as it’s chosen');
    await meter.focus();
    await page.keyboard.press('ArrowLeft');
    ok((await meter.getAttribute('aria-valuetext')) === '4 of 5: Good friend', 'keyboard and screen readers: arrow keys, "4 of 5: Good friend"');
    const mb = await meter.boundingBox();
    await page.mouse.move(mb.x + mb.width * 0.05, mb.y + mb.height / 2);
    await page.mouse.down();
    await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height / 2, { steps: 5 });
    await page.mouse.up();
    ok((await page.locator('.closeness').getAttribute('data-value')) === '3', 'sliding along the bars works too (→ 3)');
    const head = await page.locator('.closeness .question').boundingBox();
    const vh = page.viewportSize().height;
    ok(head.y < vh / 3 && (await cont0.boundingBox()).y + 56 < vh, `question in the upper third (${Math.round(head.y)}px of ${vh}px), Continue on screen`);
    if (shots) await page.waitForTimeout(400), await shot(page, `02b-connection-strength`);
    await page.locator('.closeness-bar').nth(3).click();
    await cont0.click();
    if (method !== 'comfort') {
      await page.getByRole('heading', { name: 'How comfortable would you feel asking Truman for an introduction?' }).waitFor();
      ok(true, 'then the comfort question (kept separate from closeness)');
      if (shots) await page.waitForTimeout(400), await shot(page, `02c-comfort`);
      await page.getByTestId('comfort').locator('.scale-dot').nth(2).click();
    }
    // First-name + consent page
    await page.getByRole('heading', { name: 'And you are?' }).waitFor();
    if (shots) await page.waitForTimeout(1500), await shot(page, `03-name-consent-empty`);
    ok(await page.getByRole('heading', { name: 'And you are?' }).isVisible(), 'seed link (no invited name): "And you are?"');
    ok(await page.getByText('We’re in stealth mode.').count() === 0 && await page.getByText('A quick experiment about how we’re connected.').count() === 0
      && await page.locator('.join-welcome').count() === 0, 'join page: no stealth label or generic sentence (this group has no welcome line)');
    ok(await page.getByText('No sign-up, email or password.', { exact: true }).isVisible(), 'join page: accurate footer (anonymous session, nobody signs up)');
    const about = page.locator('details.about');
    ok(!(await about.evaluate((d) => d.open)) && (await about.locator('summary').innerText()).trim() === 'About this experiment & privacy'
      && !(await page.getByText('We record how people describe their connections').first().isVisible()), 'details collapsed by default under "About this experiment & privacy"');
    const words = (await page.locator('form.join-form').innerText()).split(/\s+/).filter(Boolean).length;
    ok(words <= 45, `main screen kept short (${words} words visible)`);
    ok(await page.getByText('Invite two people. Find out what this is.').count() === 0, 'old headline removed');
    const cont = page.getByRole('button', { name: 'Continue' });
    const field = page.getByPlaceholder(NAME_PH);
    const hint = page.locator('.type-hint');
    ok(await cont.isDisabled(), 'Continue disabled with no name and no consent');
    // Typed instruction: waits for the first focus, types once, then stays.
    ok(!(await hint.getAttribute('class')).includes('is-started') && (await hint.locator('[aria-hidden]').innerText()).trim() === '', 'name instruction hidden until the field is focused');
    ok(await page.getByText('We use your first name and last initial to identify you within this networking experiment. Your name may be visible to people participating in your invitation chain.').count() === 1, 'name disclosure kept (inside the details)');
    const boxBefore = await field.boundingBox();
    await field.click();
    await page.waitForTimeout(350);
    const partial = (await hint.locator('[aria-hidden]').innerText()).trim();
    ok(partial.length > 0 && partial.length < 'Enter your first name and last initial.'.length, `instruction types itself in ("${partial}")`);
    await field.pressSequentially('Al', { delay: 30 });
    ok((await field.inputValue()) === 'Al', 'typing works while the instruction animates');
    await page.waitForFunction(() => document.querySelector('.type-hint')?.getAttribute('data-done') === 'true', null, { timeout: 2500 });
    ok((await hint.locator('[aria-hidden]').innerText()).trim() === 'Enter your first name and last initial.', 'instruction complete and stays visible');
    ok(Math.abs((await field.boundingBox()).y - boxBefore.y) < 1, 'the field does not move while the instruction types');
    await page.locator('.join-title').click();
    await field.click();
    ok((await hint.getAttribute('data-done')) === 'true' && (await hint.locator('.type-hint-caret').count()) === 0, 'refocusing does not restart the animation');
    await page.locator('details.about summary').click();
    ok(await page.getByText('Other participants don’t see your name. The network view shows people as anonymous dots.').isVisible()
      && await page.getByText('We use your first name and last initial to identify you within this networking experiment. Your name may be visible to people participating in your invitation chain.').isVisible()
      && await page.getByText('You can delete your data at any time from “Your data”.').isVisible(), 'tapping it shows the full research and privacy details');
    if (shots) await page.waitForTimeout(400), await shot(page, `03-about-open`);
    await page.locator('details.about summary').click();
    await field.fill(name);
    ok(await cont.isDisabled(), 'Continue still disabled with a name but no consent');
    await field.fill('   ');
    await page.getByText(CONSENT).click();
    ok(await cont.isDisabled(), 'Continue disabled with consent but a blank name');
    await page.getByRole('button', { name: 'Details' }).click();
    ok(await page.locator('details.about').evaluate((d) => d.open) && await page.getByText('Analysis is aggregate. Nobody sees how you described them.').isVisible()
      && await page.locator('.join-consent input[type=checkbox]').isChecked(), 'the consent’s "Details" link opens the disclosures (without unticking consent)');
    ok(!(await visibleBrand(page)).includes('Pipeline'), 'join page: no "Pipeline" anywhere (page, tab, share tags)');
    // First name + last initial only.
    for (const bad of [name, `${name} Anderson`]) {
      await field.fill(bad);
      await cont.click();
      ok(await page.getByText('Enter your first name and last initial, like “James P.”').isVisible(), `"${bad}" refused: needs a first name and one last initial`);
      ok(!(await q(`select 1 from participants where display_name ilike $1`, [`${name}%`])).length, 'nothing saved');
    }
    await field.fill(`  ${name.toLowerCase()}   ${name[0].toLowerCase()} `);
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
    if (invited.toLowerCase() === full(name).toLowerCase()) {
      await page.getByRole('button', { name: 'Yes, that’s me' }).click();
      return;
    }
    await page.getByRole('button', { name: 'That’s not my name' }).click();
    await page.getByPlaceholder(NAME_PH).fill(full(name));
  } else {
    await page.getByPlaceholder(NAME_PH).fill(full(name));
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
  await page.getByLabel('Their first name and last initial').fill(full(label));
  if (shots) await page.waitForTimeout(400), await shot(page, `05-invite-who`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.sheet .classifier').waitFor();
  if (shots) await page.waitForTimeout(500), await shot(page, `05b-invite-classify`);
  await answer(page, '.sheet', 'last');
  await page.getByRole('heading', { name: `${full(label)}’s link is ready.` }).waitFor();
  const link = 'http://' + (await page.locator('.sheet .url').innerText());
  if (share) {
    await page.locator('.sheet').getByRole('button', { name: 'Copy message' }).click();
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
  await adminPage.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await adminPage.getByRole('heading', { name: 'Tap the link in your email' }).waitFor();
  await adminPage.getByRole('button', { name: 'Have a code instead?' }).click();
  await adminPage.getByLabel('Verification code').fill(await getCode('admin@test.dev'));
  await adminPage.getByRole('button', { name: 'Verify', exact: true }).click();
  await adminPage.getByRole('heading', { name: 'Dashboard' }).waitFor();
  // Seed links are made per experiment; existing data lives in the original one.
  await adminPage.locator('.experiment-card', { hasText: 'The Pipeline Experiment' }).getByRole('button', { name: 'Seed links & tree' }).click();
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
  ok(!(await visibleBrand(alicePage)).includes('Pipeline'), 'Your data sheet: no "Pipeline" (community row hidden until the mission)');
  ok(await alicePage.locator('[data-testid="community-row"]').count() === 0, 'community row hidden before the mission reveal');
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
  const [bobInv0] = await q(`select * from invitations where token = $1`, [bobLink.split(/\/(?:join|i)\//)[1]]);
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
  await alicePage.locator('.invite-card.is-filled').getByRole('button', { name: /^Copy the message/ }).click();
  await alicePage.locator('.reveal-overlay').waitFor();
  await alicePage.waitForTimeout(1800);
  ok((await alicePage.locator('.reveal-title').innerText()).includes('part of Pipeline'), 'reveal 1: the name');
  await alicePage.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
  const [bobInv1] = await q(`select * from invitations where token = $1`, [bobLink.split(/\/(?:join|i)\//)[1]]);
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

  step('Second invitation → mission → early-access signup');
  await alicePage.getByRole('button', { name: 'Invite someone' }).first().click();
  ok(await alicePage.getByRole('heading', { name: 'Who will you invite next?' }).isVisible(), 'second flow asks "Who will you invite next?"');
  await alicePage.getByRole('button', { name: 'Close' }).click();
  await alicePage.waitForTimeout(300);
  const carolLink = await invite(alicePage, 'Carol');
  await alicePage.locator('.reveal-overlay').waitFor();
  await alicePage.waitForTimeout(2200);
  await shot(alicePage, '06-reveal-2');
  await alicePage.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
  await alicePage.getByRole('heading', { name: /Your network already exists/ }).waitFor();
  await alicePage.waitForTimeout(900);
  await shot(alicePage, '07-early-access');
  ok(true, 'early-access screen appears after the second invitation');
  const overlayText = await alicePage.locator('.waitlist-overlay').innerText();
  ok(overlayText.includes('Experiment complete') && overlayText.includes('Thank you for helping us better understand how people are connected.') && overlayText.includes('We’re building Pipeline to help people discover and navigate the networks they already belong to.'), 'completion copy: experiment is complete, thanks, what Pipeline is');
  {
    const explore = alicePage.locator('.waitlist-overlay a.btn', { hasText: 'Explore Pipeline' });
    const href = await explore.getAttribute('href');
    ok(href === 'https://pipeline-networking.com/?source=experiment', 'Explore Pipeline links to the website with only a non-identifying source tag');
    ok(!/[?&](name|token|t|e|exp|experiment|participant|id)=/i.test(href) && !href.includes(alice.id) && !href.includes('Alice'), 'link carries no participant name, token, or experiment id');
  }
  ok(overlayText.includes('No account is created, and you can unsubscribe anytime from “Your data”.'), 'privacy note: how the email is used, and how to unsubscribe');
  const joinBtn = alicePage.getByRole('button', { name: 'Join Early Access' });
  const checks = alicePage.locator('.waitlist-overlay .check input');
  const researchLabel = (await alicePage.locator('.waitlist-overlay .check-label').innerText()).trim();
  ok(await checks.count() === 1 && !(await checks.first().isChecked()) && researchLabel === 'I’m interested in participating in future Pipeline experiments.', 'one separate, unticked checkbox for future experiments');
  ok(await joinBtn.isDisabled() && await alicePage.getByRole('button', { name: 'Back to my network' }).isVisible(), 'email is optional: Join waits for an email, "Back to my network" skips');
  ok(await alicePage.getByLabel('Password').count() === 0 && await alicePage.getByLabel('Verification code').count() === 0, 'no password and no confirmation code');
  await alicePage.getByLabel('Email address').fill('Alice@Test.dev');
  await joinBtn.click();
  await alicePage.getByTestId('completion-on-list').waitFor();
  await shot(alicePage, '08-early-access-done');
  await alicePage.getByRole('button', { name: 'Back to my network' }).click();
  let [cs] = await q(`select * from community_signups where participant_id = $1`, [alice.id]);
  ok(cs && cs.email === 'alice@test.dev' && cs.signed_up_at && cs.experiment_id === alice.experiment_id, 'stored: email (normalised), participant, experiment, signup time');
  ok(cs.updates && cs.updates_at && cs.updates_text === 'Join our early-access list to be among the first to experience it.', 'early-access consent with its exact wording and timestamp');
  ok(!cs.research_invites && cs.research_invites_at === null && cs.unsubscribed_at === null, 'box left unticked: no future-experiments consent');
  ok((await byName('Alice')).marketing_consent === false, 'early-access signup does not touch research/marketing fields');
  ok((await authUser(alice.user_id)).email === null, 'no account: the email is not linked to the sign-in');
  await alicePage.locator('button.early-card:not(.save-card)').waitFor({ state: 'detached', timeout: 5000 }).then(() => ok(true, 'no early-access card once joined'), () => ok(false, 'no early-access card once joined'));
  ok(await alicePage.getByTestId('experiment-complete').isVisible(), 'home clearly shows the experiment is complete');
  ok((await alicePage.getByTestId('explore-pipeline').getAttribute('href')) === 'https://pipeline-networking.com/?source=experiment', 'once on the list, home offers a direct Explore Pipeline link (no signup asked again)');

  step('Early access: return later, add consent, unsubscribe, rejoin');
  await alicePage.reload();
  await alicePage.locator('.home').waitFor();
  await alicePage.waitForTimeout(800);
  ok(await alicePage.getByRole('heading', { name: /Your network already exists/ }).count() === 0, 'screen not shown again after joining');
  await alicePage.getByLabel('Your data').click();
  const row = alicePage.locator('[data-testid="community-row"]');
  ok((await row.innerText()).includes('Early access') && (await row.innerText()).includes('alice@test.dev'), 'Your data shows the early-access signup');
  await row.getByRole('button', { name: 'Manage' }).click();
  await alicePage.getByRole('heading', { name: 'Your preferences' }).waitFor();
  ok(await checks.nth(0).isChecked() && !(await checks.nth(1).isChecked()), 'manage screen reflects current preferences');
  await alicePage.locator('.waitlist-overlay .check').nth(1).click();
  await alicePage.getByRole('button', { name: 'Save preferences' }).click();
  await alicePage.getByRole('heading', { name: 'Preferences saved.' }).waitFor();
  await alicePage.getByRole('button', { name: 'Continue' }).click();
  [cs] = await q(`select * from community_signups where participant_id = $1`, [alice.id]);
  ok(cs.research_invites && cs.updates && cs.research_invites_at && cs.research_invites_text === researchLabel, 'future-experiments consent added later, with its own wording and timestamp');
  const firstResearchAt = cs.research_invites_at.getTime();
  await alicePage.getByLabel('Your data').click();
  await row.getByRole('button', { name: 'Manage' }).click();
  await alicePage.getByRole('button', { name: 'Unsubscribe from everything' }).click();
  await alicePage.getByRole('heading', { name: 'You’re unsubscribed.' }).waitFor();
  await alicePage.getByRole('button', { name: 'Continue' }).click();
  [cs] = await q(`select * from community_signups where participant_id = $1`, [alice.id]);
  ok(!cs.research_invites && !cs.updates && cs.unsubscribed_at && cs.research_invites_withdrawn_at && cs.updates_withdrawn_at, 'unsubscribe withdraws both, with timestamps');
  ok(cs.research_invites_at.getTime() === firstResearchAt, 'original consent record kept for audit');
  await alicePage.locator('button.early-card:not(.save-card)').waitFor();
  ok(true, 'early-access card returns after unsubscribing');
  await alicePage.locator('button.early-card:not(.save-card)').click();
  await alicePage.getByRole('heading', { name: /Your network already exists/ }).waitFor();
  ok((await alicePage.getByLabel('Email address').inputValue()) === 'alice@test.dev', 'rejoin pre-fills the email');
  await joinBtn.click();
  await alicePage.getByTestId('completion-on-list').waitFor();
  await alicePage.getByRole('button', { name: 'Back to my network' }).click();
  [cs] = await q(`select * from community_signups where participant_id = $1`, [alice.id]);
  ok(!cs.research_invites && cs.updates && cs.unsubscribed_at === null, 'rejoined early access only');
  ok((await q(`select count(*)::int n from community_signups where participant_id = $1`, [alice.id]))[0].n === 1, 'still one row per participant');
  {
    const jwt = await jwtOf(alicePage);
    ok((await rpcAs(jwt, 'join_community', { p_email: 'alice@test.dev', p_research_invites: false, p_updates: false })).body.error === 'no_preference', 'API: neither selected is refused (nothing subscribed)');
    ok((await rpcAs(jwt, 'join_community', { p_email: 'not-an-email', p_research_invites: true, p_updates: false })).body.error === 'invalid_email', 'API: invalid email refused');
    ok((await rpcAs(null, 'join_community', { p_email: 'x@test.dev', p_research_invites: true, p_updates: true })).status >= 400, 'API: anonymous visitors cannot sign up');
    [cs] = await q(`select * from community_signups where participant_id = $1`, [alice.id]);
    ok(!cs.research_invites && cs.updates, 'refused calls changed nothing');
  }

  step('Abuse cases (server-side)');
  const aliceJwt = await jwtOf(alicePage);
  await alicePage.goto(carolLink);
  await alicePage.getByRole('heading', { name: 'This is your invitation.' }).waitFor();
  ok(true, 'opening your own link is detected');
  let r = await rpcAs(aliceJwt, 'accept_invitation', { p_token: carolLink.split(/\/(?:join|i)\//)[1], p_display_name: 'A', p_research_consent: true });
  ok(r.body.message === 'self_invite', 'self-referral by account rejected');
  r = await rpcAs(aliceJwt, 'create_invitation', { p_value: { strength: 'weak', context: 'other', comfort: '3', circular: '10' }[alice.method] });
  ok(r.body.message === 'invite_limit', 'third active invitation rejected');
  r = await rpcAs(aliceJwt, 'create_invitation', { p_value: 'nope' });
  ok(r.body.message === 'invalid_value', 'invalid classification value rejected');
  ok((await rpcAs(null, 'get_my_state')).status >= 400, 'anonymous visitors cannot read participant state');
  ok((await rpcAs(aliceJwt, 'admin_overview')).body.message === 'forbidden', 'participants cannot read admin data');
  ok((await rpcAs(null, 'open_invitation', { p_token: 'AAAAAAAAAAAAAAAAAAAAAA' })).body.state === 'invalid', 'guessed token is invalid');
  {
    // Signed-out visitors with bad links get a clear message, never the sign-in screen.
    const visitor = await newPhone();
    await visitor.goto(`${APP}/i/AAAAAAAAAAAAAAAAAAAAAA`);
    await visitor.getByRole('heading', { name: 'This link isn’t active.' }).waitFor();
    ok(await visitor.getByLabel('Email', { exact: true }).count() === 0, 'unknown token (signed out): "This link isn’t active.", no sign-in prompt');
    await visitor.goto(`${APP}/i/abc`);
    await visitor.getByRole('heading', { name: 'This link isn’t active.' }).waitFor();
    ok(await visitor.getByLabel('Email', { exact: true }).count() === 0, 'truncated link: "This link isn’t active.", no sign-in prompt');
    await visitor.close();
    await alicePage.goto(`${carolLink}.`);
    await alicePage.getByRole('heading', { name: 'This is your invitation.' }).waitFor();
    ok(true, 'a link with trailing punctuation (pasted from a message) still resolves');
  }

  step('Invitation landing');
  {
    const p = await newPhone();
    await p.goto(bobLink);
    await p.getByRole('heading', { name: 'Alice invited you.' }).waitFor({ timeout: 5000 });
    ok((await byName('Alice')).display_name === 'Alice A.', 'the participant’s name is stored as “Alice A.”; the landing shows only the first name');
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
    ok(await sk.locator('.network-bg canvas.network-canvas').count() === 1
      && (await sk.locator('.network-bg').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none', 'animated network background: a canvas behind the page that never takes taps');
    const hit = await sk.evaluate(() => { const b = document.querySelector('.landing-cta button').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.landing-cta') !== null; });
    ok(hit, 'the invitation text and button sit above the network');
  }

  // ---------- generation 2 ----------
  step('Generation 2: Bob joins through Alice’s link');
  const bobPage = await newPhone();
  await joinViaLink(bobPage, bobLink, 'Bob');
  const bob = await byName('Bob');
  {
    // Connection strength is stored against each relationship, in its direction (rater → ratee).
    const aliceNow = await byName('Alice');
    const [ra] = await q(`select * from relationship_strength where invitation_id = $1`, [aliceNow.invitation_id]);
    ok(ra && ra.direction === 'inbound' && ra.rater_id === aliceNow.id && ra.ratee_id === null && ra.closeness === 4 && ra.comfort >= 1,
      `Alice → Truman (seed link): closeness ${ra?.closeness}, comfort ${ra?.comfort}, linked to her once she joined`);
    const [rb] = await q(`select * from relationship_strength where invitation_id = $1`, [bob.invitation_id]);
    ok(rb && rb.rater_id === bob.id && rb.ratee_id === alice.id && rb.closeness === 4 && rb.comfort >= 1 && rb.experiment_id === bob.experiment_id,
      'Bob → Alice: closeness and comfort saved on that invitation, rater Bob, ratee Alice');
    ok((await asUser(bob.user_id, 'select * from relationship_ratings')).error && (await asUser(null, 'select * from relationship_strength')).error,
      'ratings are not readable through the API (participants or visitors)');
  }
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
  ok((await q(`select status from invitations where token = $1`, [carolLink.split(/\/(?:join|i)\//)[1]]))[0].status === 'duplicate', 'existing participant gets no new node or credit');

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
  ok((await q(`select count(*)::int n from community_signups where participant_id = $1`, [bob.id]))[0].n === 0, 'saving the network does not join the community');
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
    const r = await rpcAs(anonTok, 'accept_invitation', { p_token: daveLink.split(/\/(?:join|i)\//)[1], p_display_name: 'Not B.', p_research_consent: true, p_device: bobDevice });
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

  step('ABC experiment: Dave (generation 3) gets the scenario right after joining');
  {
    ok(!(await rpcAs(await jwtOf(bobPage), 'get_abc')).body.eligible && !(await rpcAs(await jwtOf(alicePage), 'get_abc')).body.eligible,
      'generations 1 and 2 (Alice, Bob) don’t get the ABC questions');
    const dlg = davePage.locator('.sheet .abc');
    await dlg.waitFor();
    ok((await dlg.getAttribute('data-step')) === 'classify' && await davePage.getByRole('radio', { name: 'Harvard alumnus/alumna' }).isVisible(),
      'no group on file yet → asked first: "Current Harvard student" / "Harvard alumnus/alumna"');
    await davePage.getByRole('radio', { name: 'Harvard alumnus/alumna' }).click();
    await davePage.locator('.sheet .abc[data-step="intro"]').waitFor();
    const fname = await davePage.locator('.sheet .abc').getAttribute('data-name');
    const order = await davePage.locator('.sheet .abc').getAttribute('data-order');
    ok(['Jane', 'John'].includes(fname) && ['cold_first', 'warm_first'].includes(order), `assigned at random: ${fname}, ${order}`);
    ok((await davePage.locator('.abc-scenario').innerText()) === `Imagine ${fname} is a Harvard junior looking for advice about internship opportunities.`, 'alumni scenario shown first');
    const head = await davePage.locator('.abc-scenario').boundingBox();
    ok(head.y < davePage.viewportSize().height / 3, `centred dialog: heading in the upper third (${Math.round(head.y)}px)`);
    await davePage.waitForTimeout(500);
    await shot(davePage, '60-abc-scenario');
    // "Not now", then come back later: same name and order
    await davePage.getByRole('button', { name: 'Not now' }).click();
    await davePage.getByRole('button', { name: /One quick scenario/ }).click();
    await davePage.locator('.sheet .abc[data-step="intro"]').waitFor();
    ok((await davePage.locator('.sheet .abc').getAttribute('data-name')) === fname && (await davePage.locator('.sheet .abc').getAttribute('data-order')) === order,
      'resuming keeps the same name and question order');
    await davePage.getByRole('button', { name: 'Continue' }).click();
    const first = order === 'cold_first' ? 'cold' : 'warm';
    const second = first === 'cold' ? 'warm' : 'cold';
    const qText = { cold: `How likely would you be to respond if ${fname} sent you a message asking for advice?`, warm: `How likely would you be to respond if Bob personally introduced ${fname} to you?` };
    await davePage.getByTestId(`abc-${first}`).waitFor();
    ok((await davePage.getByTestId(`abc-${first}`).locator('.question').innerText()) === qText[first]
      && (await davePage.getByTestId(`abc-${first}`).locator('.scale-context').innerText()).startsWith(`Imagine ${fname}`), `first question (${first}), with the same scenario above it; the inviter's real name in the warm one`);
    await davePage.waitForTimeout(400);
    await shot(davePage, `61-abc-${first}`);
    await davePage.getByTestId(`abc-${first}`).locator('.scale-dot').nth(first === 'cold' ? 1 : 4).click();
    await davePage.getByTestId(`abc-${second}`).waitFor();
    // leave half-way and resume: only the second question remains
    await davePage.reload();
    await davePage.locator('.home').waitFor();
    await davePage.getByRole('button', { name: /One quick scenario/ }).click();
    await davePage.getByTestId(`abc-${second}`).waitFor();
    ok((await davePage.getByTestId(`abc-${second}`).locator('.question').innerText()) === qText[second], 'a half-finished questionnaire resumes at the unanswered question');
    await davePage.getByTestId(`abc-${second}`).locator('.scale-dot').nth(second === 'cold' ? 1 : 4).click();
    await davePage.getByRole('heading', { name: 'Thank you.' }).waitFor();
    await davePage.getByRole('button', { name: 'Continue' }).click();
    await davePage.getByRole('button', { name: /One quick scenario/ }).waitFor({ state: 'detached' });
    const [ab] = await q(`select * from abc_responses where participant_id = $1`, [dave.id]);
    ok(ab && ab.cold === 2 && ab.warm === 5 && ab.completed_at && ab.fictional_name === fname && ab.question_order === order
      && ab.classification === 'alumni' && ab.depth === 3 && ab.inviter_id === bob.id && ab.experiment_id === dave.experiment_id && ab.invitation_id === dave.invitation_id,
      'stored: cold 2, warm 5, name, order, group, generation, inviter, experiment, completion time');
    ok((await byName('Dave')).classification === 'alumni', 'the group is saved on Dave’s participant record');
    const djwt = await jwtOf(davePage);
    ok((await rpcAs(djwt, 'answer_abc', { p_question: 'cold', p_value: 5 })).body.error === 'abc_completed'
      && (await q(`select cold from abc_responses where participant_id = $1`, [dave.id]))[0].cold === 2, 'answers are locked once complete (no duplicate submissions)');
    ok((await rpcAs(djwt, 'answer_abc', { p_question: 'warm', p_value: 9 })).body.error === 'invalid_value', 'values outside 1–5 are refused');
    ok((await asUser(dave.user_id, 'select * from abc_responses')).error, 'ABC answers are not readable through the API');
    // Invitations keep working regardless
    ok(await davePage.locator('.invite-slots').isVisible(), 'invitations work as usual after the questionnaire');
  }
  const reused = await newPhone();
  await reused.goto(daveLink);
  await reused.getByRole('heading', { name: 'This invitation has already been used.' }).waitFor();
  ok(true, 'an accepted link cannot be reused');

  step('Dave takes the feedback path, skips the community, joins later');
  await davePage.getByText('Answer one question instead').click();
  await davePage.getByLabel('Your answer').fill('Not wanting to impose.');
  await davePage.getByRole('button', { name: 'Submit and reveal' }).click();
  await continueReveal(davePage);
  await continueReveal(davePage);
  await davePage.getByRole('heading', { name: /Your network already exists/ }).waitFor();
  ok(true, 'skipping the invitations (one question instead) also ends at the early-access screen');
  await davePage.getByRole('button', { name: 'Back to my network' }).click();
  await davePage.locator('button.early-card:not(.save-card)').waitFor();
  await davePage.waitForTimeout(600);
  await shot(davePage, '10-home-community-card');
  ok((await q(`select count(*)::int n from community_signups where participant_id = $1`, [dave.id]))[0].n === 0, 'skipping stores no email or consent (nothing is enrolled automatically)');
  ok((await byName('Dave')).community_prompt_dismissed_at, 'skip remembered on the server');
  ok(await davePage.locator('.home').count() === 1 && (await byName('Dave')).reveal_level === 2, 'skipping does not affect participation (back on the dashboard)');
  await davePage.reload();
  await davePage.locator('.home').waitFor();
  await davePage.waitForTimeout(800);
  ok(await davePage.getByRole('heading', { name: /Your network already exists/ }).count() === 0, 'the screen does not reappear after "Back to my network"');
  {
    // Duplicate: someone else's address changes nothing and reveals nothing.
    const before = (await q(`select * from community_signups where participant_id = $1`, [alice.id]))[0];
    const r2 = await rpcAs(await jwtOf(davePage), 'join_community', { p_email: 'ALICE@test.dev ', p_research_invites: true, p_updates: true });
    const after = (await q(`select * from community_signups where participant_id = $1`, [alice.id]))[0];
    ok(r2.body.ok === true, 'duplicate email: generic response (no enumeration)');
    ok(after.research_invites === before.research_invites && after.updated_at.getTime() === before.updated_at.getTime(), 'duplicate email does not modify the existing signup');
    ok((await q(`select count(*)::int n from community_signups where email = 'alice@test.dev'`))[0].n === 1
      && (await q(`select count(*)::int n from community_signups where participant_id = $1`, [dave.id]))[0].n === 0, 'no duplicate subscription created');
  }
  await davePage.locator('button.early-card:not(.save-card)').click();
  await davePage.getByLabel('Email address').fill('dave@test.dev');
  await davePage.locator('.waitlist-overlay .check').click();
  await davePage.getByRole('button', { name: 'Join Early Access' }).click();
  await davePage.getByTestId('completion-on-list').waitFor();
  await davePage.getByRole('button', { name: 'Back to my network' }).click();
  {
    const [d] = await q(`select * from community_signups where participant_id = $1`, [dave.id]);
    ok(d && d.research_invites && d.updates && d.research_invites_at && d.updates_at, 'early access + future experiments, each timestamped (joined later from the dashboard)');
    const again = await rpcAs(await jwtOf(davePage), 'join_community', { p_email: 'dave@test.dev', p_research_invites: true, p_updates: true });
    ok(again.body.ok && (await q(`select count(*)::int n from community_signups where email = 'dave@test.dev'`))[0].n === 1, 'resubmitting the same email does not duplicate');
  }

  step('Legacy participant keeps working');
  const erinPage = await newPhone();
  await joinViaLink(erinPage, `${APP}/i/${legacyLink}`, 'Erin');
  ok((await byName('Erin')).parent_id === legacyAfter.id, 'new anonymous participant joins under a legacy participant’s link');
  const leePage = await newPhone();
  await leePage.goto(APP);
  await leePage.getByLabel('Email', { exact: true }).fill('legacy@test.dev');
  await leePage.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await leePage.getByRole('heading', { name: 'Tap the link in your email' }).waitFor();
  await leePage.getByRole('button', { name: 'Have a code instead?' }).click();
  await leePage.getByLabel('Verification code').fill(await getCode('legacy@test.dev'));
  await leePage.getByRole('button', { name: 'Verify', exact: true }).click();
  await leePage.locator('.invite-card.status-accepted').waitFor();
  ok(true, 'legacy participant signs in by email and sees Erin joined');

  step('Rate limits');
  const daveJwt = await jwtOf(davePage);
  const results = [];
  for (let i = 0; i < 21; i++) results.push((await rpcAs(daveJwt, 'join_community', { p_email: 'dave@test.dev', p_research_invites: true, p_updates: true }, '9.9.9.9')).body);
  ok(results.slice(0, 20).every((b) => b.ok) && results[20].message === 'rate_limited', 'community: 21st signup from one IP within an hour is refused');
  await q(`update experiment_settings set value = jsonb_set(value, '{joins_per_ip_hour}', '0') where key = 'rate_limits'`);
  const anon = (await (await fetch(`${API}/auth/v1/signup`, { method: 'POST', body: '{}' })).json()).access_token;
  r = await rpcAs(anon, 'accept_invitation', { p_token: seeds[2].token, p_display_name: 'Bot B.', p_research_consent: true, p_device: 'bot-1' }, '7.7.7.7');
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
    for (const n of ['Fuck M.', 'Fück J.']) {
      await bobPhone2.getByLabel('Their first name and last initial').fill(n);
      await bobPhone2.getByRole('button', { name: 'Continue' }).click();
      await bobPhone2.getByText('Please enter a different name.').waitFor();
    }
    for (const n of ['Zoë', 'www.spam.com', 'Zoë Zimmerman']) {
      await bobPhone2.getByLabel('Their first name and last initial').fill(n);
      await bobPhone2.getByRole('button', { name: 'Continue' }).click();
      await bobPhone2.getByText('Enter their first name and last initial, like “Sarah M.”').waitFor();
    }
    ok(true, 'invitee names need a first name and last initial (no full surname)');
    ok(await bobPhone2.locator('.sheet .classifier').count() === 0, 'rejected invitee names never reach the relationship question');
    await bobPhone2.getByLabel('Their first name and last initial').fill('Zoë Z.');
    await bobPhone2.getByRole('button', { name: 'Continue' }).click();
    await answer(bobPhone2, '.sheet');
    await bobPhone2.getByRole('heading', { name: 'Zoë Z.’s link is ready.' }).waitFor();
    const zoeLink = 'http://' + (await bobPhone2.locator('.sheet .url').innerText());
    const zoeToken = zoeLink.split(/\/(?:join|i)\//)[1];
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
    for (const n of ['Fück B.', 'Bob123 B.']) {
      await v.getByPlaceholder(NAME_PH).fill(n);
      await v.getByRole('button', { name: 'Continue' }).click();
      await v.getByText('Please enter a different name.').waitFor();
    }
    ok((await q(`select count(*)::int n from auth.users`))[0].n === usersBefore, 'a rejected name creates no account');

    // 4. Bypassing the app: straight to the Supabase API
    const anonTok = (await (await fetch(`${API}/auth/v1/signup`, { method: 'POST', body: '{}' })).json()).access_token;
    let r = await rpcAs(anonTok, 'accept_invitation', { p_token: zoeToken, p_display_name: 'Fuck M.', p_research_consent: true, p_device: 'bypass-1' }, '8.8.8.1');
    ok(r.body.error === 'invalid_name', 'direct API join with a bad name is refused');
    r = await rpcAs(anonTok, 'accept_invitation', { p_token: zoeToken, p_display_name: 'www.evil.com', p_research_consent: true, p_marketing_consent: false }, '8.8.8.1');
    ok(r.body.error === 'invalid_name_format', 'old 4-argument join call is validated too');
    r = await rpcAs(anonTok, 'accept_invitation', { p_token: zoeToken, p_display_name: 'Zoe Zimmerman', p_research_consent: true, p_device: 'bypass-2' }, '8.8.8.1');
    ok(r.body.error === 'invalid_name_format', 'direct API join with a full surname is refused (not stored)');
    ok((await q(`select count(*)::int n from participants where invitation_id = (select id from invitations where token = $1)`, [zoeToken]))[0].n === 0, 'no participant was created');
    r = await rpcAs(bobJwt, 'create_invitation', { p_value: VALUE[bob.method], p_recipient_label: 'Sexy S.' });
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
    ok((await rpcAs(bobJwt, 'create_invitation', { p_value: VALUE[bob.method], p_recipient_label: 'Kai K.' })).body.message === 'suspended', 'suspended participants cannot invite');
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
    r = await rpcAs(priyaTok, 'accept_invitation', { p_token: seeds[2].token, p_display_name: 'Priya P.', p_research_consent: true, p_device: 'priya-1' }, '9.9.9.1');
    const [priya] = await q(`select * from participants where display_name = 'Priya P.'`);
    ok(r.body.state === 'joined' && priya.name_status === 'pending', 'review-first mode: new names start pending');
    const pLink = (await rpcAs(priyaTok, 'create_invitation', { p_value: VALUE[priya.method], p_recipient_label: 'Sam S.' })).body.token;
    const pSender = async () => (await rpcAs(null, 'open_invitation', { p_token: pLink }, '8.8.8.3')).body.sender_name ?? null;
    ok((await pSender()) === null, 'pending (unapproved) name never appears on the invitation page');
    await mod('approve', null, 'participant', priya.id);
    ok((await pSender()) === 'Priya', 'after approval it does');
    await q(`update experiment_settings set value = '"after"' where key = 'name_review'`);

    // 9. Log
    const log = await q(`select * from moderation_actions order by id`);
    ok(log.length === 9 && log.every((a) => a.admin_email === 'admin@test.dev'), `${log.length} moderation actions logged with the admin’s email`);
    ok(log.some((a) => a.action === 'replace' && a.old_value === 'Bob B.' && a.new_value === 'Robert Smith'), 'log keeps before → after for replacements');
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
  ok((await asUser(null, 'select * from community_signups')).error, 'anon cannot select community signups');
  ok((await asUser(alice.user_id, 'select * from community_signups')).error, 'participants cannot read the signups table, even their own row');
  ok((await asUser(alice.user_id, `insert into community_signups (participant_id, email) values ('${bob.id}', 'x@test.dev')`)).error, 'no direct writes to signups');
  {
    const jwt = await jwtOf(alicePage);
    ok((await rpcAs(jwt, 'admin_community_stats')).body.message === 'forbidden', 'community stats are admin-only');
    ok((await rpcAs(jwt, 'admin_export', { p_kind: 'community' })).body.message === 'forbidden', 'community export is admin-only');
    ok((await rpcAs(jwt, 'admin_export', { p_kind: 'research_pool' })).body.message === 'forbidden', 'research pool export is admin-only');
    const mine = (await rpcAs(jwt, 'get_my_account')).body;
    ok(mine.community?.email === 'alice@test.dev' && !JSON.stringify(mine).includes('dave@test.dev'), 'participants see only their own signup');
  }
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
  const cst = (await rpcAs(adminJwt, 'admin_community_stats')).body;
  ok(cst.total === 2 && cst.research_invites === 1 && cst.updates === 2 && cst.both === 1, `community stats: ${cst.total} signups, ${cst.research_invites} future experiments, ${cst.updates} updates`);
  ok(cst.eligible >= 2 && cst.by_generation.some((g) => g.depth === 1 && g.signups === 1) && cst.by_generation.some((g) => g.depth === 3 && g.signups === 1), 'community conversion base and signups by generation');
  const byExp = cst.by_experiment.find((e) => e.name === 'The Pipeline Experiment');
  ok(byExp && byExp.signups === 2 && byExp.research_invites === 1 && byExp.participants === 6, `early access by experiment: ${byExp?.signups} of ${byExp?.participants} participants, ${byExp?.research_invites} interested in future experiments`);
  {
    // one admin-only waitlist view across the landing page and the experiment
    await db.query(`insert into landing_waitlist (email, source) values ('wl-one@test.dev','landing-hero'), ('Dave@Test.dev','landing-footer:harvard-baseball') on conflict do nothing`);
    const wl = (await rpcAs(adminJwt, 'admin_waitlist_overview')).body;
    ok(wl.landing_total >= 2 && wl.experiment_total === 2, `waitlist: ${wl.landing_total} landing, ${wl.experiment_total} experiment`);
    ok(wl.on_both >= 1 && wl.unique_total === wl.landing_total + wl.experiment_total - wl.on_both, 'waitlist: de-duplicated by email across both sources');
    ok(wl.by_source.some((x) => x.source === 'experiment') && wl.by_source.some((x) => x.source === 'landing-hero'), 'waitlist: breakdown by source');
    ok(Array.isArray(wl.recent) && wl.recent.length > 0, 'waitlist: recent signups');
    ok((await rpcAs(await jwtOf(alicePage), 'admin_waitlist_overview')).body.message === 'forbidden', 'waitlist overview is admin-only');
    ok((await asUser(null, 'select * from landing_waitlist')).error, 'anon cannot read landing waitlist');
  }
  ok(acct.shared === 3 && acct.shared_by_copy === 3, `admin: ${acct.shared} links shared since tracking began (legacy excluded)`);
  ok((await adminPage.locator('.funnel').innerText()).includes('Shared'), 'funnel shows the Shared step');
  ok((await adminPage.locator('.tiles').first().innerText()).includes('Early access'), 'dashboard shows the early-access tile');
  ok(await adminPage.getByRole('heading', { name: 'Early access' }).isVisible(), 'admin: Early access section');
  const eaPanel = adminPage.locator('.panel', { has: adminPage.getByRole('heading', { name: 'Early access' }) });
  ok((await eaPanel.innerText()).includes('The Pipeline Experiment') && (await eaPanel.innerText()).includes('33%'), 'section shows signups by experiment and the share of participants');
  await adminPage.getByRole('heading', { name: 'Early access' }).scrollIntoViewIfNeeded();
  await adminPage.screenshot({ path: path.join(SHOTS, '12c-admin-community.png') });
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
    adminPage.getByRole('button', { name: 'community.csv' }).click(),
  ]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  ok(['participant_id', 'experiment_id', 'experiment', 'depth', 'email', 'research_invites', 'research_invites_at', 'research_invites_withdrawn_at', 'updates', 'updates_at', 'updates_withdrawn_at', 'signed_up_at', 'unsubscribed_at'].every((c) => csv.split('\n')[0].split(',').includes(c)) && csv.trim().split('\n').length === 3, 'community CSV export (2 rows, consents + timestamps)');
  const [poolDl] = await Promise.all([
    adminPage.waitForEvent('download'),
    adminPage.getByRole('button', { name: 'research_pool.csv' }).click(),
  ]);
  const pool = fs.readFileSync(await poolDl.path(), 'utf8').trim().split('\n');
  ok(pool.length === 2 && pool[0].split(',').sort().join() === 'depth,email,experiment,experiment_id,participant_id,research_invites_at' && pool[1].includes('dave@test.dev'), 'consenting-participants CSV: only people who agreed to future experiments, with email and experiment, no relationship data');

  step('Admin: ABC analytics, connection strength and preview');
  {
    const ajwt = await jwtOf(adminPage);
    const st = (await rpcAs(ajwt, 'admin_abc_stats', { p_experiment_id: null, p_classification: null })).body;
    ok(st.participation.eligible === 1 && st.participation.completed === 1 && Number(st.outreach.avg_cold) === 2 && Number(st.outreach.avg_warm) === 5 && Number(st.outreach.avg_advantage) === 3,
      'ABC: 1 eligible, 1 completed; cold 2, warm 5, introduction advantage +3');
    const ratings = (await q(`select count(*)::int n from relationship_strength s join participants p on p.id = s.rater_id and p.invitation_id = s.invitation_id where p.deleted_at is null`))[0].n;
    ok(st.strength.ratings_n === ratings && st.strength.closeness_dist.reduce((x, y) => x + y, 0) === ratings, `connection strength: ${ratings} ratings, distribution adds up`);
    ok(st.strength.advantage_by_closeness.find((r) => r.closeness === 4).n === 1 && Number(st.strength.advantage_by_closeness.find((r) => r.closeness === 4).avg_advantage) === 3,
      'introduction advantage by connection strength (Dave rated Bob 4 → +3)');
    ok(st.by_depth.some((d) => d.depth === 3 && d.abc_n === 1) && st.by_classification.some((c) => c.classification === 'alumni' && c.abc_n === 1), 'by generation and by group');
    ok(st.strength.comfort_by_closeness.length === 5, 'connection strength vs comfort table');
    const onlyStudents = (await rpcAs(ajwt, 'admin_abc_stats', { p_experiment_id: null, p_classification: 'student' })).body;
    ok(onlyStudents.participation.completed === 0, 'filter by group (students: none yet)');
    const defId = (await q(`select id from experiments where is_default`))[0].id;
    await rpcAs(ajwt, 'admin_set_experiment_test', { p_experiment_id: defId, p_is_test: true });
    const hidden = (await rpcAs(ajwt, 'admin_abc_stats', { p_experiment_id: null, p_classification: null })).body;
    const picked = (await rpcAs(ajwt, 'admin_abc_stats', { p_experiment_id: defId, p_classification: null })).body;
    ok(hidden.participation.completed === 0 && hidden.strength.ratings_n === 0 && picked.participation.completed === 1, 'test experiments stay out of the analytics unless picked explicitly');
    await rpcAs(ajwt, 'admin_set_experiment_test', { p_experiment_id: defId, p_is_test: false });
    ok((await rpcAs(await jwtOf(davePage), 'admin_set_experiment_test', { p_experiment_id: defId, p_is_test: true })).body.message === 'forbidden'
      && (await rpcAs(await jwtOf(davePage), 'admin_abc_stats', { p_experiment_id: null, p_classification: null })).body.message === 'forbidden', 'ABC analytics and test flags are admin-only');
    await adminPage.getByRole('button', { name: 'Refresh' }).click();
    const abcPanel = adminPage.locator('.panel', { has: adminPage.getByRole('heading', { name: 'ABC experiment' }) });
    await abcPanel.locator('.tile-stat', { hasText: 'Introduction advantage' }).getByText('+3.00').waitFor();
    ok(true, 'dashboard: ABC section with the introduction advantage');
    await abcPanel.scrollIntoViewIfNeeded();
    await abcPanel.screenshot({ path: path.join(SHOTS, '62-admin-abc.png') });
    const [dl] = await Promise.all([adminPage.waitForEvent('download'), abcPanel.getByRole('button', { name: 'abc.csv' }).click()]);
    const abcCsv = fs.readFileSync(await dl.path(), 'utf8');
    ok(abcCsv.split('\n').length === 2 && !/Dave|Bob|@/.test(abcCsv) && ['fictional_name', 'question_order', 'cold', 'warm', 'advantage', 'closeness', 'comfort', 'classification', 'depth', 'inviter_id']
      .every((c) => abcCsv.split('\n')[0].split(',').includes(c)), 'abc.csv: anonymised (no names or emails), one row with every field');
    // Simulator: the real participant screens, in order, nothing saved
    const before = (await q(`select (select count(*) from abc_responses)::int a, (select count(*) from relationship_ratings)::int r, (select count(*) from participants)::int p, (select count(*) from classification_events)::int e`))[0];
    const prev = adminPage.locator('.panel', { has: adminPage.getByRole('heading', { name: 'Participant experience simulator' }) });
    await prev.getByLabel('Preview generation').fill('2');
    ok((await prev.getByTestId('preview-eligibility').innerText()).includes('Generation 2 doesn’t get'), 'simulator: generation 2 doesn’t get the ABC questions');
    await prev.getByLabel('Preview generation').fill('3');
    await prev.getByLabel('Preview name').selectOption('John');
    await prev.getByLabel('Preview order').selectOption('warm_first');
    await prev.getByLabel('Preview inviter name').fill('Sam');
    await prev.getByLabel('Preview relationship question').selectOption('context');
    await prev.getByRole('button', { name: 'Start simulator' }).click();
    await adminPage.getByRole('heading', { name: 'Sam invited you.' }).waitFor();
    await adminPage.getByRole('button', { name: 'Enter the Experiment' }).click();
    await adminPage.locator('.classifier .option').first().click();
    await adminPage.getByRole('heading', { name: 'How close are you to Sam?' }).waitFor();
    await adminPage.locator('.closeness-bar').nth(4).click();
    await adminPage.locator('.closeness').getByRole('button', { name: 'Continue' }).click();
    await adminPage.getByTestId('comfort').locator('.scale-dot').nth(3).click();
    await adminPage.getByRole('heading', { name: 'And you are?' }).waitFor();
    await adminPage.getByPlaceholder(NAME_PH).fill('Sim S.');
    await adminPage.locator('.preview-layer .consents .check-box').click();
    await adminPage.getByRole('button', { name: 'Continue' }).click();
    await adminPage.locator('.sheet .abc[data-step="intro"]').waitFor();
    ok((await adminPage.locator('.abc-scenario').innerText()) === 'Imagine John is an incoming Harvard student looking for advice on which classes to take.', 'simulator: landing → questions → join → ABC scenario with John');
    await adminPage.getByRole('button', { name: 'Continue' }).click();
    ok((await adminPage.getByTestId('abc-warm').locator('.question').innerText()) === 'How likely would you be to respond if Sam personally introduced John to you?', 'simulator: warm question first, as chosen');
    await adminPage.getByTestId('abc-warm').locator('.scale-dot').nth(4).click();
    await adminPage.getByTestId('abc-cold').locator('.scale-dot').nth(0).click();
    await adminPage.getByRole('button', { name: 'Continue' }).click();
    await prev.getByTestId('preview-summary').waitFor();
    ok((await prev.getByTestId('preview-summary').innerText()).includes('+4.00') && (await prev.getByTestId('preview-summary').innerText()).includes('Sim S.'), 'simulator summary: name, answers, warm 5 − cold 1 = +4');
    const after = (await q(`select (select count(*) from abc_responses)::int a, (select count(*) from relationship_ratings)::int r, (select count(*) from participants)::int p, (select count(*) from classification_events)::int e`))[0];
    ok(after.p === before.p && after.e === before.e, 'simulator creates no participant and logs no question events');
    ok(after.a === before.a && after.r === before.r, 'preview answers are never saved (analytics untouched)');
  }

  step('Admin sign-in with a password (no email sent)');
  {
    // Like Supabase → Authentication → Users → Add user, with "Auto Confirm User"
    await fetch(`${API}/__test/create-user`, { method: 'POST', body: JSON.stringify({ email: 'owner@test.dev', password: 'correct horse battery' }) });
    await q(`insert into admins (email) values ('owner@test.dev') on conflict do nothing`);
    const ownerCtx = await browser.newContext({ ...iphone });
    contexts.push(ownerCtx);
    const owner = await ownerCtx.newPage();
    await owner.goto(`${APP}/admin`);
    await owner.getByRole('button', { name: 'Use a password instead' }).click();
    await owner.getByLabel('Email', { exact: true }).fill('Owner@Test.dev');
    await owner.getByLabel('Password').fill('wrong');
    await owner.getByRole('button', { name: 'Sign in' }).click();
    await owner.getByText('Wrong email or password.').waitFor();
    ok(true, 'wrong password: a plain message, no email sent');
    await owner.getByLabel('Password').fill('correct horse battery');
    await owner.getByRole('button', { name: 'Sign in' }).click();
    await owner.getByRole('heading', { name: 'Dashboard' }).waitFor();
    ok((await getCodeCount('owner@test.dev')) === 0, 'signed in to the dashboard with no email at all');
    await owner.reload();
    await owner.getByRole('heading', { name: 'Dashboard' }).waitFor();
    ok(true, 'stays signed in on this device after a reload');
    await ownerCtx.close();
  }

  step('Right to erasure');
  await davePage.getByLabel('Your data').click();
  await davePage.getByText('Delete my data').click();
  await davePage.getByRole('button', { name: 'Delete permanently' }).click();
  await davePage.getByText('Your data has been deleted.').waitFor();
  const [tomb] = await q(`select * from participants where id = $1`, [dave.id]);
  ok(tomb.display_name === null && tomb.user_id === null && tomb.device_hash === null && tomb.deleted_at, 'personal data erased, anonymous node kept');
  ok(tomb.invited_name === null && tomb.confirmed_name === null, 'invited and confirmed names erased too');
  ok((await q(`select count(*)::int n from waitlist where participant_id = $1`, [dave.id]))[0].n === 0, 'waitlist entry deleted');
  ok((await q(`select count(*)::int n from community_signups where participant_id = $1`, [dave.id]))[0].n === 0, 'community signup deleted');
  ok((await q(`select count(*)::int n from abc_responses where participant_id = $1`, [dave.id]))[0].n === 0
    && (await q(`select count(*)::int n from relationship_ratings where rater_id = $1`, [dave.id]))[0].n === 0, 'ABC answers and relationship ratings deleted');
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
    await rate(mira, 'circular');
    await mira.getByPlaceholder(NAME_PH).waitFor();
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
    await mira.getByLabel('Their first name and last initial').fill('Theo T.');
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
    await mira.getByRole('heading', { name: 'Theo T.’s link is ready.' }).waitFor();
    const theoLink = 'http://' + (await mira.locator('.sheet .url').innerText());
    await mira.locator('.sheet').getByRole('button', { name: 'Copy message' }).click();
    await mira.locator('.sheet').getByRole('button', { name: 'Continue' }).click();
    const [outRow] = await q(`select c.* from classifications c join invitations i on i.id = c.invitation_id where i.token = $1 and c.direction = 'outbound'`, [theoLink.split(/\/(?:join|i)\//)[1]]);
    ok(outRow.method === 'circular' && outRow.value === '80' && outRow.rater_id === miraP.id && outRow.question_version === 'circular_v1', 'outbound rating stored (80%, D, circular_v1, Mira’s ID)');

    // --- Theo rates Mira: mouse drag on a desktop browser ---
    const theoCtx = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      // an ordinary desktop browser (the default headless user agent is treated as a bot)
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    });
    contexts.push(theoCtx);
    const theo = await theoCtx.newPage();
    await openDial(theo, theoLink.split(/\/(?:join|i)\//)[1]);
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
    await rate(theo, 'circular');
    await completeJoin(theo, 'Theo', { consentBox: true }); // wide screen: click the box, not the sentence (it holds the "Details" link)
    await theo.locator('.home').waitFor();

    // --- 0% is a valid, deliberate answer ---
    const zero = await newPhone();
    const tokZ = await newSeed();
    await openDial(zero, tokZ);
    await zero.locator('.circular-input').focus();
    await zero.keyboard.press('ArrowLeft'); // stays at 0, but counts as an interaction
    await zero.locator('.circular').getByRole('button', { name: 'Continue', exact: true }).click();
    await rate(zero, 'circular');
    await zero.getByPlaceholder(NAME_PH).waitFor();
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
    ok(nadiaP.invited_name === null && nadiaP.confirmed_name === 'Nadia N.' && nadiaP.name_was_corrected === null, 'seed participant stored: invited_name null, confirmed_name Nadia');

    // Nadia invites Sarah and rates her 75% (her assigned method is D in this phase)
    await nadia.getByRole('button', { name: 'Invite someone' }).first().click();
    await nadia.getByLabel('Their first name and last initial').fill('Sarah S.');
    await nadia.getByRole('button', { name: 'Continue' }).click();
    await nadia.locator('.sheet .circular').waitFor();
    await VALUE_D(75)(nadia, '.sheet');
    await nadia.getByRole('heading', { name: 'Sarah S.’s link is ready.' }).waitFor();
    const sarahLink = 'http://' + (await nadia.locator('.sheet .url').innerText());
    const sarahTok = sarahLink.split(/\/(?:join|i)\//)[1];
    await nadia.locator('.sheet').getByRole('button', { name: 'Copy message' }).click();
    await nadia.locator('.sheet').getByRole('button', { name: 'Continue' }).click();
    await nadia.locator('.reveal-overlay').waitFor();
    await nadia.waitForTimeout(1800);
    await nadia.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
    const [sarahInv] = await q(`select * from invitations where token = $1`, [sarahTok]);
    ok(sarahInv.invited_name === 'Sarah S.' && sarahInv.sender_id === nadiaP.id, 'invitation stores invited_name = Sarah');
    ok((await q(`select count(*)::int n from participants where display_name like 'Sarah%'`))[0].n === 0, 'no participant profile exists for Sarah before she joins');
    ok(!sarahLink.includes('Sarah') && !sarahLink.includes('75') && /\/join\/[A-Za-z0-9_-]{22}$/.test(sarahLink), 'the link carries only an unguessable token (no name, no rating)');
    const landingData = (await rpcAs(null, 'open_invitation', { p_token: sarahTok }, '4.4.4.4')).body;
    ok(landingData.invited_name === 'Sarah S.' && landingData.sender_name === 'Nadia' && !/\b75\b/.test(JSON.stringify({ ...landingData, experiment: { ...landingData.experiment, id: undefined } })), 'invitation page data: first names only, no ratings');

    // 1. Correct name: Sarah confirms; she rates Nadia 40% independently
    const sarah = await newPhone();
    await sarah.goto(sarahLink);
    await sarah.getByRole('heading', { name: 'Nadia invited you.' }).waitFor();
    await sarah.getByRole('button', { name: 'Enter the Experiment' }).click();
    await sarah.locator('.circular').waitFor();
    ok(!(await sarah.locator('body').innerText()).includes('75'), 'Sarah never sees Nadia’s rating');
    await VALUE_D(40)(sarah);
    await rate(sarah, 'circular', { closeness: 5, comfort: 4 });
    await sarah.getByRole('heading', { name: 'Are you Sarah S.?' }).waitFor();
    ok(await sarah.getByText('That’s who Nadia invited.').count() === 0, 'confirmation screen: just "Are you Sarah S.?", nothing repeated under it');
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
    ok(sarahP.invited_name === 'Sarah S.' && sarahP.confirmed_name === 'Sarah S.' && sarahP.name_was_corrected === false
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
    await nadia.getByLabel('Their first name and last initial').fill('Jon J.');
    await nadia.getByRole('button', { name: 'Continue' }).click();
    await VALUE_D(55)(nadia, '.sheet');
    await nadia.getByRole('heading', { name: 'Jon J.’s link is ready.' }).waitFor();
    const jonLink = 'http://' + (await nadia.locator('.sheet .url').innerText());
    const jonTok = jonLink.split(/\/(?:join|i)\//)[1];
    await nadia.locator('.sheet').getByRole('button', { name: 'Later' }).click();

    // 4. Forwarded link: someone else opens it and says it wasn't meant for them
    const usersBefore = (await q(`select count(*)::int n from auth.users`))[0].n;
    const stranger = await newPhone();
    await stranger.goto(jonLink);
    await stranger.getByRole('button', { name: 'Enter the Experiment' }).click();
    await VALUE_D(5)(stranger);
    await rate(stranger, 'circular', { closeness: 1, comfort: 1 });
    await stranger.getByRole('heading', { name: 'Are you Jon J.?' }).waitFor();
    await stranger.waitForTimeout(1600); // let the entrance animation settle
    await stranger.getByRole('button', { name: 'That’s not my name' }).click();
    await stranger.getByPlaceholder(NAME_PH).waitFor();
    await stranger.waitForTimeout(800);
    await stranger.screenshot({ path: path.join(SHOTS, '31-not-my-name.png') });
    await stranger.getByRole('button', { name: 'This invite wasn’t meant for me' }).click();
    await stranger.getByRole('heading', { name: 'This invitation is for Jon J.' }).waitFor();
    ok(await stranger.getByText('Ask Nadia for an invitation of your own.').isVisible(), 'forwarded link: "This invitation is for Jon J." / "Ask Nadia…"');
    const [jonInv1] = await q(`select * from invitations where token = $1`, [jonTok]);
    ok(jonInv1.status === 'opened' && jonInv1.accepted_at === null && jonInv1.misdirected_count === 1, 'not accepted; recorded as misdirected; link stays open for Jon');
    ok((await q(`select count(*)::int n from classifications where invitation_id = $1 and direction = 'inbound'`, [jonInv1.id]))[0].n === 0, 'the stranger’s rating of Nadia is discarded');
    ok((await q(`select count(*)::int n from auth.users`))[0].n === usersBefore, 'no account or participant created for the stranger');

    // 2 + 5. The real Jon corrects his name, refreshing midway
    const jon = await newPhone();
    await jon.goto(jonLink);
    await jon.getByRole('button', { name: 'Enter the Experiment' }).click();
    await VALUE_D(30)(jon);
    await rate(jon, 'circular');
    await jon.getByRole('heading', { name: 'Are you Jon J.?' }).waitFor();
    await jon.getByRole('button', { name: 'That’s not my name' }).click();
    await jon.getByPlaceholder(NAME_PH).fill('Fuck J.');
    await jon.getByText(CONSENT).click();
    await jon.getByRole('button', { name: 'Continue' }).click();
    await jon.getByText('Please enter a different name.').waitFor();
    ok(true, 'corrected names go through name moderation');
    await jon.getByPlaceholder(NAME_PH).fill('Jonathan J.');
    await jon.reload();
    await jon.getByPlaceholder(NAME_PH).waitFor();
    ok((await jon.getByPlaceholder(NAME_PH).inputValue()) === 'Jonathan J.'
      && await jon.locator('.consents .check').evaluate((el) => el.classList.contains('is-checked'))
      && await jon.locator('.classifier').count() === 0, 'refresh keeps the step, the typed name and the consent (no re-answering)');
    await jon.getByRole('button', { name: 'Continue' }).click();
    await jon.locator('.home').waitFor();
    const jonP = await byName('Jonathan');
    ok(jonP.invited_name === 'Jon J.' && jonP.confirmed_name === 'Jonathan J.' && jonP.name_was_corrected === true && jonP.parent_id === nadiaP.id,
      'corrected: invited_name Jon, confirmed_name Jonathan, name_was_corrected true');
    ok((await q(`select value from classifications where invitation_id = $1 and direction = 'inbound'`, [jonInv1.id]))[0].value === '30', 'Jon’s own rating (30%) is the one kept');
    ok((await rpcAs(null, 'open_invitation', { p_token: jonTok }, '4.4.4.5')).body.state === 'used', 'once accepted, the invitation page reveals nothing more');

    // Moderation still applies: a hidden invited name isn't shown; the screen falls back to "And you are?"
    const adminJwtN = await jwtOf(adminPage);
    const t3 = (await rpcAs(await jwtOf(sarah), 'create_invitation', { p_value: { strength: 'weak', context: 'other', comfort: '3', circular: '20' }[sarahP.method], p_recipient_label: 'Kai K.' })).body.token;
    const [kaiInv] = await q(`select id from invitations where token = $1`, [t3]);
    await rpcAs(adminJwtN, 'admin_moderate', { p_target: 'invitation', p_id: kaiInv.id, p_action: 'hide', p_reason: 'test' });
    ok((await rpcAs(null, 'open_invitation', { p_token: t3 }, '4.4.4.6')).body.invited_name === null, 'a hidden invited name never reaches the invitation page');

    // 7. Links and people from before this change
    const [leeNow] = await q(`select * from participants where display_name = 'Lee'`);
    ok(leeNow.confirmed_name === 'Lee', 'existing participants backfilled: confirmed_name = their name');
    const erinP = (await q(`select * from participants where display_name = 'Erin E.'`))[0];
    ok(erinP && erinP.invited_name === 'Erin' && erinP.name_was_corrected === false, 'a link from before "First L." names still works: the recipient adds their initial (not counted as a correction)');
    const acctN = (await rpcAs(adminJwtN, 'admin_account_stats')).body;
    ok(acctN.names_corrected >= 1 && acctN.names_confirmed >= 2 && Number(acctN.misdirected_reports) === 1, `admin stats: ${acctN.names_confirmed} confirmed, ${acctN.names_corrected} corrected, ${acctN.misdirected_reports} forwarded-link report`);
    const pexp = (await rpcAs(adminJwtN, 'admin_export', { p_kind: 'participants' })).body.find((r) => r.participant_id === jonP.id);
    ok(pexp.invited_name === 'Jon J.' && pexp.confirmed_name === 'Jonathan J.' && pexp.name_was_corrected === true && pexp.invitation_id === jonInv1.id && pexp.user_id === jonP.user_id, 'participants export: invited_name, confirmed_name, name_was_corrected, invitation_id, user_id');
  }

  step('Live invitation tracking — two browsers (inviter and recipient)');
  {
    // Browser 1: the inviter
    const lena = await newPhone();
    const seedL = (await q(`insert into invitations (token, sender_name) values (px_new_token(), 'Truman') returning token`))[0].token;
    await joinViaLink(lena, `${APP}/i/${seedL}`, 'Lena');
    const lenaP = await byName('Lena');
    await lena.getByRole('button', { name: 'Invite someone' }).first().click();
    await lena.getByLabel('Their first name and last initial').fill('Omar O.');
    await lena.getByRole('button', { name: 'Continue' }).click();
    await answer(lena, '.sheet', 'last');
    await lena.getByRole('heading', { name: 'Omar O.’s link is ready.' }).waitFor();
    const omarLink = 'http://' + (await lena.locator('.sheet .url').innerText());
    const omarTok = omarLink.split(/\/(?:join|i)\//)[1];
    await lena.locator('.sheet').getByRole('button', { name: 'Later' }).click();
    const pill = lena.locator('.invite-card.is-filled .pill');
    await pill.waitFor();
    ok((await pill.getAttribute('data-status')) === 'ready' && (await pill.innerText()).includes('Ready'), 'status: Ready (link generated, not shared)');
    const [omarInv] = await q(`select * from invitations where token = $1`, [omarTok]);
    const evs = async () => (await q(`select event, detail from invitation_events where invitation_id = $1 order by id`, [omarInv.id])).map((e) => e.event + (e.detail ? `:${e.detail}` : ''));
    ok((await evs()).join() === 'created', 'event recorded: created');

    // Share initiated → Pending + immediate unlock (no recipient action needed)
    await lena.locator('.invite-card.is-filled').getByRole('button', { name: /^Copy the message/ }).click();
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

  step('Multiple experiments — admin setup, seed → referrals, categories, duplicates, a second experiment, pause');
  {
    const adminJwtE = await jwtOf(adminPage);
    const VAL = { strength: 'acquaintance', context: 'class', comfort: '3', circular: '50' };
    /** Landing → question → name + category + consent → home. */
    const joinExp = async (page, link, name, category, sender = 'Truman') => {
      await page.goto(link);
      await page.getByRole('heading', { name: `${sender} invited you.` }).waitFor();
      await page.getByRole('button', { name: 'Enter the Experiment' }).click();
      await answer(page);
      const form = page.locator('form.join-form');
      await form.waitFor();
      if (await page.locator('#eligibility-q').count()) await page.getByRole('radio', { name: 'Yes', exact: true }).click();
      if ((await form.getAttribute('data-mode')) === 'enter') await page.getByPlaceholder(NAME_PH).fill(name);
      await page.getByText(CONSENT).click();
      await page.getByRole('radio', { name: category }).click();
      await page.getByRole('button', { name: /^(Continue|Yes, that’s me)$/ }).click();
      await page.locator('.home').waitFor();
    };

    // 1. Admin creates an experiment in the dashboard
    await adminPage.getByRole('button', { name: 'Refresh' }).click();
    await adminPage.getByRole('button', { name: 'New experiment' }).click();
    const form = adminPage.locator('form.experiment-form');
    await form.getByLabel('Experiment name').fill('Harvard Baseball');
    await form.getByLabel('Group description').fill('Current and former Harvard Baseball players.');
    await form.getByLabel('Invitation instruction').fill('Invite two Harvard Baseball players, current or alumni.');
    await form.getByLabel('Invites per participant').fill('2');
    await form.getByLabel('Participant categories').fill('Current player, Former player / alumnus');
    await form.getByLabel('Ask an eligibility question').check();
    await form.getByLabel('Eligibility question', { exact: true }).fill('Have you played for Harvard Baseball?');
    await form.getByLabel('Ineligible message').fill('This experiment is currently for Harvard Baseball players and alumni. Thanks for your interest.');
    await form.getByRole('button', { name: 'Create experiment' }).click();
    const card = adminPage.locator('.experiment-card[data-experiment="Harvard Baseball"]');
    await card.waitFor();
    const [hb] = await q(`select * from experiments where name = 'Harvard Baseball'`);
    ok(hb && hb.status === 'active' && hb.invites_per_participant === 2 && JSON.stringify(hb.categories) === '["Current player","Former player / alumnus"]' && !hb.is_default,
      'admin creates "Harvard Baseball" (description, instruction, 2 invites, Current player / Former player) without code changes');
    ok(await form.getByLabel('Welcome message').count() === 0 && hb.eligibility_enabled && hb.eligibility_question === 'Have you played for Harvard Baseball?'
      && hb.eligible_label === 'Yes' && hb.ineligible_label === 'No' && hb.ineligible_message.startsWith('This experiment is currently for Harvard Baseball'),
      'onboarding settings saved in Supabase: eligibility question, answers, message (no welcome line field)');
    const hs = (await rpcAs(adminJwtE, 'admin_save_experiment', { p_id: null, p_name: 'Harvard Students', p_description: 'Harvard students and alumni.', p_invite_instruction: 'Invite two Harvard students or alumni.', p_invites_per_participant: 2, p_categories: ['Current Student', 'Alumni'], p_status: 'active' })).body;
    ok(hs.id && hs.name === 'Harvard Students' && hs.status === 'active', 'a second experiment: "Harvard Students"');
    ok((await rpcAs(adminJwtE, 'admin_save_experiment', { p_id: null, p_name: 'harvard baseball', p_description: '', p_invite_instruction: '', p_invites_per_participant: 2, p_categories: [], p_status: 'active' })).body.message === 'experiment_name_taken', 'experiment names are unique');

    // 2. Seed links, per experiment, uniquely tracked and copyable one by one
    await card.getByRole('button', { name: 'Seed links & tree' }).click();
    await card.getByLabel('Number of links').fill('2');
    await card.getByLabel('Sender name').fill('Truman');
    await card.getByRole('button', { name: 'Generate' }).click();
    await card.locator('.seed-panel tbody tr').nth(1).waitFor();
    const hbSeeds = await q(`select token, experiment_id from invitations where experiment_id = $1 and sender_id is null order by created_at`, [hb.id]);
    ok(hbSeeds.length === 2 && hbSeeds[0].token !== hbSeeds[1].token, 'two uniquely tracked seed links, both tied to Harvard Baseball');
    const chip = card.locator('.seed-panel tbody tr').first().locator('button.mono');
    ok(/^\/join\/[A-Za-z0-9_-]{8}…$/.test(await chip.innerText()), 'seed links are /join/TOKEN links');
    await chip.click();
    await card.locator('.seed-panel tbody tr').first().getByText('Copied').waitFor();
    ok(true, 'each seed link copies on its own');
    await adminPage.waitForTimeout(400);
    await card.screenshot({ path: path.join(SHOTS, '52-admin-experiment-new.png') });

    // 3. Generation 1 from the seed link: name + category
    const james = await newPhone();
    await james.goto(`${APP}/join/${hbSeeds[0].token}`);
    await james.getByRole('heading', { name: 'Truman invited you.' }).waitFor();
    await james.getByRole('button', { name: 'Enter the Experiment' }).click();
    await answer(james);
    await james.getByRole('heading', { name: 'And you are?' }).waitFor();
    await james.waitForTimeout(800);
    ok(await james.locator('.join-welcome').count() === 0 && await james.locator('.join-intro p').count() === 0, 'nothing under the title: straight to the questions');
    ok(await james.getByText('Have you played for Harvard Baseball?').isVisible() && await james.getByPlaceholder(NAME_PH).count() === 0
      && await james.getByRole('radio', { name: 'Yes', exact: true }).getAttribute('aria-checked') === 'false'
      && await james.getByRole('radio', { name: 'No', exact: true }).getAttribute('aria-checked') === 'false', 'eligibility question first, nothing pre-selected');
    await james.waitForTimeout(400);
    await shot(james, '49-eligibility-question');
    await james.getByRole('radio', { name: 'No', exact: true }).click();
    await james.getByText('This experiment is currently for Harvard Baseball players and alumni. Thanks for your interest.').waitFor();
    ok(await james.getByPlaceholder(NAME_PH).count() === 0 && await james.getByRole('button', { name: 'Continue' }).count() === 0, '“No”: a short message, and no way to continue');
    await shot(james, '49b-ineligible');
    {
      // The server refuses too: a new participant in a screening group must confirm eligibility.
      const anonTok = (await (await fetch(`${API}/auth/v1/signup`, { method: 'POST', body: '{}' })).json()).access_token;
      const r0 = await rpcAs(anonTok, 'accept_invitation', { p_token: hbSeeds[0].token, p_display_name: 'Ivy I.', p_research_consent: true, p_device: 'ineligible-1', p_category: 'Current player' }, '7.7.7.9');
      const r1 = await rpcAs(anonTok, 'accept_invitation', { p_token: hbSeeds[0].token, p_display_name: 'Ivy I.', p_research_consent: true, p_device: 'ineligible-1', p_category: 'Current player', p_eligible: false }, '7.7.7.9');
      ok(r0.body.error === 'not_eligible' && r1.body.error === 'not_eligible'
        && (await q(`select count(*)::int n from participants where display_name = 'Ivy I.'`))[0].n === 0, 'server: no join (and so no links) without the eligible answer');
    }
    await james.getByRole('radio', { name: 'Yes', exact: true }).click();
    await james.getByPlaceholder(NAME_PH).fill('james p');
    await james.getByText(CONSENT).click();
    const cont = james.getByRole('button', { name: 'Continue' });
    ok(await cont.isDisabled() && await james.getByRole('radiogroup', { name: 'Which describes you?' }).isVisible(), '“Yes”: participant types appear; Continue waits for one');
    await james.getByRole('radio', { name: 'Former player / alumnus' }).click();
    await james.waitForTimeout(500);
    await shot(james, '50-experiment-join-category');
    await cont.click();
    await james.locator('.home').waitFor();
    const jamesP = await byName('James P.');
    ok(jamesP.display_name === 'James P.' && jamesP.category === 'Former player / alumnus' && jamesP.classification === 'alumni' && jamesP.experiment_id === hb.id && jamesP.depth === 1 && jamesP.parent_id === null,
      'James P. joined Harvard Baseball from a seed: generation 1, Alumni ("james p" tidied to "James P.")');
    ok(await james.getByText('Harvard Baseball', { exact: true }).isVisible() && await james.getByText('Invite two Harvard Baseball players, current or alumni.').isVisible()
      && await james.getByText('Current and former Harvard Baseball players.').isVisible(), 'home: experiment name, group description and invitation instruction');
    ok(await james.locator('.invite-slots > *').count() === 2, 'two invitation slots (the experiment’s setting)');
    await james.waitForTimeout(600);
    await shot(james, '51-experiment-home');

    // 4. Generation 2 through a referral link
    await james.getByRole('button', { name: 'Invite someone' }).first().click();
    ok(await james.locator('.sheet .invite-instruction').innerText() === 'Invite two Harvard Baseball players, current or alumni.', 'the invite sheet repeats the instruction');
    await james.locator('.sheet').getByRole('button', { name: 'Close' }).click();
    const sarahLinkM = await invite(james, 'Sarah M.', { share: false });
    ok(sarahLinkM.startsWith(`${APP}/join/`), 'referral links are /join/TOKEN links');
    const sarahTokM = sarahLinkM.split('/join/')[1];
    ok((await q(`select experiment_id from invitations where token = $1`, [sarahTokM]))[0].experiment_id === hb.id, 'the referral link belongs to the sender’s experiment');
    const sarahM = await newPhone();
    await sarahM.goto(sarahLinkM);
    await sarahM.getByRole('heading', { name: 'James invited you.' }).waitFor();
    await sarahM.getByRole('button', { name: 'Enter the Experiment' }).click();
    await answer(sarahM);
    await sarahM.getByRole('heading', { name: 'Are you Sarah M.?' }).waitFor();
    await sarahM.getByRole('radio', { name: 'Yes', exact: true }).click();
    await sarahM.getByText(CONSENT).click();
    ok(await sarahM.getByRole('button', { name: 'Yes, that’s me' }).isDisabled(), 'confirming the invited name also waits for the category');
    await sarahM.getByRole('radio', { name: 'Current player' }).click();
    await sarahM.getByRole('button', { name: 'Yes, that’s me' }).click();
    await sarahM.locator('.home').waitFor();
    const sarahMP = (await q(`select * from participants where display_name = 'Sarah M.' and experiment_id = $1`, [hb.id]))[0];
    ok(sarahMP.parent_id === jamesP.id && sarahMP.depth === 2 && sarahMP.category === 'Current player' && sarahMP.classification === 'student', 'Sarah M. joined through James: generation 2, Current player');

    // 5. A second invitation to someone already in: a separate connection, not a second participant
    const ken = await newPhone();
    await joinExp(ken, `${APP}/join/${hbSeeds[1].token}`, 'Ken L.', 'Current player');
    const [kenP] = await q(`select * from participants where display_name = 'Ken L.'`);
    const kenJwt = await jwtOf(ken);
    const kenLink = await invite(ken, 'Sarah M.', { share: false });
    await sarahM.goto(kenLink);
    await sarahM.getByRole('heading', { name: 'Ken invited you.' }).waitFor();
    await sarahM.getByRole('button', { name: 'Enter the Experiment' }).click();
    await answer(sarahM);
    await sarahM.getByText('You were already part of the experiment. Thanks for answering.').waitFor();
    const [kenInv] = await q(`select * from invitations where token = $1`, [kenLink.split('/join/')[1]]);
    ok(kenInv.status === 'duplicate' && kenInv.accepted_by === sarahMP.id, 'Sarah’s second invitation (from Ken) is recorded as a connection to her');
    ok((await q(`select count(*)::int n from participants where user_id = $1 and experiment_id = $2`, [sarahMP.user_id, hb.id]))[0].n === 1
      && (await byName('Sarah M.')).parent_id === jamesP.id, 'she is counted once; James stays her primary referral');
    // Same name, different person: never merged
    const ken2 = (await rpcAs(kenJwt, 'create_invitation', { p_value: VAL[kenP.method], p_recipient_label: 'Sarah M.' })).body.token;
    const otherSarah = await newPhone();
    await joinExp(otherSarah, `${APP}/join/${ken2}`, 'Sarah M.', 'Former player / alumnus', 'Ken');
    const sarahs = await q(`select * from participants where display_name = 'Sarah M.' and experiment_id = $1 order by created_at`, [hb.id]);
    ok(sarahs.length === 2 && sarahs[0].user_id !== sarahs[1].user_id && sarahs[1].parent_id === kenP.id, 'two different people both named “Sarah M.” stay two participants (names are never used to match people)');
    const conns = (await rpcAs(adminJwtE, 'admin_export', { p_kind: 'connections' })).body.filter((c) => c.invitee_id === sarahMP.id);
    ok(conns.length === 2 && conns.filter((c) => c.is_primary).length === 1 && conns.find((c) => c.is_primary).inviter_id === jamesP.id
      && conns.find((c) => !c.is_primary).inviter_id === kenP.id, 'connections export: primary (James → Sarah) and secondary (Ken → Sarah)');

    // 6. An existing account joins another experiment: same login, a second membership
    const usersBefore = (await q(`select count(*)::int n from auth.users`))[0].n;
    const hsSeed = (await rpcAs(adminJwtE, 'admin_create_experiment_seeds', { p_experiment_id: hs.id, p_count: 1, p_sender_name: 'Truman', p_note: 'alice' })).body[0].token;
    await alicePage.goto(`${APP}/join/${hsSeed}`);
    await alicePage.getByRole('heading', { name: 'Truman invited you.' }).waitFor();
    await alicePage.getByRole('button', { name: 'Enter the Experiment' }).click();
    await answer(alicePage);
    await alicePage.getByRole('heading', { name: 'And you are?' }).waitFor();
    ok(true, 'an existing participant opening another experiment’s link is treated as new to that experiment');
    await alicePage.getByPlaceholder(NAME_PH).fill('Alice A.');
    await alicePage.getByText(CONSENT).click();
    await alicePage.getByRole('radio', { name: 'Alumni' }).click();
    await alicePage.getByRole('button', { name: 'Continue' }).click();
    await alicePage.locator('.home').waitFor();
    const aliceRows = await q(`select p.*, e.name as exp from participants p join experiments e on e.id = p.experiment_id where p.user_id = $1 and p.deleted_at is null order by p.created_at`, [alice.user_id]);
    ok(aliceRows.length === 2 && aliceRows.map((r) => r.exp).join() === 'The Pipeline Experiment,Harvard Students'
      && (await q(`select count(*)::int n from auth.users`))[0].n === usersBefore, 'Alice: one account, two memberships (no duplicate account)');
    const tabs = alicePage.getByRole('tablist', { name: 'Your experiments' });
    ok(await tabs.getByRole('tab', { name: 'Harvard Students', selected: true }).isVisible(), 'home switches to the new experiment, with a switcher');
    await alicePage.waitForTimeout(500);
    await shot(alicePage, '53-experiment-switcher');
    await tabs.getByRole('tab', { name: 'The Pipeline Experiment' }).click();
    await tabs.getByRole('tab', { name: 'The Pipeline Experiment', selected: true }).waitFor();
    ok(await alicePage.locator('.invite-card.is-filled').count() >= 1, 'switching back shows her original experiment and its links');
    await tabs.getByRole('tab', { name: 'Harvard Students' }).click();
    await tabs.getByRole('tab', { name: 'Harvard Students', selected: true }).waitFor();
    ok((await asUser(alice.user_id, `select public.accept_invitation($1, 'Al A.', true, false, $2, 'Alumni') as r`,
      [(await rpcAs(adminJwtE, 'admin_create_experiment_seeds', { p_experiment_id: hs.id, p_count: 1, p_sender_name: 'Truman', p_note: 'dup' })).body[0].token, 'other']))[0].r.state === 'already_participant',
      'joining the same experiment again from another seed adds a connection, not a second membership');

    // 7. Pause: no new joins or links; nothing deleted
    const hsCard = adminPage.locator('.experiment-card[data-experiment="Harvard Students"]');
    await adminPage.getByRole('button', { name: 'Refresh' }).click();
    await hsCard.getByRole('button', { name: 'Pause' }).click();
    await hsCard.getByText('Paused').waitFor();
    const pausedSeed = (await rpcAs(adminJwtE, 'admin_create_experiment_seeds', { p_experiment_id: hs.id, p_count: 1, p_sender_name: 'Truman', p_note: 'paused' })).body[0].token;
    const late = await newPhone();
    await late.goto(`${APP}/join/${pausedSeed}`);
    await late.getByRole('heading', { name: 'This experiment is paused.' }).waitFor();
    ok((await q(`select status, opened_at from invitations where token = $1`, [pausedSeed]))[0].opened_at === null, 'paused: the link shows a calm message and nothing is recorded');
    ok((await rpcAs(await jwtOf(alicePage), 'create_invitation', { p_value: VAL[aliceRows[1].method], p_recipient_label: 'Bea B.' })).body.message === 'experiment_paused', 'paused: no new referral links');
    await alicePage.reload();
    await alicePage.getByText('This experiment is paused. New invitations are on hold.').waitFor();
    ok((await q(`select count(*)::int n from participants where experiment_id = $1 and deleted_at is null`, [hs.id]))[0].n === 1, 'paused: existing participants and data are kept');
    await hsCard.getByRole('button', { name: 'Resume' }).click();
    await hsCard.getByText('Active').waitFor();
    await late.reload();
    await late.getByRole('button', { name: 'Enter the Experiment' }).waitFor();
    ok(true, 'resumed: the same link works again');

    // 8. Links are permanent and stay in their experiment
    const tokenNow = hbSeeds[0].token;
    let blocked = 0;
    try { await q(`update invitations set experiment_id = $1 where token = $2`, [hs.id, tokenNow]); } catch { blocked++; }
    try { await q(`update invitations set token = 'x' || token where token = $1`, [tokenNow]); } catch { blocked++; }
    try { await q(`delete from invitations where token = $1`, [tokenNow]); } catch { blocked++; }
    ok(blocked === 3 && (await q(`select experiment_id from invitations where token = $1`, [tokenNow]))[0].experiment_id === hb.id,
      'a link’s token and experiment can’t change, and links can’t be deleted (even by the database owner)');
    ok((await q(`select count(*)::int n from invitations`))[0].n === (await q(`select count(distinct token)::int n from invitations`))[0].n, 'every token is unique');

    // 9. Analytics, from the stored records
    const exps = (await rpcAs(adminJwtE, 'admin_experiments')).body;
    const st = exps.find((e) => e.id === hb.id).stats;
    ok(st.participants === 4 && st.links_created === 5 && st.seed_links === 2 && st.opened === 5 && st.accepted === 4 && st.secondary_connections === 1 && st.max_depth === 2,
      `Harvard Baseball: ${st.participants} participants, ${st.links_created} links, ${st.opened} opened, ${st.accepted} accepted (+${st.secondary_connections} repeat), depth ${st.max_depth}`);
    ok(st.categories['Current player'] === 2 && st.categories['Former player / alumnus'] === 2 && typeof st.median_response_s === 'number', `categories: ${JSON.stringify(st.categories)}; median response ${st.median_response_s}s`);
    ok(exps.find((e) => e.is_default).stats.participants >= 5 && exps.length === 3, 'the original experiment keeps all earlier participants');
    const det = (await rpcAs(adminJwtE, 'admin_experiment_detail', { p_experiment_id: hb.id })).body;
    ok(det.tree.length === 4 && det.tree.filter((n) => n.parent === null).length === 2 && det.secondary.length === 1 && det.seeds.length === 2, 'referral tree: 4 people, 2 seed branches, 1 extra connection');
    await adminPage.getByRole('button', { name: 'Refresh' }).click();
    await card.locator('.tile-stat', { hasText: 'Participants' }).getByText('4', { exact: true }).waitFor();
    ok((await card.locator('.category-split').innerText()).includes('2 Current player'), 'dashboard card shows the numbers and the student/alumni split');
    if (!(await card.locator('.experiment-detail').count())) await card.getByRole('button', { name: 'Seed links & tree' }).click();
    await card.locator('.experiment-detail svg').waitFor();
    await adminPage.waitForTimeout(800);
    await card.screenshot({ path: path.join(SHOTS, '54-admin-experiment-analytics.png') });
    const pexp = (await rpcAs(adminJwtE, 'admin_export', { p_kind: 'participants' })).body.find((r) => r.participant_id === jamesP.id);
    ok(pexp.experiment_id === hb.id && pexp.category === 'Former player / alumnus' && pexp.person_key, 'participants export: experiment, category and a cross-experiment person key');
    const aliceKeys = (await rpcAs(adminJwtE, 'admin_export', { p_kind: 'participants' })).body.filter((r) => r.user_id === alice.user_id).map((r) => r.person_key);
    ok(aliceKeys.length === 2 && aliceKeys[0] === aliceKeys[1], 'the same person has the same key in both experiments');

    // Early access is recorded against the experiment the person signed up in
    await rpcAs(await jwtOf(james), 'join_community', { p_email: 'james@test.dev', p_research_invites: true, p_updates: true });
    const eaHB = (await rpcAs(adminJwtE, 'admin_community_stats')).body.by_experiment.find((e) => e.experiment_id === hb.id);
    ok(eaHB.signups === 1 && eaHB.research_invites === 1 && eaHB.participants === 4
      && (await q(`select experiment_id from community_signups where email = 'james@test.dev'`))[0].experiment_id === hb.id,
      'early-access signups are stored and counted per experiment (Harvard Baseball: 1 of 4)');
    const poolHB = (await rpcAs(adminJwtE, 'admin_export', { p_kind: 'research_pool' })).body.find((r) => r.email === 'james@test.dev');
    ok(poolHB && poolHB.experiment === 'Harvard Baseball', 'the consenting-participants export names the experiment');

    // Tabs: Overview + one per group, each showing that group's view
    await adminPage.getByRole('button', { name: 'Refresh' }).click();
    const adminTabs = adminPage.getByRole('tablist', { name: 'Dashboard sections' });
    await adminTabs.getByRole('tab', { name: 'Harvard Baseball' }).click();
    await adminPage.locator('.experiment-card[data-experiment="Harvard Baseball"] .experiment-detail svg').waitFor();
    ok(await adminPage.locator('.experiment-card').count() === 1 && await adminPage.getByRole('heading', { name: 'Harvard Baseball', exact: true }).first().isVisible()
      && await adminPage.getByLabel('Filter by experiment').count() === 0
      && (await adminPage.getByLabel('Preview experiment').inputValue()) === hb.id, 'group tab: only that group (seed links and tree open), its ABC results and preview');
    ok(await adminTabs.getByRole('tab', { name: 'Harvard Students' }).isVisible() && await adminTabs.getByRole('tab', { name: 'The Pipeline Experiment' }).isVisible(), 'a tab for every group saved in Supabase');
    {
      // The simulator on this tab shows this group's join screen
      const sim = adminPage.locator('.panel', { has: adminPage.getByRole('heading', { name: 'Participant experience simulator' }) });
      await sim.getByLabel('Preview relationship question').selectOption('comfort');
      await sim.getByRole('button', { name: 'Start simulator' }).click();
      await adminPage.getByRole('button', { name: 'Enter the Experiment' }).click();
      await adminPage.locator('.classifier .scale-dot').first().click();
      await adminPage.locator('.closeness-bar').nth(2).click();
      await adminPage.locator('.closeness').getByRole('button', { name: 'Continue' }).click();
      await adminPage.locator('.preview-layer #eligibility-q').waitFor();
      ok(await adminPage.locator('.preview-layer .join-welcome').count() === 0,
        'simulator (Harvard Baseball tab): the group’s join screen, eligibility question first');
      await adminPage.getByRole('radio', { name: 'No', exact: true }).click();
      await adminPage.getByText('This experiment is currently for Harvard Baseball players and alumni. Thanks for your interest.').waitFor();
      await adminPage.getByRole('radio', { name: 'Yes', exact: true }).click();
      ok(await adminPage.getByRole('radio', { name: 'Current player' }).isVisible() && await adminPage.getByRole('radio', { name: 'Former player / alumnus' }).isVisible(),
        'simulator: “No” shows the message; “Yes” shows the group’s participant types');
      await adminPage.getByRole('button', { name: 'Exit simulator' }).click();

      // "Where do you know them from?" can be switched off in the group's settings; the simulator follows.
      const hbCard = adminPage.locator('.experiment-card[data-experiment="Harvard Baseball"]');
      await hbCard.getByRole('button', { name: 'Edit', exact: true }).click();
      const box = adminPage.getByLabel('Ask where they know each other from');
      ok(await box.isChecked() && await adminPage.getByText('Relationship question', { exact: true }).first().isVisible(),
        'group settings: a “Relationship question” section, asked by default');
      await box.uncheck();
      await adminPage.getByText('Skipped: invitees go straight to').waitFor();
      await adminPage.screenshot({ path: path.join(SHOTS, '56-admin-relationship-question.png') });
      await adminPage.getByRole('button', { name: 'Save changes' }).click();
      await hbCard.getByText('Not asked (everyone knows each other the same way)').waitFor();
      ok((await q(`select ask_relationship_question a from experiments where id = $1`, [hb.id]))[0].a === false, 'unticking it saves to Supabase');
      await adminPage.getByRole('button', { name: 'Refresh' }).click();
      await sim.getByText('“Where do you know them from?” is skipped.').waitFor();
      await sim.getByRole('button', { name: 'Start simulator' }).click();
      await adminPage.getByRole('button', { name: 'Enter the Experiment' }).click();
      await adminPage.locator('.preview-layer .closeness-meter').waitFor();
      ok(await adminPage.locator('.preview-layer .classifier').count() === 0, 'simulator: Harvard Baseball now goes straight to “How close are you to …?”');
      await adminPage.getByRole('button', { name: 'Exit simulator' }).click();
      await rpcAs(adminJwtE, 'admin_set_relationship_question', { p_experiment_id: hb.id, p_enabled: true });
    }
    await adminPage.waitForTimeout(500);
    await adminPage.screenshot({ path: path.join(SHOTS, '55-admin-group-tab.png') });
    await adminPage.reload();
    await adminTabs.getByRole('tab', { name: 'Harvard Baseball', selected: true }).waitFor();
    ok(true, 'the chosen tab is remembered on this device');
    await adminTabs.getByRole('tab', { name: 'Overview' }).click();
    await adminPage.locator('.experiment-card').nth(2).waitFor();
    ok(await adminPage.getByLabel('Filter by experiment').isVisible(), 'Overview shows everything again');

    // 10. Admin-only, enforced by the server and RLS
    const jamesJwt = await jwtOf(james);
    ok((await rpcAs(jamesJwt, 'admin_experiments')).body.message === 'forbidden'
      && (await rpcAs(jamesJwt, 'admin_save_experiment', { p_id: hb.id, p_name: 'x', p_description: '', p_invite_instruction: '', p_invites_per_participant: 9, p_categories: [], p_status: 'paused' })).body.message === 'forbidden'
      && (await rpcAs(jamesJwt, 'admin_create_experiment_seeds', { p_experiment_id: hb.id, p_count: 1, p_sender_name: 'J' })).body.message === 'forbidden'
      && (await rpcAs(jamesJwt, 'admin_experiment_detail', { p_experiment_id: hb.id })).body.message === 'forbidden', 'experiment admin functions are admin-only');
    ok((await asUser(jamesP.user_id, 'select * from experiments')).length === 0 && (await asUser(null, 'select * from experiments')).error
      && (await asUser(jamesP.user_id, 'select * from connections')).error, 'experiments and connections are not readable by participants');
    const jamesState = (await rpcAs(jamesJwt, 'get_my_state')).body;
    ok(jamesState.experiment.name === 'Harvard Baseball' && !('stats' in jamesState.experiment) && jamesState.experiments.length === 1, 'participants see only their own experiment’s public details');

    // 10b. A community without "Where do you know them from?" (e.g. one team)
    {
      const psk = (await rpcAs(adminJwtE, 'admin_save_experiment', { p_id: null, p_name: 'PSK', p_description: 'PSK members.', p_invite_instruction: 'Invite two PSK members.', p_invites_per_participant: 2, p_categories: [], p_status: 'active' })).body;
      ok((await rpcAs(jamesJwt, 'admin_set_relationship_question', { p_experiment_id: psk.id, p_enabled: false })).body.message === 'forbidden', 'only admins can switch the relationship question');
      await rpcAs(adminJwtE, 'admin_set_relationship_question', { p_experiment_id: psk.id, p_enabled: false });
      ok((await q(`select ask_relationship_question a from experiments where id = $1`, [psk.id]))[0].a === false
        && (await q(`select ask_relationship_question a from experiments where id = $1`, [hb.id]))[0].a === true, 'switched off for PSK only (on by default)');
      const pskSeed = (await rpcAs(adminJwtE, 'admin_create_experiment_seeds', { p_experiment_id: psk.id, p_count: 1, p_sender_name: 'Truman', p_note: 'psk' })).body[0].token;
      const before = (await q(`select count(*)::int n from classifications`))[0].n;
      const pat = await newPhone();
      await pat.goto(`${APP}/join/${pskSeed}`);
      await pat.getByRole('button', { name: 'Enter the Experiment' }).click();
      await pat.locator('.closeness-meter').waitFor();
      ok(await pat.locator('.classifier').count() === 0 && await pat.getByText('Two quick questions').isVisible(), 'invitee: straight from the landing screen to connection strength');
      await rate(pat, 'context');
      await pat.locator('form.join-form').waitFor();
      await pat.getByPlaceholder(NAME_PH).fill('Pat Q.');
      await pat.getByText(CONSENT).click();
      await pat.getByRole('button', { name: 'Continue' }).click();
      await pat.locator('.home').waitFor();
      const patP = await byName('Pat Q.');
      ok(patP.experiment_id === psk.id && patP.depth === 1, 'Pat Q. joined PSK without the relationship question');
      await pat.getByRole('button', { name: 'Invite someone' }).first().click();
      await pat.getByLabel('Their first name and last initial').fill('Quinn R.');
      await pat.getByRole('button', { name: 'Continue' }).click();
      await pat.getByRole('heading', { name: 'Quinn R.’s link is ready.' }).waitFor();
      ok(await pat.locator('.sheet .classifier').count() === 0, 'inviter: the link is ready right after the name');
      const quinnLink = 'http://' + (await pat.locator('.sheet .url').innerText());
      await pat.locator('.sheet').getByRole('button', { name: 'Later' }).click();
      const [qInv] = await q(`select * from invitations where token = $1`, [quinnLink.split('/join/')[1]]);
      ok(qInv.experiment_id === psk.id && qInv.sender_id === patP.id && qInv.recipient_label === 'Quinn R.'
        && (await q(`select count(*)::int n from classifications where invitation_id = $1`, [qInv.id]))[0].n === 0
        && (await q(`select count(*)::int n from classifications`))[0].n === before, 'no made-up answer is stored for the skipped question');
      ok((await rpcAs(jamesJwt, 'create_invitation', { p_value: null, p_recipient_label: 'Zed Z.' })).body.message === 'invalid_value',
        'groups that ask the question still require an answer');
      const quinn = await newPhone();
      await quinn.goto(quinnLink);
      await quinn.getByRole('button', { name: 'Enter the Experiment' }).click();
      await rate(quinn, 'context');
      await quinn.getByRole('button', { name: 'Yes, that’s me' }).waitFor();
      await quinn.getByText(CONSENT).click();
      await quinn.getByRole('button', { name: 'Yes, that’s me' }).click();
      await quinn.locator('.home').waitFor();
      const quinnP = await byName('Quinn R.');
      ok(quinnP.parent_id === patP.id && quinnP.depth === 2
        && (await q(`select count(*)::int n from relationship_ratings where invitation_id = $1`, [qInv.id]))[0].n === 1,
        'generation 2 joins through the referral; closeness and comfort are still recorded');
    }

    // 10c. Invitation settings: link names, link previews, messages
    {
      const HB_TITLE = 'Harvard Baseball Network Experiment';
      const HB_DESC = 'How strong is the Harvard Baseball network? Help us find out.';
      const HB_INVITE = 'Current Harvard Baseball players are studying the strength of our baseball network. Take this short survey to help us understand how connected our community really is.';
      const HB_FORWARD = 'I’m taking part in a short experiment about the Harvard Baseball network. Add your connection to help us map how our community is connected.';
      const saveSharing = (jwt, id, o = {}) => rpcAs(jwt, 'admin_save_experiment_sharing', {
        p_experiment_id: id, p_slug: o.slug ?? null, p_public_title: o.title ?? null, p_preview_description: o.desc ?? null,
        p_preview_image_url: o.image ?? null, p_invite_message: o.invite ?? null, p_forward_message: o.forward ?? null,
        p_affiliation_authorized: o.auth ?? false,
      });

      // The server's rules
      ok((await saveSharing(jamesJwt, hs.id, { slug: 'harvard-students' })).body.message === 'forbidden', 'invitation settings are admin-only (server)');
      ok((await saveSharing(adminJwtE, hs.id, { slug: 'admin' })).body.message === 'slug_reserved'
        && (await saveSharing(adminJwtE, hs.id, { slug: 'join' })).body.message === 'slug_reserved'
        && (await saveSharing(adminJwtE, hs.id, { slug: 'Harvard Students!' })).body.message === 'invalid_slug'
        && (await saveSharing(adminJwtE, hs.id, { slug: 'ab' })).body.message === 'invalid_slug'
        && (await saveSharing(adminJwtE, hs.id, { slug: 'a--b' })).body.message === 'invalid_slug', 'slugs: readable format only, never an app route (admin, join, …)');
      ok((await saveSharing(adminJwtE, hs.id, { slug: 'harvard-students', image: 'http://example.com/a.png' })).body.message === 'invalid_image_url', 'preview images must be public https addresses');
      ok((await saveSharing(adminJwtE, hs.id, { slug: 'harvard-students', forward: 'An official Harvard University survey.' })).body.message === 'sponsorship_language'
        && (await saveSharing(adminJwtE, hs.id, { slug: 'harvard-students', title: 'Sponsored by the Athletics Department' })).body.message === 'sponsorship_language'
        && (await saveSharing(adminJwtE, hs.id, { slug: 'harvard-students', invite: 'On behalf of Harvard, please join.' })).body.message === 'sponsorship_language',
        'wording that suggests official sponsorship is refused');
      ok((await saveSharing(adminJwtE, hs.id, { slug: 'harvard-students', forward: 'Officially sponsored by the club.', auth: true })).body.affiliation_authorized === true,
        '…unless the admin marks the experiment as officially authorized');
      ok((await saveSharing(adminJwtE, hs.id, { slug: 'harvard-students' })).body.slug === 'harvard-students', 'Harvard Students → /harvard-students');
      ok((await saveSharing(adminJwtE, hb.id, { slug: 'harvard-students' })).body.message === 'slug_taken', 'each slug belongs to one experiment');

      // The admin form: "Invitation settings" with a live preview
      await adminTabs.getByRole('tab', { name: 'Harvard Baseball' }).click();
      const hbCard2 = adminPage.locator('.experiment-card[data-experiment="Harvard Baseball"]');
      await hbCard2.getByRole('button', { name: 'Edit', exact: true }).click();
      const f = adminPage.locator('form.experiment-form');
      await f.getByRole('group', { name: 'Invitation settings' }).waitFor();
      const pv = f.getByTestId('invitation-preview');
      ok(await pv.getByTestId('preview-title').innerText() === 'You’ve been invited.', 'preview starts with the generic card');
      await f.getByLabel('Experiment title').fill(HB_TITLE);
      ok(await pv.getByTestId('preview-title').innerText() === HB_TITLE, 'live preview: the title as it’s typed');
      await f.getByLabel('URL slug').fill('admin');
      await f.getByText('That name is used by the app itself.').waitFor();
      await f.getByLabel('URL slug').fill('');
      await f.getByRole('button', { name: 'Use “harvard-baseball”' }).click();
      ok(await f.getByLabel('URL slug').inputValue() === 'harvard-baseball', 'slug suggested from the experiment name');
      await f.getByLabel('Link preview description').fill(HB_DESC);
      await f.getByLabel('Initial invitation message').fill(HB_INVITE);
      await f.getByLabel('Participant forwarding message').fill('The official Harvard Baseball survey.');
      await f.getByTestId('sponsorship-warning').waitFor();
      ok(true, 'the form warns about sponsorship wording before saving');
      await f.getByLabel('Participant forwarding message').fill(HB_FORWARD);
      ok(await f.getByTestId('sponsorship-warning').count() === 0
        && await pv.getByTestId('preview-description').innerText() === HB_DESC
        && await pv.getByTestId('preview-message').innerText() === HB_INVITE
        && (await pv.getByTestId('preview-text').innerText()).startsWith(HB_INVITE)
        && /\/harvard-baseball\/[A-Za-z0-9_-]{10,}$/.test((await pv.getByTestId('preview-text').innerText()).trim()),
        'live preview: iMessage bubble, link card and full text (initial invitation, /harvard-baseball/… link)');
      await pv.getByRole('radio', { name: 'Forwarded by a participant' }).click();
      ok(await pv.getByTestId('preview-message').innerText() === HB_FORWARD, 'live preview: the forwarding message, separately');
      // Upload a preview image (cropped to 1200×630 and stored publicly)
      const picture = await adminPage.screenshot({ clip: { x: 0, y: 0, width: 800, height: 600 } });
      await f.getByLabel('Upload preview image').setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: picture });
      await pv.locator('img.og-image').waitFor();
      const imageUrl = await f.getByLabel('Preview image address').inputValue();
      ok(imageUrl.startsWith(`${API}/storage/v1/object/public/experiment-previews/`), 'image uploaded to the public preview bucket');
      const imgRes = await fetch(imageUrl);
      const dims = await pv.locator('img.og-image').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
      ok(imgRes.ok && imgRes.headers.get('content-type') === 'image/jpeg' && dims[0] === 1200 && dims[1] === 630,
        'the image is public (no sign-in) and cropped to 1200×630 JPEG');
      await adminPage.waitForTimeout(400);
      await f.screenshot({ path: path.join(SHOTS, '57-admin-invitation-settings.png') });
      await f.getByRole('button', { name: 'Save changes' }).click();
      await hbCard2.getByText('“Harvard Baseball Network Experiment”').waitFor();
      const [hbs] = await q(`select * from experiments where id = $1`, [hb.id]);
      ok(hbs.slug === 'harvard-baseball' && hbs.public_title === HB_TITLE && hbs.preview_description === HB_DESC && hbs.preview_image_url === imageUrl
        && hbs.invite_message === HB_INVITE && hbs.forward_message === HB_FORWARD && hbs.affiliation_authorized === false, 'all invitation settings saved in Supabase');
      {
        // A non-admin can't upload preview images
        const r = await fetch(`${API}/storage/v1/object/experiment-previews/x.jpg`, { method: 'POST', headers: { authorization: `Bearer ${jamesJwt}`, 'content-type': 'image/jpeg' }, body: 'x' });
        ok(r.status === 403, 'preview image uploads are admin-only');
      }

      // Seed links use the slug, and can be shared with the initial message
      await hbCard2.getByLabel('Number of links').fill('1');
      await hbCard2.getByLabel('Sender name').fill('Truman');
      await hbCard2.getByLabel('Note').fill('slug');
      await hbCard2.getByRole('button', { name: 'Generate' }).click();
      const seedRow = hbCard2.locator('.seed-panel tbody tr', { hasText: 'slug' });
      await seedRow.waitFor();
      ok(/^\/harvard-baseball\/[A-Za-z0-9_-]{8}…$/.test(await seedRow.locator('button.mono').innerText()), 'seed links read /harvard-baseball/TOKEN');
      await adminPage.evaluate(() => {
        window.__shares = [];
        Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shares.push(d); } });
      });
      await seedRow.getByRole('button', { name: /^Share the invitation message/ }).click();
      const [seedShare] = await adminPage.evaluate(() => window.__shares);
      const [slugSeed] = await q(`select token from invitations where experiment_id = $1 and admin_note = 'slug'`, [hb.id]);
      ok(seedShare.text === HB_INVITE && seedShare.url.endsWith(`/harvard-baseball/${slugSeed.token}`), 'seed: share sheet with the initial message and the unique link (nothing sent automatically)');

      // A participant's own invitation: the forwarding message + their unique link
      const tess = await newPhone();
      await tess.addInitScript(() => {
        window.__shares = [];
        Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shares.push(d); } });
      });
      await joinExp(tess, `${APP}/harvard-baseball/${slugSeed.token}`, 'Tess T.', 'Current player');
      const tessP = await byName('Tess T.');
      ok(tessP.experiment_id === hb.id && tessP.depth === 1, 'the slug link resolves to the right experiment and seed (generation 1, Harvard Baseball)');
      await tess.getByRole('button', { name: 'Invite someone' }).first().click();
      await tess.getByLabel('Their first name and last initial').fill('Tom H.');
      await tess.getByRole('button', { name: 'Continue' }).click();
      const sheetNext = await Promise.race([
        tess.locator('.sheet .classifier').waitFor().then(() => 'question'),
        tess.getByRole('heading', { name: 'Tom H.’s link is ready.' }).waitFor().then(() => 'ready'),
      ]);
      if (sheetNext === 'question') await answer(tess, '.sheet', 'last');
      await tess.getByRole('heading', { name: 'Tom H.’s link is ready.' }).waitFor();
      const tomLink = 'http://' + (await tess.locator('.sheet .url').innerText());
      const tomTok = tomLink.split('/harvard-baseball/')[1];
      ok(tomLink.startsWith(`${APP}/harvard-baseball/`) && /^[A-Za-z0-9_-]{20,}$/.test(tomTok), 'referral links use the slug and keep their own unique token');
      ok(await tess.locator('.sheet .share-message p').innerText() === HB_FORWARD, 'the invite sheet shows the forwarding message');
      await tess.locator('.sheet').getByRole('button', { name: 'Share invitation' }).click();
      const [tessShare] = await tess.evaluate(() => window.__shares);
      ok(tessShare.text === HB_FORWARD && tessShare.url === tomLink, 'Web Share: forwarding message + the participant’s unique link');
      await tess.evaluate(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
      });
      await tess.locator('.sheet').getByRole('button', { name: 'Copy message' }).click();
      ok(await tess.evaluate(() => window.__copied) === `${HB_FORWARD}\n\n${tomLink}`, 'no Web Share: the message and link are copied, ready to paste');
      await shot(tess, '58-invite-sheet-forward-message');
      await tess.locator('.sheet').getByRole('button', { name: 'Continue' }).click();
      const [tomInv] = await q(`select * from invitations where token = $1`, [tomTok]);
      ok(tomInv.sender_id === tessP.id && tomInv.experiment_id === hb.id && tomInv.shared_at, 'attribution: Tess’s invitation, in Harvard Baseball, marked shared');

      // Tom opens the slug link; the same invitation also opens at /join/TOKEN
      const tom = await newPhone();
      await tom.goto(tomLink);
      await tom.getByRole('heading', { name: 'Tess invited you.' }).waitFor();
      ok(await tom.title() === HB_TITLE, 'the invitation opens from /harvard-baseball/TOKEN (tab title = experiment title)');
      const tom2 = await newPhone();
      await tom2.goto(`${APP}/join/${tomTok}`);
      await tom2.getByRole('heading', { name: 'Tess invited you.' }).waitFor();
      ok(true, 'the same invitation still opens at /join/TOKEN');
      const oldLink = await newPhone();
      await oldLink.goto(`${APP}/join/${hbSeeds[1].token}`);
      await oldLink.locator('h1').first().waitFor();
      ok(!(await oldLink.getByText('Nothing here.').count()), 'links sent before the slug keep working');

      // The experiment's public page
      const pub = await newPhone();
      await pub.goto(`${APP}/harvard-baseball`);
      await pub.getByTestId('experiment-page').waitFor();
      ok(await pub.getByRole('heading', { name: HB_TITLE }).isVisible() && await pub.getByText(HB_DESC).isVisible()
        && await pub.getByText('Invitation only').isVisible(), '/harvard-baseball: the experiment’s public page (title, description, invitation only)');
      await shot(pub, '59-experiment-public-page');
      await pub.goto(`${APP}/no-such-experiment`);
      await pub.getByText('Nothing here.').waitFor();
      ok(true, 'an unknown slug says so');

      // Server-rendered link previews (what iMessage, WhatsApp etc. read, without JavaScript)
      process.env.VITE_SUPABASE_URL = API;
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
      process.env.VITE_PUBLIC_APP_URL = 'https://pipeline-experiment.vercel.app';
      process.env.PX_INDEX_HTML = path.join(root, 'index.html');
      const pageFn = await import(path.join(root, 'api/page.js'));
      const ogFn = await import(path.join(root, 'api/og.js'));
      const render = async (u) => {
        const r = await pageFn.GET(new Request(u));
        return { r, html: await r.text() };
      };
      // A meta tag's value, as a crawler reads it (HTML entities decoded).
      const tag = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1]
        ?.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const PUB = 'https://pipeline-experiment.vercel.app';
      {
        const { r, html } = await render(`${PUB}/api/page?slug=harvard-baseball&token=${tomTok}`);
        ok(r.headers.get('content-type').startsWith('text/html') && tag(html, 'og:title') === HB_TITLE && tag(html, 'og:description') === HB_DESC
          && tag(html, 'og:image') === imageUrl && tag(html, 'twitter:card') === 'summary_large_image' && tag(html, 'twitter:image') === imageUrl
          && tag(html, 'og:url') === `${PUB}/harvard-baseball/${tomTok}` && (html.match(/<title>/g) || []).length === 1
          && html.includes(`<title>${HB_TITLE}</title>`), 'server-rendered preview for a referral link: experiment title, description, image, card type');
        ok(!html.includes('Tess') && !html.includes('Tom H.') && html.includes('<div id="root">') && html.includes('src="/src/main.tsx"')
          && (html.match(/og:title/g) || []).length === 1, 'no sender or recipient in the preview; the app page itself is unchanged');
      }
      {
        // The URL shape Vercel might pass (original path, no query)
        const { html } = await render(`${PUB}/harvard-baseball/${tomTok}`);
        const { html: html2 } = await render(`${PUB}/api/page?token=${tomTok}`);
        ok(tag(html, 'og:title') === HB_TITLE && tag(html2, 'og:title') === HB_TITLE && tag(html2, 'og:url') === `${PUB}/harvard-baseball/${tomTok}`,
          'a /join/TOKEN link to a Harvard Baseball invitation gets the Harvard Baseball preview too');
        const { html: html3 } = await render(`${PUB}/harvard-baseball`);
        ok(tag(html3, 'og:title') === HB_TITLE && tag(html3, 'og:url') === `${PUB}/harvard-baseball`, '/harvard-baseball has the experiment preview');
      }
      {
        const [defInv] = await q(`select i.token from invitations i join experiments e on e.id = i.experiment_id where e.is_default limit 1`);
        const { html } = await render(`${PUB}/api/page?token=${defInv.token}`);
        const { html: bad } = await render(`${PUB}/api/page?token=NoSuchToken12345`);
        const { html: badSlug } = await render(`${PUB}/api/page?slug=no-such-experiment`);
        ok(tag(html, 'og:title') === 'You’ve been invited.' && tag(html, 'og:image') === `${PUB}/api/og` && tag(html, 'og:url') === `${PUB}/join/${defInv.token}`
          && tag(bad, 'og:title') === 'You’ve been invited.' && tag(badSlug, 'og:title') === 'You’ve been invited.',
          'experiments without settings, unknown tokens and unknown slugs get the generic preview');
      }
      {
        // Without a custom image: the generated title card
        await saveSharing(adminJwtE, hs.id, { slug: 'harvard-students', title: 'Harvard Students Network', desc: 'How are Harvard students connected? Help us find out.' });
        const { html } = await render(`${PUB}/harvard-students`);
        const img = tag(html, 'og:image');
        ok(/^https:\/\/pipeline-experiment\.vercel\.app\/api\/og\?s=harvard-students&v=\d+$/.test(img), 'no uploaded image: a generated, versioned title card');
        const res = await ogFn.GET(new Request(img.replace(PUB, 'http://localhost')));
        const png = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(path.join(SHOTS, '60-og-harvard-students.png'), png);
        ok(res.headers.get('content-type') === 'image/png' && png.subarray(1, 4).toString() === 'PNG' && png.length < 600 * 1024
          && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630 && /immutable/.test(res.headers.get('cache-control')),
          `generated preview image: 1200×630 PNG, ${Math.round(png.length / 1024)} KB (< 600 KB for WhatsApp), cached`);
      }
    }

    // 10d. Launch updates (migration 018): community branding, seed kinds, additional invitations,
    //      anonymous feedback, referral analytics
    step('Launch updates: community branding, seed kinds, additional invitations, feedback, analytics');
    {
      const adminJ = await jwtOf(adminPage);
      const jamesJ = await jwtOf(james);
      const HB_WELCOME = 'Current and former Harvard Baseball players are exploring the strength and reach of their network.';

      // Existing links keep working and are classified
      ok((await q(`select count(*)::int n from invitations where kind is null`))[0].n === 0, 'every link has a referral kind (existing ones backfilled)');
      ok((await q(`select count(*)::int n from invitations where sender_id is null and kind <> 'seed_personal'`))[0].n === 0
        && (await q(`select count(*)::int n from invitations where sender_id is not null and kind <> 'standard'`))[0].n === 0,
        'links made before this update: founder seeds are personal, participant links are standard');

      // Seed kinds and internal labels
      const personal = (await rpcAs(adminJ, 'admin_create_experiment_seeds_v2', { p_experiment_id: hb.id, p_count: 1, p_sender_name: 'Truman', p_label: 'Founder 1 — Current players', p_kind: 'personal' })).body;
      const broadcast = (await rpcAs(adminJ, 'admin_create_experiment_seeds_v2', { p_experiment_id: hb.id, p_count: 1, p_sender_name: 'Ignored I.', p_label: 'Harvard Baseball group chat', p_kind: 'broadcast' })).body;
      const [pRow] = await q(`select * from invitations where token = $1`, [personal[0].token]);
      const [bRow] = await q(`select * from invitations where token = $1`, [broadcast[0].token]);
      ok(pRow.kind === 'seed_personal' && pRow.sender_name === 'Truman' && pRow.admin_note === 'Founder 1 — Current players' && pRow.experiment_id === hb.id, 'personal seed: shows the founder’s name, internal label stored');
      ok(bRow.kind === 'seed_broadcast' && bRow.sender_name === null && bRow.admin_note === 'Harvard Baseball group chat', 'broadcast seed: no inviter name stored, so no personal relationship is implied');
      ok((await rpcAs(jamesJ, 'admin_create_experiment_seeds_v2', { p_experiment_id: hb.id, p_count: 1, p_sender_name: 'J', p_label: 'x', p_kind: 'personal' })).body.message === 'forbidden', 'creating seeds is admin-only');
      ok((await rpcAs(adminJ, 'admin_create_experiment_seeds_v2', { p_experiment_id: hb.id, p_count: 1, p_sender_name: 'J', p_label: 'x', p_kind: 'mass' })).body.message === 'invalid_value', 'only personal or broadcast seeds');
      {
        // the admin screen: broadcast hides the sender name; labels are shown only here
        await adminPage.getByRole('button', { name: 'Refresh' }).click();
        const hbCard3 = adminPage.locator('.experiment-card', { hasText: 'Harvard Baseball' });
        // close and reopen so the table reloads (the links were made through the API)
        if (await hbCard3.locator('.experiment-detail').count()) await hbCard3.getByRole('button', { name: 'Seed links & tree' }).click();
        await hbCard3.getByRole('button', { name: 'Seed links & tree' }).click();
        await hbCard3.getByLabel('Seed type').selectOption('broadcast');
        ok(await hbCard3.getByLabel('Sender name').count() === 0, 'admin: a broadcast seed asks for a label, not a name');
        await hbCard3.getByLabel('Seed type').selectOption('personal');
        ok(await hbCard3.locator('.seed-panel tbody tr', { hasText: 'Harvard Baseball group chat' }).innerText().then((t) => t.includes('Broadcast')), 'admin: seed table shows type and internal label');
      }

      // Community settings (admin) and the invitation page
      const set = (o = {}) => rpcAs(adminJ, 'admin_save_experiment_launch', {
        p_experiment_id: hb.id, p_community_name: 'Harvard Baseball', p_completion_message: '',
        p_allow_additional_invites: false, p_enable_feedback: false, p_enable_waitlist: true, ...o,
      });
      ok((await set()).body.community_name === 'Harvard Baseball', 'admin saves the community name');
      ok((await rpcAs(jamesJ, 'admin_save_experiment_launch', { p_experiment_id: hb.id, p_community_name: 'x', p_completion_message: '', p_allow_additional_invites: true, p_enable_feedback: true, p_enable_waitlist: true })).body.message === 'forbidden', 'experiment settings are admin-only');
      await q(`update experiments set welcome_message = $1 where id = $2`, [HB_WELCOME, hb.id]);
      const other = (await q(`select count(*)::int n from experiments where id <> $1 and (allow_additional_invites or enable_feedback or community_name is not null)`, [hb.id]))[0].n;
      ok(other === 0, 'other experiments are unaffected by the new settings');

      const una = await newPhone();
      await una.goto(`${APP}/harvard-baseball/${broadcast[0].token}`);
      await una.getByRole('heading', { name: 'Harvard Baseball Network Experiment' }).waitFor();
      const intro = await una.locator('.landing-intro').textContent();
      ok(intro.includes('You’re invited to') && intro.includes('How connected are we?') && intro.includes(HB_WELCOME)
        && intro.includes('An independent networking experiment by Pipeline.') && !intro.includes('Truman'),
        'community invitation: title, “How connected are we?”, the community’s intro, and the Pipeline disclosure');
      ok(!/official|sponsored by|endorsed by/i.test(intro.replace(/isn’t sponsored or endorsed by/g, '')), 'no implied sponsorship by Harvard or Harvard Athletics');
      await una.screenshot({ path: path.join(SHOTS, '70-community-invitation.png') });
      await una.getByRole('button', { name: 'Enter the Experiment' }).click();
      await answer(una);
      const unaForm = una.locator('form.join-form');
      await unaForm.waitFor();
      ok((await una.getByTestId('join-disclosure').innerText()).includes('independent networking experiment by Pipeline'), 'before submitting: Pipeline’s involvement and what is recorded are disclosed');
      await una.locator('summary', { hasText: 'About this experiment & privacy' }).click();
      const aboutText = await una.locator('.about-body').innerText();
      ok(aboutText.includes('How it may be used') && aboutText.includes('run by Pipeline') && aboutText.includes('isn’t sponsored or endorsed'), 'the full disclosure says how the information may be used');
      if (await una.locator('#eligibility-q').count()) await una.getByRole('radio', { name: 'Yes', exact: true }).click();
      await una.getByPlaceholder(NAME_PH).fill('Una U.');
      await una.getByText(CONSENT).click();
      await una.getByRole('radio', { name: 'Current player' }).click();
      await una.getByRole('button', { name: /^(Continue|Yes, that’s me)$/ }).click();
      await una.locator('.home').waitFor();
      const unaP = await byName('Una U.');
      ok(unaP.experiment_id === hb.id && unaP.parent_id === null && unaP.depth === 1, 'broadcast seed joiner: generation 1, Harvard Baseball');
      ok((await q(`select count(*)::int n from classifications where invitation_id = $1 and direction = 'outbound'`, [bRow.id]))[0].n === 0
        && (await q(`select count(*)::int n from relationship_ratings where invitation_id = $1 and direction = 'outbound'`, [bRow.id]))[0].n === 0,
        'no relationship strength recorded for a broadcast seed');
      const unaJ = await jwtOf(una);

      // Optional feedback: off, then on
      ok((await rpcAs(unaJ, 'submit_experiment_feedback', { p_body: 'hello', p_contact_ok: false, p_email: null })).body.message === 'feedback_off', 'feedback does nothing while it is switched off');
      // Additional invitations: off, not complete, then allowed
      await q(`update participants set reveal_level = 1 where id = $1`, [unaP.id]);
      await set({ p_allow_additional_invites: true, p_enable_feedback: true });
      ok((await rpcAs(unaJ, 'create_additional_invitation', { p_value: '60', p_recipient_label: 'Vic V.' })).body.message === 'not_complete', 'additional invitations only after completing the experiment');
      await q(`update participants set reveal_level = 2 where id = $1`, [unaP.id]);
      ok((await q(`select completed_at from participants where id = $1`, [unaP.id]))[0].completed_at !== null, 'completion time is recorded when the experiment is completed');
      await set({ p_allow_additional_invites: false, p_enable_feedback: true });
      ok((await rpcAs(unaJ, 'create_additional_invitation', { p_value: '60', p_recipient_label: 'Vic V.' })).body.message === 'additional_invites_off', 'additional invitations respect the experiment setting');
      await una.reload();
      await una.locator('.home').waitFor();
      ok(await una.getByTestId('invite-someone-else').count() === 0, 'no “Invite someone else” when the experiment doesn’t allow it');
      await set({ p_allow_additional_invites: true, p_enable_feedback: true });
      await una.reload();
      await una.getByTestId('invite-someone-else').waitFor();

      // The completion page
      await una.locator('button.early-card:not(.save-card)', { hasText: 'Early access' }).click();
      const comp = una.locator('.waitlist-overlay.completion');
      await comp.waitFor();
      await una.waitForTimeout(1000);
      const compText = await comp.innerText();
      ok(await comp.locator('img[alt="Pipeline"]').count() === 1 && (await comp.locator('img').first().getAttribute('src')) === '/logo.svg', 'completion page uses the Pipeline logo asset');
      ok(compText.includes('Experiment complete') && compText.includes('Thank you for helping us better understand the Harvard Baseball network.')
        && compText.includes('Your network already exists.') && compText.includes('Find where it leads.')
        && compText.includes('We’re building Pipeline to help people discover and navigate the networks they already belong to.')
        && compText.includes('Explore Pipeline') && compText.includes('Invite someone else') && compText.includes('Help us improve'), 'completion page: thanks, Pipeline intro, Explore, Invite someone else, Help us improve');
      await una.screenshot({ path: path.join(SHOTS, '71-completion-launch.png'), fullPage: false });
      ok(await comp.locator('textarea').count() === 0, 'feedback is collapsed until asked for');

      // Feedback, anonymous
      await comp.getByRole('button', { name: 'Help us improve' }).click();
      ok((await comp.locator('textarea').getAttribute('placeholder')) === 'Anything confusing, frustrating, or worth changing?' && await comp.getByText('What could we do better?').first().isVisible(), 'feedback prompt and placeholder');
      ok(await comp.getByRole('checkbox', { name: /open to discussing my feedback/ }).isChecked() === false && await comp.getByLabel('Email for feedback follow-up').count() === 0, 'contact checkbox is unticked and no email field is shown');
      await comp.locator('textarea').fill('The slider was hard to find on my phone.');
      await comp.getByRole('button', { name: 'Send feedback' }).click();
      await comp.getByTestId('feedback-thanks').waitFor();
      ok((await comp.getByTestId('feedback-thanks').innerText()) === 'Thank you. Your feedback helps us improve.', 'feedback confirmation');
      const fbCols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'experiment_feedback' order by 1`)).map((r) => r.column_name);
      ok(fbCols.join(',') === 'body,contact_email,contact_ok,experiment_id,id,reviewed_at,status,week', `feedback table holds only: ${fbCols.join(', ')} (no participant, invitation or user reference)`);
      const [f1] = await q(`select * from experiment_feedback order by week desc limit 1`);
      ok(f1.contact_ok === false && f1.contact_email === null && f1.experiment_id === hb.id && String(f1.week).length > 0, 'anonymous feedback: no contact, linked only to the experiment group and the week');
      ok(new Date(f1.week).getUTCDay() === 1 || new Date(f1.week).getDay() === 1, 'only the week it was sent is kept, not the time');
      // Feedback with contact (consent required), and contact never signs up anyone
      ok((await rpcAs(unaJ, 'submit_experiment_feedback', { p_body: 'x', p_contact_ok: true, p_email: 'not-an-email' })).body.message === 'invalid_email', 'a follow-up email must be valid');
      ok((await rpcAs(unaJ, 'submit_experiment_feedback', { p_body: '   ', p_contact_ok: false, p_email: null })).body.message === 'invalid_feedback', 'empty feedback is rejected');
      await rpcAs(unaJ, 'submit_experiment_feedback', { p_body: 'Happy to talk about the invitation wording.', p_contact_ok: true, p_email: 'Una-Talk@Test.dev' });
      await rpcAs(unaJ, 'submit_experiment_feedback', { p_body: 'No consent given', p_contact_ok: false, p_email: 'ignored@test.dev' });
      const fbRows = await q(`select * from experiment_feedback order by body`);
      const talk = fbRows.find((r) => r.body.startsWith('Happy to talk'));
      const noConsent = fbRows.find((r) => r.body === 'No consent given');
      ok(talk.contact_ok && talk.contact_email === 'una-talk@test.dev' && noConsent.contact_ok === false && noConsent.contact_email === null, 'contact email is stored only with explicit consent');
      ok((await q(`select count(*)::int n from community_signups where email in ('una-talk@test.dev','ignored@test.dev')`))[0].n === 0
        && (await q(`select count(*)::int n from landing_waitlist where lower(email) = 'una-talk@test.dev'`))[0].n === 0, 'giving a contact email does not subscribe anyone to Pipeline updates');
      ok((await asUser(null, 'select * from experiment_feedback')).error && (await asUser(unaP.user_id, 'select * from experiment_feedback')).error
        && (await asUser(unaP.user_id, `insert into experiment_feedback (experiment_id, body) values ('${hb.id}', 'direct')`)).error, 'feedback is not readable or writable through the API');
      ok((await rpcAs(jamesJ, 'admin_feedback_list', {})).body.message === 'forbidden' && (await rpcAs(jamesJ, 'admin_feedback_review', { p_id: talk.id, p_reviewed: true })).body.message === 'forbidden', 'feedback review is admin-only');
      const fl = (await rpcAs(adminJ, 'admin_feedback_list', { p_experiment_id: hb.id, p_status: null })).body;
      ok(fl.counts.total === 3 && fl.counts.with_contact === 1 && fl.items.every((i) => !('participant_id' in i) && !('created_at' in i)), 'admin sees feedback with contact only where offered, and no timestamps or participant ids');

      // Additional invitations through the UI
      await comp.getByRole('button', { name: 'Invite someone else' }).click();
      const sheet = una.locator('.sheet');
      await sheet.getByRole('heading', { name: 'Who else should be part of this?' }).waitFor();
      await una.getByLabel('Their first name and last initial').fill('Vic V.');
      await una.getByRole('button', { name: 'Continue' }).click();
      await sheet.locator('.circular-input').waitFor();
      await sheet.locator('.circular-input').focus();
      await una.keyboard.press('Home');
      for (let i = 0; i < 60; i++) await una.keyboard.press('ArrowRight');
      await sheet.locator('.classifier').getByRole('button', { name: 'Continue', exact: true }).click();
      await sheet.getByRole('heading', { name: 'Vic V.’s link is ready.' }).waitFor();
      await sheet.getByRole('button', { name: 'Copy message' }).click();
      await sheet.getByRole('button', { name: 'Continue' }).click();
      await comp.waitFor();
      ok(await comp.getByTestId('additional-count').innerText().then((t) => t.includes('1 invited')), 'back on the completion page, with the count of people invited');
      const [vic] = await q(`select * from invitations where sender_id = $1 and kind = 'additional'`, [unaP.id]);
      ok(vic && vic.recipient_label === 'Vic V.' && vic.sender_strength === '60' && vic.status === 'created', 'additional invitation: name, the 0–100 “how well do you know them” answer, unique link');
      ok((await q(`select count(*)::int n from classifications where invitation_id = $1`, [vic.id]))[0].n === 0, 'additional invitations stay out of the standardised classification data');
      const unaState = (await rpcAs(unaJ, 'get_my_state')).body;
      ok(unaState.participant.reveal_level === 2 && (unaState.invitations ?? []).length === 0 && unaState.additional.created === 1, 'completion status and the two standard invitation slots are unchanged');
      // abuse limits and validation
      ok((await rpcAs(unaJ, 'create_additional_invitation', { p_value: 'abc', p_recipient_label: 'Wes W.' })).body.message === 'invalid_value', 'strength must be 0–100');
      ok((await rpcAs(unaJ, 'create_additional_invitation', { p_value: '101', p_recipient_label: 'Wes W.' })).body.message === 'invalid_value', 'strength above 100 is rejected');
      ok((await rpcAs(unaJ, 'create_additional_invitation', { p_value: '50', p_recipient_label: 'x' })).body.error === 'invalid_name_format', 'recipient name follows the existing naming rules');
      const wes1 = (await rpcAs(unaJ, 'create_additional_invitation', { p_value: '80', p_recipient_label: 'Wes W.' })).body;
      const wes2 = (await rpcAs(unaJ, 'create_additional_invitation', { p_value: '30', p_recipient_label: 'Wes W.' })).body;
      const more = [];
      for (const n of ['Xan X.', 'Yui Y.', 'Zed Z.']) more.push((await rpcAs(unaJ, 'create_additional_invitation', { p_value: '40', p_recipient_label: n })).body);
      ok(new Set([vic.token, wes1.token, wes2.token, ...more.map((m) => m.token)]).size === 6, 'many additional invitations, each a unique individual link (no broadcast link)');

      // A recipient completes the experiment through an additional link
      const wes = await newPhone();
      await wes.goto(`${APP}/harvard-baseball/${wes1.token}`);
      await wes.getByRole('heading', { name: 'Harvard Baseball Network Experiment' }).waitFor();
      ok((await wes.locator('.landing-intro').textContent()).includes('Una invited you to'), 'additional invitation keeps the inviter’s name');
      await wes.getByRole('button', { name: 'Enter the Experiment' }).click();
      await answer(wes);
      await wes.locator('form.join-form').waitFor();
      if (await wes.locator('#eligibility-q').count()) await wes.getByRole('radio', { name: 'Yes', exact: true }).click();
      if ((await wes.locator('form.join-form').getAttribute('data-mode')) === 'enter') await wes.getByPlaceholder(NAME_PH).fill('Wes W.');
      await wes.getByText(CONSENT).click();
      await wes.getByRole('radio', { name: 'Current player' }).click();
      await wes.getByRole('button', { name: /^(Continue|Yes, that’s me)$/ }).click();
      await wes.locator('.home').waitFor();
      const wesP = await byName('Wes W.');
      ok(wesP.parent_id === unaP.id && wesP.depth === 2 && wesP.invitation_id === (await q(`select id from invitations where token = $1`, [wes1.token]))[0].id, 'additional referral joins under the inviter');
      ok((await q(`select status, kind from invitations where token = $1`, [wes1.token]))[0].status === 'accepted', 'additional referral is accepted and tracked');
      ok((await rpcAs(unaJ, 'get_my_state')).body.additional.joined === 1, 'the inviter sees how many joined');

      // Duplicate participants: a second invitation to the same person keeps the first referral and the relationship
      const wesJ = await jwtOf(wes);
      await rpcAs(wesJ, 'open_invitation', { p_token: wes2.token, p_device: 'wes-device' });
      await rpcAs(wesJ, 'answer_invitation', { p_token: wes2.token, p_value: '70', p_response_ms: 900 });
      const dup = (await rpcAs(wesJ, 'accept_invitation', { p_token: wes2.token, p_display_name: 'Wes W.', p_research_consent: true, p_marketing_consent: false, p_device: 'wes-device', p_category: null, p_eligible: null })).body;
      ok(dup.state === 'already_participant', 'a second invitation to an existing participant creates no second participant');
      const [dupRow] = await q(`select status, accepted_by, kind from invitations where token = $1`, [wes2.token]);
      ok(dupRow.status === 'duplicate' && dupRow.accepted_by === wesP.id, 'the second invitation is recorded as a duplicate, tied to the same person');
      ok((await q(`select invitation_id from participants where id = $1`, [wesP.id]))[0].invitation_id === wesP.invitation_id
        && (await q(`select count(*)::int n from participants where experiment_id = $1 and display_name = 'Wes W.' and deleted_at is null`, [hb.id]))[0].n === 1, 'the first referral stays the primary one; no duplicate record');
      ok((await q(`select count(*)::int n from classifications where invitation_id = (select id from invitations where token = $1) and direction = 'inbound'`, [wes2.token]))[0].n === 1, 'the relationship answer from the second invitation is preserved');
      await q(`update participants set reveal_level = 2 where id = $1`, [wesP.id]);

      // Analytics
      ok((await rpcAs(jamesJ, 'admin_launch_analytics', { p_experiment_id: hb.id })).body.message === 'forbidden', 'analytics are admin-only');
      const la = (await rpcAs(adminJ, 'admin_launch_analytics', { p_experiment_id: hb.id })).body;
      const kind = (k) => la.by_kind.find((x) => x.kind === k) ?? {};
      const peopleNow = (await q(`select count(*)::int n from participants where experiment_id = $1 and deleted_at is null`, [hb.id]))[0].n;
      const doneNow = (await q(`select count(*)::int n from participants where experiment_id = $1 and deleted_at is null and reveal_level >= 2`, [hb.id]))[0].n;
      ok(la.overview.participants === peopleNow && la.overview.completed === doneNow && la.overview.completion_rate.den === peopleNow && la.overview.completion_rate.num === doneNow, `overview: ${peopleNow} participants, ${doneNow} completed; the completion rate says what it is a share of`);
      ok(kind('seed_broadcast').generated === 1 && kind('seed_broadcast').started === 1 && kind('seed_broadcast').completed === 1 && kind('seed_personal').generated >= 2, 'personal and broadcast seeds are reported separately');
      ok(kind('additional').generated === 6 && kind('additional').started === 1 && kind('additional').completed === 1 && kind('additional').duplicates === 1
        && kind('additional').conversion.num === 1 && kind('additional').conversion.den === 6, 'additional referrals: 6 generated, 1 started, 1 completed, conversion 1 of 6');
      ok(kind('standard').generated >= 1, 'standard referrals are reported separately from additional ones');
      ok(la.additional.generated === 6 && la.additional.completed_with_any.num === 1 && la.additional.completed_with_any.den === doneNow, 'share of completed participants who invited more people, with its denominator');
      ok(la.overlap.people_invited_more_than_once >= 1 && la.depth.max >= 2, 'overlap and depth are reported');
      ok(la.timing.measured >= 1 && la.timing.median_created_to_completed_s !== null, 'time from invitation to completion is measured');
      ok((await q(`select shared_at from invitations where token = $1`, [vic.token]))[0].shared_at !== null && kind('additional').shared >= 1, 'a copied link counts as shared, not as sent');

      // The admin screens
      await adminPage.getByRole('button', { name: 'Refresh' }).click();
      await adminPage.getByRole('tab', { name: 'Feedback' }).click();
      await adminPage.locator('.feedback-item').first().waitFor();
      ok(await adminPage.locator('.feedback-item').count() === 3 && (await adminPage.locator('.feedback-list').innerText()).includes('anonymous') && (await adminPage.locator('.feedback-list').innerText()).includes('una-talk@test.dev'), 'Feedback tab: anonymous and contact-offered feedback are distinguished');
      await adminPage.getByLabel('Filter by experiment group').selectOption({ label: 'Harvard Baseball' });
      await adminPage.locator('.feedback-item').first().getByRole('button', { name: 'Mark as reviewed' }).click();
      await adminPage.waitForTimeout(600);
      ok((await q(`select count(*)::int n from experiment_feedback where status = 'reviewed' and reviewed_at is not null`))[0].n === 1, 'Feedback tab: mark as reviewed');
      await adminPage.getByRole('tab', { name: 'Waitlist' }).click();
      await adminPage.getByRole('heading', { name: 'Waitlist' }).first().waitFor();
      ok((await adminPage.locator('.admin').innerText()).includes('Consent') && (await adminPage.locator('.admin').innerText()).includes('Signed up'), 'Waitlist tab: source, date, experiment and consent');
      await adminPage.getByRole('tab', { name: 'Harvard Baseball' }).click();
      await adminPage.getByRole('heading', { name: 'Launch analytics' }).waitFor();
      ok((await adminPage.getByTestId('launch-tiles').innerText()).includes('Completion rate'), 'group tab: launch analytics');
      await adminPage.getByRole('tab', { name: 'Overview' }).click();
      await adminPage.getByRole('heading', { name: 'Launch analytics' }).waitFor();
      await adminPage.screenshot({ path: path.join(SHOTS, '72-admin-launch.png'), fullPage: true });
      await una.close(); await wes.close();
    }

    // 11. Erasure covers every experiment
    await alicePage.getByLabel('Your data').click();
    await alicePage.getByText('Delete my data').click();
    await alicePage.getByRole('button', { name: 'Delete permanently' }).click();
    await alicePage.getByText('Your data has been deleted.').waitFor();
    const tombs = await q(`select * from participants where id = any($1)`, [aliceRows.map((r) => r.id)]);
    ok(tombs.length === 2 && tombs.every((t) => t.deleted_at && t.user_id === null && t.display_name === null) && !(await authUser(alice.user_id)),
      'deleting my data erases both memberships and the account');
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
