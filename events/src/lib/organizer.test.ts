import { describe, expect, it } from 'vitest';
import type { OrganizerData } from './api';
import { computeStats, growthByDay, guestCsvRows, latestMarketingConsent, GUEST_CSV_HEADERS } from './organizer';
import type { ConsentRow, GuestRow, InvitationRow, ReferralRow } from './types';

const guest = (id: string, extra: Partial<GuestRow> = {}): GuestRow => ({
  id, event_id: 'e', role: 'guest', full_name: id.toUpperCase(), email: `${id}@x.com`,
  rsvp_status: 'attending', rsvp_updated_at: '2026-11-01T10:00:00Z', depth: 1,
  created_at: '2026-11-01T10:00:00Z', anonymized_at: null, ...extra,
});
const inv = (id: string, inviter: string, status: InvitationRow['status']): InvitationRow => ({
  id, inviter_guest_id: inviter, slot: 1, token: id.padEnd(24, 'x'), status,
  accepted_guest_id: null, accepted_at: status === 'accepted' ? '2026-11-01T10:00:00Z' : null, created_at: '2026-11-01T09:00:00Z',
});
const ref = (inviter: string, invitee: string): ReferralRow => ({
  id: `r-${invitee}`, inviter_guest_id: inviter, invitee_guest_id: invitee, invitation_id: `i-${invitee}`, created_at: '2026-11-01T10:00:00Z',
});
const consent = (guestId: string, granted: boolean, at: string): ConsentRow => ({
  id: `${guestId}-${at}`, guest_id: guestId, consent_text_id: 'pipeline_marketing.v1', consent_type: 'pipeline_marketing',
  granted, source: 'rsvp_form', created_at: at,
});

const data: OrganizerData = {
  event: { id: 'e', slug: 'party', name: 'Party', description: '', starts_at: null, ends_at: null, location_name: '', private_details: '', capacity: 400, rsvp_open: true, created_at: '' },
  guests: [
    guest('host', { role: 'host', depth: 0 }),
    guest('a'),
    guest('b', { depth: 2, created_at: '2026-11-02T10:00:00Z' }),
    guest('c', { depth: 2, rsvp_status: 'declined', created_at: '2026-11-02T11:00:00Z' }),
  ],
  invitations: [inv('i-a', 'host', 'accepted'), inv('i-b', 'a', 'accepted'), inv('i-c', 'a', 'accepted'), inv('i-x', 'b', 'open')],
  referrals: [ref('host', 'a'), ref('a', 'b'), ref('a', 'c')],
  consents: [consent('a', true, '2026-11-01T10:00:00Z'), consent('a', false, '2026-11-03T10:00:00Z'), consent('b', true, '2026-11-02T10:00:00Z')],
  removals: [],
};

describe('organizer stats', () => {
  it('counts attendance, invitations and depth', () => {
    const s = computeStats(data);
    expect(s.attending).toBe(3);
    expect(s.declined).toBe(1);
    expect(s.openInvites).toBe(1);
    expect(s.acceptedInvites).toBe(3);
    expect(s.acceptanceRate).toBeCloseTo(0.75);
    expect(s.maxDepth).toBe(2);
    expect(s.byDepth).toEqual([{ depth: 0, count: 1 }, { depth: 1, count: 1 }, { depth: 2, count: 2 }]);
    expect(s.topInviters[0]).toEqual({ guestId: 'a', name: 'A', accepted: 2 });
  });

  it('uses the latest consent decision', () => {
    const latest = latestMarketingConsent(data.consents);
    expect(latest.get('a')?.granted).toBe(false);
    expect(latest.get('b')?.granted).toBe(true);
    expect(latest.has('c')).toBe(false);
  });

  it('computes cumulative growth excluding hosts', () => {
    const g = growthByDay(data.guests);
    expect(g.map(p => p.added)).toEqual([1, 2]);
    expect(g[g.length - 1].total).toBe(3);
  });

  it('exports one CSV row per guest with inviter and consent', () => {
    const rows = guestCsvRows(data);
    const col = (name: string) => GUEST_CSV_HEADERS.indexOf(name);
    expect(rows).toHaveLength(4);
    const b = rows.find(r => r[0] === 'b')!;
    expect(b[col('invited_by_name')]).toBe('A');
    expect(b[col('marketing_consent')]).toBe(true);
    const a = rows.find(r => r[0] === 'a')!;
    expect(a[col('invitations_accepted')]).toBe(2);
    expect(a[col('marketing_consent')]).toBe(false);
    expect(rows.find(r => r[0] === 'c')![col('marketing_consent')]).toBe(null);
  });
});
