// Rules for experiment link names and invitation wording. The server applies
// the same rules (migration 016); these give the admin form instant feedback.

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Words the app's own pages use (same list as px_reserved_slug). */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'callback', 'community', 'demo', 'edit', 'experiment',
  'experiments', 'favicon', 'health', 'help', 'home', 'i', 'index', 'invite', 'invites', 'join',
  'login', 'logout', 'new', 'null', 'og', 'pipeline', 'preview', 'privacy', 'public', 'robots',
  'settings', 'share', 'sign-in', 'signin', 'signup', 'sitemap', 'static', 'storage', 'support',
  'terms', 'undefined', 'waitlist', 'www',
]);

/** "Harvard Baseball" → "harvard-baseball". */
export const slugify = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

/** Why a link name can't be used, or null if it can (uniqueness is checked on save). */
export function slugProblem(slug: string): string | null {
  if (!slug) return null;
  if (!SLUG_PATTERN.test(slug) || slug.includes('--')) return 'Use 3–40 lowercase letters, numbers and single hyphens.';
  if (RESERVED_SLUGS.has(slug)) return 'That name is used by the app itself.';
  return null;
}

/** Wording that suggests official sponsorship or endorsement (same as px_sponsorship_wording). */
const SPONSORSHIP = new RegExp(
  [
    '\\b(official|officially|sponsor|sponsors|sponsored|sponsorship|endorse|endorsed|endorses|endorsement)\\b',
    '\\bon behalf of\\b',
    '\\b(approved|sanctioned|authori[sz]ed|funded|commissioned|backed|supported) by\\b',
    '\\bin (partnership|collaboration|association|affiliation) with\\b',
  ].join('|'),
  'i',
);
export const suggestsSponsorship = (...texts: (string | null | undefined)[]) =>
  texts.some((t) => Boolean(t) && SPONSORSHIP.test(t!));
