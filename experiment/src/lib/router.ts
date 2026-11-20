import { useEffect, useState } from 'react';

// A tiny router — three routes don't justify a dependency.
// Normal builds use real paths (/join/abc). The browser-only demo build
// (VITE_HASH_ROUTER=1) uses #/join/abc so it works on any static host.
// Invitation links from earlier versions (/i/abc, #/i/abc) keep working.
const HASH = import.meta.env.VITE_HASH_ROUTER === '1';

// Hash builds: a shared path-style link (/join/abc or /i/abc) is moved into
// the hash on load, so the same permanent link works with either build.
if (HASH && typeof window !== 'undefined') {
  const m = window.location.pathname.match(/^(.*?\/)(join|i)\/([A-Za-z0-9_-]{10,64})\/?$/);
  if (m && !window.location.hash.replace(/^#\/?/, '')) {
    window.history.replaceState(null, '', `${m[1]}#/join/${m[3]}`);
  }
}

/** Current location as "/path?query", in either mode. */
function current(): string {
  if (HASH) return window.location.hash.replace(/^#/, '') || '/';
  return window.location.pathname + window.location.search;
}

export function currentQuery(): URLSearchParams {
  return new URLSearchParams(current().split('?')[1] ?? '');
}

/**
 * The stable public address of the app (e.g. https://pipeline-experiment.vercel.app),
 * from VITE_PUBLIC_APP_URL. On Vercel the build sets it from the project's
 * production domain automatically (scripts/vercel-build.sh). Shared links use it
 * so they never point at a deployment-specific URL, which Vercel may protect
 * behind a Vercel sign-in. Unset (local dev, tests): the current address.
 */
const PUBLIC_URL = (() => {
  const raw = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
})();

/** Absolute URL for an in-app path, e.g. an invitation link to share. */
export function appUrl(path: string): string {
  // Hash builds served from the site root (Vercel) can take path-style links
  // too; builds with relative asset paths (served from a sub-folder) can't.
  if (PUBLIC_URL) return HASH && import.meta.env.BASE_URL !== '/' ? `${PUBLIC_URL}/#${path}` : `${PUBLIC_URL}${path}`;
  if (HASH) return `${window.location.href.split('#')[0]}#${path}`;
  return `${window.location.origin}${path}`;
}

export function navigate(path: string, replace = false) {
  const target = HASH ? `${window.location.href.split('#')[0]}#${path}` : path;
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  window.dispatchEvent(new Event('px:navigate'));
  window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(() => current().split('?')[0]);
  useEffect(() => {
    const update = () => setPath(current().split('?')[0]);
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    window.addEventListener('px:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
      window.removeEventListener('px:navigate', update);
    };
  }, []);
  return path;
}
