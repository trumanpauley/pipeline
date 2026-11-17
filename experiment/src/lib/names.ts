import { api } from './api';

// Client-side name check for instant feedback. The server applies the full
// rules (including the term list, which is never shipped to the browser) and
// is the authority: this only catches obvious problems early.
const ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M}\s'’ʼ.\-]*$/u;

export const NAME_REJECTED = 'Please enter a different name.';

export function quickNameOk(raw: string): boolean {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 40) return false;
  if (!ALLOWED.test(name)) return false;
  if (/(.)\1{4,}/u.test(name)) return false;
  if (/(^|\s)(www|https?)\b/i.test(name) || /[a-z]{2,}\.[a-z]{2,}/i.test(name)) return false;
  return true;
}

/** Quick local check, then the server's verdict. Resolves to true if the name is acceptable. */
export async function nameAcceptable(raw: string): Promise<boolean> {
  if (!quickNameOk(raw)) return false;
  try {
    return (await api.checkName(raw.trim())).ok;
  } catch {
    // If the check itself fails (e.g. offline), let the real request decide:
    // the server validates again when the name is saved.
    return true;
  }
}
