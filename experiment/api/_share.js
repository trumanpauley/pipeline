// Shared by the link-preview functions (api/page.js, api/og.js).
//
// Messaging apps (iMessage, WhatsApp, Slack, X, LinkedIn...) build a link
// preview from the page's HTML without running JavaScript, so the preview tags
// for each experiment are written into the HTML on the server, here.
//
// Only an experiment's public display settings are used (title, description,
// image); never a sender, a participant or anything about the invitation.

/** Generic preview, used when an experiment has none of its own. */
export const DEFAULT_META = {
  title: 'You’ve been invited.',
  description: 'A short experiment about how people are connected.',
  siteName: 'The Experiment',
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const TOKEN = /^[A-Za-z0-9_-]{10,64}$/;

function env(name) {
  return (typeof process !== 'undefined' && process.env && process.env[name]) || '';
}

/** The project's Supabase address and public (publishable/anon) key: the same ones the app uses. */
export function supabaseConfig() {
  return {
    url: (env('VITE_SUPABASE_URL') || env('SUPABASE_URL')).replace(/\/+$/, ''),
    key: env('VITE_SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY'),
  };
}

/** The stable public address (the same rule as scripts/vercel-build.sh), else this request's. */
export function publicOrigin(requestUrl) {
  const raw = env('VITE_PUBLIC_APP_URL') || (env('VERCEL_PROJECT_PRODUCTION_URL') ? `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}` : '');
  try {
    if (raw) {
      const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
      return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    }
  } catch {
    /* fall through */
  }
  return new URL(requestUrl).origin;
}

/**
 * Which experiment a request is about. Vercel's rewrites pass ?slug= / ?token=;
 * the original path (/harvard-baseball/TOKEN, /harvard-baseball, /join/TOKEN,
 * /i/TOKEN) is read too, in case only that arrives.
 */
export function parseTarget(requestUrl) {
  const u = new URL(requestUrl);
  let slug = u.searchParams.get('slug') || '';
  let token = u.searchParams.get('token') || '';
  if (!slug && !token) {
    const parts = u.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'join' || parts[0] === 'i') && parts[1]) token = parts[1];
    else if (parts.length === 2) [slug, token] = parts;
    else if (parts.length === 1) slug = parts[0];
  }
  // Punctuation a messaging app glued onto the end of a pasted link.
  token = token.replace(/[/.,;:!?)\]'"’”]+$/, '');
  slug = slug.toLowerCase();
  return { slug: SLUG.test(slug) ? slug : null, token: TOKEN.test(token) ? token : null };
}

/** The experiment's preview settings from Supabase ({ found: false } if none, or on any failure). */
export async function fetchMeta({ slug, token }, { timeoutMs = 2000 } = {}) {
  const { url, key } = supabaseConfig();
  if (!url || !key || (!slug && !token)) return { found: false };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/rest/v1/rpc/experiment_share_meta`, {
      method: 'POST',
      // The public key only (as the browser app uses it); no user session.
      headers: { 'content-type': 'application/json', apikey: key },
      body: JSON.stringify({ p_slug: slug, p_token: token }),
      signal: ctl.signal,
    });
    if (!r.ok) return { found: false };
    const meta = await r.json();
    return meta && meta.found ? meta : { found: false };
  } catch {
    return { found: false };
  } finally {
    clearTimeout(timer);
  }
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Address of the generated preview image for an experiment (or the generic one). */
export function generatedImageUrl(origin, meta, target) {
  if (!meta.found) return `${origin}/api/og`;
  const q = meta.slug ? `s=${encodeURIComponent(meta.slug)}` : `t=${encodeURIComponent(target.token || '')}`;
  return `${origin}/api/og?${q}&v=${meta.version || 0}`;
}

/** Everything a crawler needs, for this experiment (or the generic preview). */
export function previewTags(meta, target, origin) {
  const title = (meta.found && meta.title) || DEFAULT_META.title;
  const description = (meta.found && meta.description) || DEFAULT_META.description;
  const image = (meta.found && meta.image_url) || generatedImageUrl(origin, meta, target);
  // The address being shared (the canonical form of a referral link keeps its token).
  const path = target.token
    ? meta.found && meta.slug ? `/${meta.slug}/${target.token}` : `/join/${target.token}`
    : target.slug ? `/${target.slug}` : '/';
  const pageUrl = `${origin}${path}`;
  const e = escapeHtml;
  return {
    title,
    html: [
      `<title>${e(title)}</title>`,
      `<meta name="description" content="${e(description)}" />`,
      `<link rel="canonical" href="${e(pageUrl)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${e(DEFAULT_META.siteName)}" />`,
      `<meta property="og:title" content="${e(title)}" />`,
      `<meta property="og:description" content="${e(description)}" />`,
      `<meta property="og:url" content="${e(pageUrl)}" />`,
      `<meta property="og:image" content="${e(image)}" />`,
      `<meta property="og:image:secure_url" content="${e(image)}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="${e(title)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${e(title)}" />`,
      `<meta name="twitter:description" content="${e(description)}" />`,
      `<meta name="twitter:image" content="${e(image)}" />`,
    ].join('\n    '),
  };
}

/** The app's index.html with its generic preview tags replaced by this experiment's. */
export function injectPreview(template, tags) {
  const stripped = template
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');
  return stripped.replace(/<\/head>/i, `    ${tags.html}\n  </head>`);
}
