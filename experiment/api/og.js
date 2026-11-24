// The generated link-preview image (1200×630 PNG): the network mark and the
// experiment's title, in the app's style. Used when an experiment has no
// uploaded preview image. /api/og?s=SLUG (or ?t=TOKEN); no query = generic.
// Only the experiment's public title and description are drawn.
import { ImageResponse } from '@vercel/og';
import { DEFAULT_META, fetchMeta } from './_share.js';

const W = 1200;
const H = 630;
const BG = '#09090B';
const INK = '#E8EAF0';
const ACCENT = '#8FB5FF';

/** Small deterministic random numbers, so each experiment keeps the same pattern. */
function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** The network: nodes on the right, fading toward the text, joined when near. */
export function networkSvg(seedText) {
  const rand = rng(seedText || 'network');
  const nodes = [];
  for (let i = 0; i < 34; i++) {
    nodes.push({ x: 560 + rand() * 660, y: -20 + rand() * (H + 40), r: 1.6 + rand() * 2.8, accent: false });
  }
  // Three highlighted people, well clear of the text.
  nodes.filter((n) => n.x > 800 && n.y > 40 && n.y < H - 40).slice(0, 3).forEach((n) => { n.accent = true; });
  const fade = (x) => Math.max(0, Math.min(1, (x - 540) / 380));
  let lines = '';
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 190) continue;
      const o = (0.08 + 0.22 * (1 - d / 190)) * fade(Math.min(a.x, b.x));
      lines += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${INK}" stroke-opacity="${o.toFixed(3)}" stroke-width="1.4"/>`;
    }
  }
  let dots = '';
  for (const n of nodes) {
    const o = n.accent ? 0.95 : (0.25 + 0.45 * rand()) * fade(n.x);
    if (n.accent) dots += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r * 4).toFixed(1)}" fill="${ACCENT}" fill-opacity="0.18"/>`;
    dots += `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.accent ? n.r + 1.6 : n.r).toFixed(1)}" fill="${n.accent ? ACCENT : INK}" fill-opacity="${o.toFixed(3)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lines}${dots}</svg>`;
}

/** The small three-node mark used next to the site name. */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><g stroke="${INK}" stroke-opacity="0.55" stroke-width="2"><line x1="10" y1="32" x2="22" y2="11"/><line x1="22" y1="11" x2="35" y2="28"/><line x1="10" y1="32" x2="35" y2="28"/></g><circle cx="10" cy="32" r="4.5" fill="${INK}"/><circle cx="35" cy="28" r="4.5" fill="${INK}"/><circle cx="22" cy="11" r="5.5" fill="${ACCENT}"/></svg>`;

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const h = (type, style, children) => ({ type, props: { style, children } });
const img = (src, width, height, style = {}) => ({ type: 'img', props: { src, width, height, style } });

export function card({ title, description }) {
  const big = title.length > 46 ? 58 : 70;
  return h('div', { width: W, height: H, display: 'flex', position: 'relative', background: BG, color: INK, fontFamily: 'sans-serif' }, [
    img(dataUri(networkSvg(title)), W, H, { position: 'absolute', left: 0, top: 0 }),
    h('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 720, height: H, padding: '64px 0 60px 72px' }, [
      h('div', { display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, color: '#A1A1AA', letterSpacing: 1 }, [
        img(dataUri(MARK), 44, 44),
        DEFAULT_META.siteName,
      ]),
      h('div', { display: 'flex', flexDirection: 'column', gap: 22 }, [
        h('div', { display: 'flex', fontSize: big, lineHeight: 1.08, color: '#FFFFFF', letterSpacing: -1.5 }, title),
        description ? h('div', { display: 'flex', fontSize: 30, lineHeight: 1.35, color: '#A1A1AA' }, description) : h('div', { display: 'flex' }, ''),
      ]),
      h('div', { display: 'flex', height: 8 }, ''),
    ]),
  ]);
}

export async function GET(request) {
  const u = new URL(request.url);
  const slug = u.searchParams.get('s');
  const token = u.searchParams.get('t');
  const meta = slug || token ? await fetchMeta({ slug, token }) : { found: false };
  const title = (meta.found && meta.title) || DEFAULT_META.title;
  const description = (meta.found && meta.description) || (meta.found ? '' : DEFAULT_META.description);
  const res = new ImageResponse(card({ title, description }), { width: W, height: H });
  const headers = new Headers(res.headers);
  headers.set('content-type', 'image/png');
  // Versioned addresses (?v=) change whenever the settings do, so they can be cached for long.
  headers.set('cache-control', u.searchParams.get('v') && meta.found
    ? 'public, max-age=86400, s-maxage=31536000, immutable'
    : 'public, max-age=300, s-maxage=3600');
  return new Response(res.body, { status: 200, headers });
}
