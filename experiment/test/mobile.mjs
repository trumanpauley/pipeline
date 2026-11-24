// Phone checks on the browser-only demo build (no Supabase or Postgres needed):
//   1. Text fields and their buttons stay above the on-screen keyboard.
//      A headless browser has no keyboard, so iOS behaviour is simulated: on
//      focus the visual viewport shrinks by KB px (the page itself doesn't
//      resize, like iOS Safari) and a striped block is drawn where the
//      keyboard would be.
//   2. The landing page types one letter at a time with a visible caret, even
//      if the phone freezes briefly mid-animation.
// Usage: npm run test:mobile   (screenshots in test-results/mobile/)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'test-results', 'mobile');
const KB = 300; // keyboard + accessory bar, on Playwright's 390×664 iPhone 13 viewport
fs.mkdirSync(OUT, { recursive: true });

// ---------- build + serve the demo from a sub-path, like a real static host ----------
execSync('npm run build:demo', { cwd: root, stdio: 'ignore' });
const dist = path.join(root, 'dist-demo');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const server = http
  .createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/demo/, '');
    const file = path.join(dist, rel);
    const f = rel !== '/' && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  })
  .listen(0);
const BASE = `http://localhost:${server.address().port}/demo/`;

let failed = false;
const report = (ok, msg) => {
  if (!ok) failed = true;
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
};

