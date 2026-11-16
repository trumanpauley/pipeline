import { useEffect, useState } from 'react';

// A tiny router — three routes don't justify a dependency.
// Normal builds use real paths (/i/abc). The browser-only demo build
// (VITE_HASH_ROUTER=1) uses #/i/abc so it works on any static host.
const HASH = import.meta.env.VITE_HASH_ROUTER === '1';

/** Current location as "/path?query", in either mode. */
function current(): string {
  if (HASH) return window.location.hash.replace(/^#/, '') || '/';
  return window.location.pathname + window.location.search;
}

export function currentQuery(): URLSearchParams {
  return new URLSearchParams(current().split('?')[1] ?? '');
}

/** Absolute URL for an in-app path, e.g. an invitation link to share. */
export function appUrl(path: string): string {
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
