export function formatEventDate(startsAt: string | null, endsAt?: string | null): string {
  if (!startsAt) return 'Date to be announced';
  const start = new Date(startsAt);
  const date = start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return `${date} · ${time}`;
  const end = new Date(endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}–${end}`;
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function inviteUrl(token: string): string {
  return `${window.location.origin}/i/${encodeURIComponent(token)}`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Date and time as separate lines for the event header. */
export function eventWhen(startsAt: string | null, endsAt?: string | null): { date: string; time: string | null } {
  if (!startsAt) return { date: 'Date to be announced', time: null };
  const start = new Date(startsAt);
  const date = start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return { date, time: endsAt ? `${t(start)} – ${t(new Date(endsAt))}` : t(start) };
}
