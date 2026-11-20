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

export const NAME_FORMAT_HELP = 'Enter your first name and last initial, like “James P.”';

const initcap = (s: string) =>
  s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/**
 * "First L." — a first name (one or two words) and a single last initial.
 * Returns the tidy form ("james  p" → "James P.", "Sarah M." stays), or null
 * if it isn't one (a full surname, a missing initial, digits…). Mirrors the
 * server's px_format_name, which is the authority.
 */
export function formatName(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, ' ');
  const m = v.match(/^([^\s.]+(?: [^\s.]+)?) ([^\s.'’ʼ-])\.?$/u);
  if (!m) return null;
  let first = m[1];
  const initial = m[2];
  if (initial.toUpperCase() === initial.toLowerCase() || [...first].length > 30) return null;
  first = first === first.toLowerCase() || first === first.toUpperCase()
    ? initcap(first)
    : first.charAt(0).toUpperCase() + first.slice(1);
  return `${first} ${initial.toUpperCase()}.`;
}
