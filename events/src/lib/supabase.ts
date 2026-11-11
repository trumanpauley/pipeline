import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

function describeProblem(): string | null {
  if (!url || !key) return 'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set.';
  if (url.includes('YOUR_PROJECT_REF') || key.includes('YOUR_SUPABASE')) return 'The Supabase values are still the placeholders from .env.example.';
  if (!/^https?:\/\/[^\s"']+$/.test(url)) return `VITE_SUPABASE_URL should look like https://abcd1234.supabase.co (got "${url}").`;
  if (/["'\s]/.test(key)) return 'VITE_SUPABASE_PUBLISHABLE_KEY contains quotes or spaces. Paste only the key itself.';
  if (/^sb_secret_/.test(key) || /service_role/.test(atobSafe(key.split('.')[1] ?? ''))) {
    return 'That is the secret/service-role key. Use the publishable (sb_publishable_…) or anon key instead.';
  }
  return null;
}

function atobSafe(s: string): string {
  try {
    return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}

let client: SupabaseClient | null = null;
let problem = describeProblem();
if (!problem) {
  try {
    client = createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    problem = `Could not connect to Supabase: ${(e as Error).message}`;
  }
}

export const configProblem = problem;
export const isConfigured = client !== null;
export const supabase: SupabaseClient = client as SupabaseClient;
