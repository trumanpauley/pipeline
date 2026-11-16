import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// A relative URL ("/") means "same origin" — used by the local demo, which proxies Supabase.
const url = rawUrl?.startsWith('/') ? window.location.origin + rawUrl.replace(/\/$/, '') : rawUrl;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isConfigured = Boolean(url && key && !url.includes('YOUR_PROJECT_REF'));

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Implicit flow lets a magic link work even when it opens in a different
    // browser than the one that requested it (e.g. Instagram → Safari).
    flowType: 'implicit',
  },
});
