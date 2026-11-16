import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
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
