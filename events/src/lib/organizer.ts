import type { OrganizerData } from './api';
import type { CsvValue } from './csv';
import type { ConsentRow, GuestRow } from './types';

export interface LatestConsent {
  granted: boolean;
  at: string;
  textId: string;
}

/** Most recent marketing consent decision per guest (the log is append-only). */
export function latestMarketingConsent(consents: ConsentRow[]): Map<string, LatestConsent> {
  const latest = new Map<string, LatestConsent>();
  for (const c of consents) {
    if (c.consent_type !== 'pipeline_marketing') continue;
    const prev = latest.get(c.guest_id);
    if (!prev || c.created_at >= prev.at) {
      latest.set(c.guest_id, { granted: c.granted, at: c.created_at, textId: c.consent_text_id });
    }
  }
  return latest;
}

export interface GrowthPoint {
  day: string; // YYYY-MM-DD (local)
  added: number;
  total: number;
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Guests joined per day with running total (hosts excluded). */
export function growthByDay(guests: Pick<GuestRow, 'created_at' | 'role'>[]): GrowthPoint[] {
  const counts = new Map<string, number>();
  for (const g of guests) {
    if (g.role !== 'guest') continue;
    const day = localDay(g.created_at);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let total = 0;
  return [...counts.keys()].sort().map(day => {
    const added = counts.get(day)!;
    total += added;
    return { day, added, total };
  });
}

export interface OrganizerStats {
  attending: number;
  declined: number;
  capacity: number;
  openInvites: number;
  acceptedInvites: number;
  acceptanceRate: number; // accepted / (accepted + open), 0..1
  maxDepth: number;
  byDepth: { depth: number; count: number }[];
  topInviters: { guestId: string; name: string; accepted: number }[];
}

export function computeStats(data: OrganizerData): OrganizerStats {
  const { guests, invitations, referrals, event } = data;
  const attending = guests.filter(g => g.rsvp_status === 'attending').length;
  const declined = guests.filter(g => g.rsvp_status === 'declined' && !g.anonymized_at).length;
  const openInvites = invitations.filter(i => i.status === 'open').length;
  const acceptedInvites = invitations.filter(i => i.status === 'accepted').length;
  const depthCounts = new Map<number, number>();
  for (const g of guests) depthCounts.set(g.depth, (depthCounts.get(g.depth) ?? 0) + 1);
  const byDepth = [...depthCounts.entries()].sort((a, b) => a[0] - b[0]).map(([depth, count]) => ({ depth, count }));

  const names = new Map(guests.map(g => [g.id, g.full_name]));
  const perInviter = new Map<string, number>();
  for (const r of referrals) perInviter.set(r.inviter_guest_id, (perInviter.get(r.inviter_guest_id) ?? 0) + 1);
  const topInviters = [...perInviter.entries()]
    .map(([guestId, accepted]) => ({ guestId, name: names.get(guestId) ?? 'Unknown', accepted }))
    .sort((a, b) => b.accepted - a.accepted || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    attending,
    declined,
    capacity: event.capacity,
    openInvites,
    acceptedInvites,
    acceptanceRate: acceptedInvites + openInvites === 0 ? 0 : acceptedInvites / (acceptedInvites + openInvites),
    maxDepth: byDepth.length ? byDepth[byDepth.length - 1].depth : 0,
    byDepth,
    topInviters,
  };
}

export const GUEST_CSV_HEADERS = [
  'guest_id', 'full_name', 'email', 'role', 'rsvp_status', 'rsvp_updated_at', 'depth',
  'invited_by_guest_id', 'invited_by_name', 'joined_at', 'invitations_accepted',
  'marketing_consent', 'marketing_consent_at', 'marketing_consent_text_id', 'anonymized_at',
];

export function guestCsvRows(data: OrganizerData): CsvValue[][] {
  const byId = new Map(data.guests.map(g => [g.id, g]));
  const parentOf = new Map(data.referrals.map(r => [r.invitee_guest_id, r.inviter_guest_id]));
  const acceptedCount = new Map<string, number>();
  for (const r of data.referrals) acceptedCount.set(r.inviter_guest_id, (acceptedCount.get(r.inviter_guest_id) ?? 0) + 1);
  const consent = latestMarketingConsent(data.consents);
  return data.guests.map(g => {
    const parentId = parentOf.get(g.id) ?? null;
    const c = consent.get(g.id);
    return [
      g.id, g.full_name, g.email, g.role, g.rsvp_status, g.rsvp_updated_at, g.depth,
      parentId, parentId ? byId.get(parentId)?.full_name : null, g.created_at,
      acceptedCount.get(g.id) ?? 0, c ? c.granted : null, c?.at, c?.textId, g.anonymized_at,
    ];
  });
}

export const REFERRAL_CSV_HEADERS = ['referral_id', 'inviter_guest_id', 'invitee_guest_id', 'invitation_id', 'created_at'];

export function referralCsvRows(data: OrganizerData): CsvValue[][] {
  return data.referrals.map(r => [r.id, r.inviter_guest_id, r.invitee_guest_id, r.invitation_id, r.created_at]);
}

export const CONSENT_CSV_HEADERS = ['consent_id', 'guest_id', 'consent_type', 'granted', 'consent_text_id', 'source', 'created_at'];

export function consentCsvRows(data: OrganizerData): CsvValue[][] {
  return data.consents.map(c => [c.id, c.guest_id, c.consent_type, c.granted, c.consent_text_id, c.source, c.created_at]);
}
