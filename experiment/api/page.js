// Serves the app's page for invitation and experiment links, with that
// experiment's link-preview tags already in the HTML:
//   /harvard-baseball/TOKEN   a referral or seed link (TOKEN = the invitation)
//   /harvard-baseball         the experiment's public page
//   /join/TOKEN, /i/TOKEN     links sent before custom addresses (unchanged)
// vercel.json rewrites those paths here. The page then loads the normal app,
// which reads the path itself, so nothing about the invitation changes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchMeta, injectPreview, parseTarget, previewTags, publicOrigin } from './_share.js';

let cachedTemplate = null;

async function template(requestUrl) {
  if (cachedTemplate) return cachedTemplate;
  // The built app's index.html (bundled with this function; see vercel.json).
  const file = process.env.PX_INDEX_HTML || path.join(process.cwd(), 'dist', 'index.html');
  try {
    cachedTemplate = await readFile(file, 'utf8');
    return cachedTemplate;
  } catch {
    // Otherwise the same file from this deployment.
    const r = await fetch(new URL('/index.html', requestUrl));
    if (!r.ok) throw new Error(`index.html: ${r.status}`);
    return r.text();
  }
}

export async function GET(request) {
  const target = parseTarget(request.url);
  const [html, meta] = await Promise.all([template(request.url), fetchMeta(target)]);
  const page = injectPreview(html, previewTags(meta, target, publicOrigin(request.url)));
  return new Response(page, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short CDN cache: preview edits show up within minutes; every deploy starts fresh.
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
      'x-robots-tag': 'noindex',
    },
  });
}
