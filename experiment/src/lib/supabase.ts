import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// A relative URL ("/") means "same origin" — used by the local demo, which proxies Supabase.
const url = rawUrl?.startsWith('/') ? window.location.origin + rawUrl.replace(/\/$/, '') : rawUrl;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isConfigured = Boolean(url && key && !url.includes('YOUR_PROJECT_REF'));

// Browser-only demo build: the backend runs in this tab (src/demo/localBackend.ts).
// The import is dead code in normal builds, so PGlite is never shipped there.
const demoFetch: typeof fetch | undefined =
  import.meta.env.VITE_DEMO_LOCAL === '1'
    ? (input, init) => import('../demo/localBackend').then((m) => m.localFetch(input, init))
    : undefined;

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  ...(demoFetch ? { global: { fetch: demoFetch } } : {}),
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Implicit flow lets a magic link work even when it opens in a different
    // browser than the one that requested it (e.g. Instagram → Safari).
    flowType: 'implicit',
  },
});
