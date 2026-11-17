// Optional phone verification ("save your network"). Off unless the build sets
// VITE_PHONE_AUTH=1, which should only happen once Supabase Phone Auth and an
// SMS provider are configured (see README → Optional phone verification).
export const phoneEnabled = import.meta.env.VITE_PHONE_AUTH === '1';

/**
 * Normalise what someone typed to E.164 (+15551234567), which Supabase expects.
 * Ten digits are treated as a US number; anything else needs a leading +country code.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Friendly display: +1 (617) 555-0142 for US numbers, otherwise as stored. */
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