// Runs in the page: an iOS-like keyboard that shrinks only the visual viewport.
function fakeKeyboard(kbHeight) {
  window.__KB = kbHeight;
  const ev = new EventTarget();
  const vv = {
    offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1, width: innerWidth, height: innerHeight,
    addEventListener: ev.addEventListener.bind(ev), removeEventListener: ev.removeEventListener.bind(ev),
    dispatchEvent: ev.dispatchEvent.bind(ev),
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  const isField = (t) => t && t.matches && t.matches('input:not([type=checkbox]):not([type=radio]), textarea');
  let kb;
  addEventListener('focusin', (e) => {
    if (!isField(e.target)) return;
    setTimeout(() => {
      vv.height = innerHeight - kbHeight;
      ev.dispatchEvent(new Event('resize'));
      kb ??= Object.assign(document.createElement('div'), { textContent: 'keyboard' });
      kb.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${kbHeight}px;z-index:2147483647;pointer-events:none;
        background:repeating-linear-gradient(45deg,#8e8e93 0 10px,#7a7a7f 10px 20px);opacity:.93;display:grid;
        place-items:center;font:600 15px system-ui;color:#fff;text-transform:uppercase;letter-spacing:.08em`;
      document.documentElement.appendChild(kb);
    }, 200);
  }, true);
  addEventListener('focusout', () => setTimeout(() => {
    if (isField(document.activeElement)) return;
    vv.height = innerHeight;
    ev.dispatchEvent(new Event('resize'));
    kb?.remove();
  }, 60), true);
}

/** Invitee questions: the assigned relationship question, the strength meter, then comfort (if not already asked). */
async function answerInvitee(p) {
  const method = await p.locator('.classifier').getAttribute('data-method');
  if (await p.locator('.classifier .circular').count()) {
    await p.locator('.circular-input').focus();
    await p.keyboard.press('ArrowRight');
    await p.locator('.classifier').getByRole('button', { name: 'Continue', exact: true }).click();
  } else {
    await p.locator('.classifier .option, .classifier .scale-dot').first().click();
  }
  await p.locator('.closeness-bar').nth(3).click();
  const note = p.locator('.closeness .answer-note');
  const r = await note.evaluate((el) => ({ text: el.textContent, bottom: el.getBoundingClientRect().bottom, h: innerHeight }));
  report(/^Your answers are private\. .+ won’t see them\.$/.test(r.text) && r.bottom <= r.h,
    `closeness: small privacy note under Continue (“${r.text}”), on screen`);
  await p.screenshot({ path: path.join(OUT, 'closeness-note.png') });
  await p.locator('.closeness').getByRole('button', { name: 'Continue' }).click();
  if (method !== 'comfort') await p.getByTestId('comfort').locator('.scale-dot').nth(2).click();
}

async function keyboardCheck(browser) {
  console.log('Keyboard: each field and its button stay above the keyboard');
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(fakeKeyboard, KB);
  const p = await ctx.newPage();
  let n = 0;
  async function check(name, field, action) {
    // An autofocused field already has the keyboard open; tapping it again in
    // Playwright would scroll it into view itself and mask what the app does.
    if (!(await field.evaluate((el) => el === document.activeElement))) await field.click();
    await p.waitForTimeout(1100); // keyboard opens + smooth scroll settles
    const r = await field.evaluate((f, a) => {
      const fr = f.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      return { top: fr.top, bottom: fr.bottom, action: ar.bottom, visible: innerHeight - window.__KB };
    }, await action.elementHandle());
    await p.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
    report(r.top >= 0 && r.bottom <= r.visible && r.action <= r.visible + 1,
      `${name.padEnd(15)} field ${Math.round(r.top)}–${Math.round(r.bottom)}px, button bottom ${Math.round(r.action)}px, keyboard from ${r.visible}px`);
    await p.evaluate(() => document.activeElement?.blur());
    await p.waitForTimeout(400);
  }

  await p.goto(BASE);
  await p.getByText('Fresh invite as a new visitor').waitFor({ timeout: 60000 });
  await check('sign-in-email', p.getByLabel('Email', { exact: true }), p.getByRole('button', { name: 'Email me a sign-in link' }));

  await p.getByText('Fresh invite as a new visitor').click();
  await p.getByRole('button', { name: 'Enter the Experiment' }).click({ timeout: 60000 });
  await p.locator('.classifier').waitFor();
  await answerInvitee(p);
  await p.getByPlaceholder('First name, last initial').waitFor();
  await p.getByText('I agree to take part in this research.').click();
  await p.getByRole('radio', { name: 'Current Harvard student' }).click();
  await check('join-name', p.getByPlaceholder('First name, last initial'), p.getByRole('button', { name: 'Continue' }));
  await p.getByPlaceholder('First name, last initial').fill('Maya R.');
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.locator('.home').waitFor({ timeout: 30000 });

  await p.getByRole('button', { name: 'Invite someone' }).first().click();
  await check('invite-who', p.getByLabel('Their first name and last initial'), p.locator('.sheet').getByRole('button', { name: 'Continue' }));
  await p.getByRole('button', { name: 'Close' }).click();
  await p.waitForTimeout(400);

  await p.getByText('Answer one question instead').click();
  await check('feedback', p.getByLabel('Your answer'), p.getByRole('button', { name: 'Submit and reveal' }));
  await p.getByLabel('Your answer').fill('Feeling like I am imposing.');
  await p.getByRole('button', { name: 'Submit and reveal' }).click();
  for (let i = 0; i < 2; i++) {
    await p.locator('.reveal-overlay').waitFor();
    await p.waitForTimeout(2200);
    await p.locator('.reveal-overlay').getByRole('button', { name: 'Continue' }).click();
  }

  await p.getByRole('heading', { name: /Your network already exists/ }).waitFor();
  await p.locator('.waitlist-overlay .check').first().click(); // optional: future experiments
  await check('community-email', p.getByLabel('Email address'), p.getByRole('button', { name: 'Join Early Access' }));
  await p.getByLabel('Email address').fill('maya@college.edu');
  await p.getByRole('button', { name: 'Join Early Access' }).click();
  await p.getByTestId('completion-on-list').waitFor();
  await p.getByRole('button', { name: 'Back to my network' }).click();
  // Save the network by phone (demo build has phone verification on; no SMS is sent)
  await p.locator('.save-card').click();
  await check('save-phone', p.getByLabel('Phone number'), p.getByRole('button', { name: 'Text me a code' }));
  await p.getByLabel('Phone number').fill('(617) 555-0199');
  await p.getByRole('button', { name: 'Text me a code' }).click();
  await p.getByLabel('Verification code').waitFor();
  await check('phone-code', p.getByLabel('Verification code'), p.getByRole('button', { name: 'Verify', exact: true }));
  await ctx.close();
}

async function typingCheck(browser) {
  console.log('Typing: steady letters; the caret only exists while typing, at the end of the text');
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__ticks = [];
    window.__samples = 0;
    window.__misplaced = 0;
    window.__caretWhenDone = 0;
    const sample = () => {
      for (const box of document.querySelectorAll('.landing-intro .typewriter')) {
        const typed = box.querySelector('[aria-hidden]');
        const full = box.querySelector('.sr-only');
        const caret = box.querySelector('.tw-caret');
        if (!typed || !full) continue;
        const n = typed.firstChild?.nodeType === 3 ? typed.firstChild.textContent.length : 0;
        const done = n >= full.textContent.length;
        if (done && caret) window.__caretWhenDone++;
        if (box.classList.contains('landing-body') && n > 0 && !done) {
          window.__samples++;
          // the caret must sit right after the last typed letter
          const range = document.createRange();
          range.setStart(typed.firstChild, n - 1);
          range.setEnd(typed.firstChild, n);
          const rects = range.getClientRects();
          const last = rects[rects.length - 1];
          const c = caret?.getBoundingClientRect();
          if (!c || !last || Math.abs(c.left - last.right) > 3 || Math.abs(c.top + c.height / 2 - (last.top + last.height / 2)) > last.height) window.__misplaced++;
          const prev = window.__ticks[window.__ticks.length - 1];
          if (!prev || prev[1] !== n) window.__ticks.push([performance.now(), n]);
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await p.goto(BASE);
  await p.getByText('Fresh invite as a new visitor').click({ timeout: 60000 });
  await p.getByRole('heading', { name: /invited you/ }).waitFor({ timeout: 60000 });
  await p.waitForFunction(() => window.__ticks.length > 15, null, { timeout: 10000 });
  // A busy phone: freeze the main thread for 300ms partway through typing.
  await p.evaluate(() => { const t = performance.now(); while (performance.now() - t < 300) { /* busy */ } });
  await p.waitForFunction(() => document.querySelectorAll('.landing-meta.is-shown').length === 1, null, { timeout: 12000 });
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => ({ ticks: window.__ticks, samples: window.__samples, misplaced: window.__misplaced, doneCaret: window.__caretWhenDone }));
  const maxJump = Math.max(...r.ticks.slice(1).map((t, i) => t[1] - r.ticks[i][1]));
  report(maxJump <= 1, `never more than one new letter at a time, even after a 300ms freeze (largest: ${maxJump})`);
  report(r.misplaced === 0, `caret right after the last typed letter in every frame (${r.samples - r.misplaced}/${r.samples})`);
  report(r.doneCaret === 0 && (await p.locator('.tw-caret').count()) === 0, 'no caret left once the text is typed');
  await ctx.close();

  // An in-app browser that pauses the page mid-typing: the sentence completes, no caret is left.
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE);
  await p2.getByText('Fresh invite as a new visitor').click({ timeout: 60000 });
  await p2.waitForFunction(() => document.querySelector('.landing-body .tw-caret'), null, { timeout: 60000 });
  await p2.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p2.waitForTimeout(200);
  const full = await p2.locator('.landing-body .sr-only').innerText();
  const typed = await p2.evaluate(() => document.querySelector('.landing-body [aria-hidden]').firstChild.textContent);
  report(typed === full && (await p2.locator('.landing-body .tw-caret').count()) === 0, 'page paused mid-typing: the sentence completes and the caret is gone');
  await ctx2.close();

  // Small screens: nothing overlaps or is cut off.
  for (const vp of [{ width: 320, height: 568 }, { width: 375, height: 560 }]) {
    // An iPhone user agent (a bare headless browser is treated as a link-preview bot).
    const ctx3 = await browser.newContext({ ...devices['iPhone 13'], viewport: vp, screen: vp });
    const p3 = await ctx3.newPage();
    await p3.goto(BASE);
    await p3.getByText('Fresh invite as a new visitor').click({ timeout: 60000 });
    await p3.waitForFunction(() => document.querySelector('.landing-meta.is-shown'), null, { timeout: 60000 }); // the in-browser demo database starts first
    const boxes = await p3.evaluate(() => ['.landing-title', '.landing-body', '.landing-cta', '.landing-follow', '.landing-meta']
      .map((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { sel, top: b.top + scrollY, bottom: b.bottom + scrollY, right: b.right }; }));
    const overlaps = boxes.slice(1).filter((b, i) => b.top < boxes[i].bottom - 1).map((b) => b.sel);
    const clipped = boxes.filter((b) => b.right > vp.width + 1).map((b) => b.sel);
    const scrollW = await p3.evaluate(() => document.documentElement.scrollWidth);
    report(!overlaps.length && !clipped.length && scrollW <= vp.width, `${vp.width}×${vp.height}: typed text never overlaps the button or gets cut off${overlaps.length ? ` (overlap: ${overlaps})` : ''}${clipped.length ? ` (clipped: ${clipped})` : ''}`);
    await ctx3.close();
  }
}

/** The name instruction: types once on first focus (~1.2s), never blocks typing, instant with reduced motion. */
async function nameHintCheck(browser) {
  console.log('Name instruction: typed on first focus');
  const toForm = async (p) => {
    await p.goto(BASE);
    await p.getByText('Fresh invite as a new visitor').click({ timeout: 60000 });
    await p.getByRole('button', { name: 'Enter the Experiment' }).click({ timeout: 60000 });
    await p.locator('.classifier').waitFor();
    await answerInvitee(p);
    await p.getByPlaceholder('First name, last initial').waitFor();
    await p.waitForTimeout(2000); // entrance animation
  };
  const visible = (p) => p.evaluate(() => {
    const first = document.querySelector('.type-hint [aria-hidden]').firstChild;
    return first?.nodeType === 3 ? first.textContent.length : 0; // typed text; the untyped rest is a hidden span
  });

  let ctx = await browser.newContext({ ...devices['iPhone 13'] });
  let p = await ctx.newPage();
  await toForm(p);
  report((await visible(p)) === 0, 'nothing shown before the field is focused');
  await p.evaluate(() => {
    window.__hint = [];
    const t0 = performance.now();
    const sample = () => {
      const el = document.querySelector('.type-hint [aria-hidden]');
      const n = el?.firstChild?.nodeType === 3 ? el.firstChild.textContent.length : 0;
      const last = window.__hint[window.__hint.length - 1];
      if (!last || last[1] !== n) window.__hint.push([performance.now() - t0, n]);
      if (document.querySelector('.type-hint')?.dataset.done !== 'true') requestAnimationFrame(sample);
    };
    document.querySelector('input[placeholder="First name, last initial"]').addEventListener('focus', () => requestAnimationFrame(sample), { once: true });
  });
  await p.getByPlaceholder('First name, last initial').tap();
  await p.keyboard.type('Maya R.', { delay: 60 });
  await p.waitForFunction(() => document.querySelector('.type-hint')?.dataset.done === 'true', null, { timeout: 4000 });
  const ticks = await p.evaluate(() => window.__hint);
  const total = ticks[ticks.length - 1][0];
  const maxJump = Math.max(...ticks.slice(1).map((t, i) => t[1] - ticks[i][1]));
  report(total >= 900 && total <= 1600, `types in about ${(total / 1000).toFixed(2)}s`);
  report(maxJump <= 2, `smooth: at most ${maxJump} letters appear at once`);
  report((await p.getByPlaceholder('First name, last initial').inputValue()) === 'Maya R.', 'typing in the field while it animates is unaffected');
  await p.locator('.join-title').tap();
  await p.getByPlaceholder('First name, last initial').tap();
  await p.waitForTimeout(300);
  report((await visible(p)) === 'Enter your first name and last initial.'.length, 'stays visible and does not restart on refocus');
  await ctx.close();

  // Without a tap, it starts on its own after about 3 seconds.
  ctx = await browser.newContext({ ...devices['iPhone 13'] });
  p = await ctx.newPage();
  await toForm(p); // ~2s on the form
  const early = await visible(p);
  await p.waitForFunction(() => document.querySelector('.type-hint')?.dataset.done === 'true', null, { timeout: 4000 });
  report(early === 0, 'no tap: still hidden at 2s, then types on its own (by ~4.5s)');
  await ctx.close();

  // Nothing on the form moves when the keyboard opens or closes, or while the instruction types.
  ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(fakeKeyboard, KB);
  p = await ctx.newPage();
  await toForm(p);
  const pageY = () => p.evaluate(() => ['.join-title', '.name-field input', '.join-actions button']
    .map((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top + window.scrollY)));
  const before = await pageY();
  await p.getByPlaceholder('First name, last initial').tap();
  await p.waitForTimeout(1500); // keyboard open, instruction typing/typed
  const open = await pageY();
  await p.locator('.join-title').tap();
  await p.waitForTimeout(800); // keyboard closed
  const closed = await pageY();
  const same = (x, y) => x.every((v, i) => Math.abs(v - y[i]) <= 1);
  report(same(before, open) && same(before, closed), `layout stays put with the keyboard open and closed (title, field, button at ${before.join('/')}px)`);
  await ctx.close();

  ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  p = await ctx.newPage();
  await toForm(p);
  await p.getByPlaceholder('First name, last initial').tap();
  await p.waitForTimeout(60);
  report((await visible(p)) === 'Enter your first name and last initial.'.length, 'reduced motion: shown at once');
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await keyboardCheck(browser);
  await typingCheck(browser);
  await nameHintCheck(browser);
} catch (e) {
  console.error(`  ✗ ${e.message.split('\n')[0]}`);
  failed = true;
} finally {
  await browser.close();
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
}
console.log(failed ? '\n✗ mobile checks failed' : '\n✔ mobile checks passed');
process.exit(failed ? 1 : 0);
