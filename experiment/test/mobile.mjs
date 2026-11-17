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
  await check('sign-in-email', p.getByLabel('Email', { exact: true }), p.getByRole('button', { name: 'Email me a code' }));

  await p.getByText('Fresh invite as a new visitor').click();
  await p.getByRole('button', { name: 'Enter the Experiment' }).click({ timeout: 60000 });
  await p.locator('.classifier .option, .classifier .scale-dot').first().click();
  await p.getByPlaceholder('First name').waitFor();
  await p.getByText('I agree to take part in this research on how people are connected.').click();
  await check('join-name', p.getByPlaceholder('First name'), p.getByRole('button', { name: 'Continue' }));
  await p.getByPlaceholder('First name').fill('Maya');
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.locator('.home').waitFor({ timeout: 30000 });

  await p.getByRole('button', { name: 'Invite someone' }).first().click();
  await check('invite-who', p.getByLabel('Their first name'), p.locator('.sheet').getByRole('button', { name: 'Continue' }));
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

  await p.getByRole('heading', { name: 'Be first in.' }).waitFor();
  await p.locator('.waitlist-overlay .check').click(); // explicit consent
  await check('waitlist-email', p.getByLabel('Email', { exact: true }), p.getByRole('button', { name: 'Join the waitlist' }));
  await p.getByLabel('Email', { exact: true }).fill('maya@college.edu');
  await p.getByRole('button', { name: 'Join the waitlist' }).click();
  await p.getByRole('heading', { name: 'You’re on the list.' }).waitFor();
  await p.getByRole('button', { name: 'Continue' }).click();
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
  console.log('Typing: steady letters, caret always visible');
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__ticks = [];
    window.__caretOff = 0;
    window.__samples = 0;
    const sample = () => {
      const typed = document.querySelector('.landing-body [aria-hidden]');
      const caret = document.querySelector('.landing-body .tw-caret');
      const full = document.querySelector('.landing-body .sr-only');
      if (typed && caret && full) {
        const n = typed.firstChild?.nodeType === 3 ? typed.firstChild.textContent.length : 0;
        if (n > 0 && n < full.textContent.length) {
          window.__samples++;
          if (parseFloat(getComputedStyle(caret, '::after').opacity) < 0.3) window.__caretOff++;
          const last = window.__ticks[window.__ticks.length - 1];
          if (!last || last[1] !== n) window.__ticks.push([performance.now(), n]);
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
  await p.waitForTimeout(4000);
  const r = await p.evaluate(() => ({ ticks: window.__ticks, off: window.__caretOff, samples: window.__samples }));
  const maxJump = Math.max(...r.ticks.slice(1).map((t, i) => t[1] - r.ticks[i][1]));
  report(maxJump <= 1, `never more than one new letter at a time, even after a 300ms freeze (largest: ${maxJump})`);
  report(r.off === 0, `caret visible in every frame while typing (${r.samples - r.off}/${r.samples})`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await keyboardCheck(browser);
  await typingCheck(browser);
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
