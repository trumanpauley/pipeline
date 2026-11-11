import { supabase } from './supabase';
import type {
  AcceptResult, ConsentRow, EventRow, GuestDashboard, GuestRow, InvitationLookup,
  InvitationRow, MyEvent, ReferralRow, RemovalRequestRow, RsvpStatus,
} from './types';

export class ApiError extends Error {}

// Postgres errors raised by our functions carry user-facing messages.
export function friendlyMessage(error: { message?: string; code?: string } | null | undefined): string {
  const msg = error?.message ?? '';
  if (/failed to fetch|network/i.test(msg)) return 'Connection problem. Check your signal and try again.';
  if (/token has expired|otp.*(expired|invalid)|invalid.*otp/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
  if (/rate limit|security purposes/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/JWT|not signed in/i.test(msg)) return 'Your session expired. Please sign in again.';
  return msg || 'Something went wrong. Please try again.';
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(friendlyMessage(error));
  return data as T;
}

export const api = {
  getInvitation: (token: string) => rpc<InvitationLookup>('get_invitation', { p_token: token }),
  acceptInvitation: (token: string, fullName: string, marketingConsent: boolean) =>
    rpc<AcceptResult>('accept_invitation', {
      p_token: token, p_full_name: fullName, p_marketing_consent: marketingConsent,
    }),
  myEvents: () => rpc<MyEvent[]>('my_events'),
  guestDashboard: (eventId: string) => rpc<GuestDashboard>('guest_dashboard', { p_event_id: eventId }),
  rotateInvitation: (invitationId: string) => rpc<string>('rotate_invitation', { p_invitation_id: invitationId }),
  setRsvpStatus: (eventId: string, status: RsvpStatus) =>
    rpc<RsvpStatus>('set_rsvp_status', { p_event_id: eventId, p_status: status }),
  setMarketingConsent: (eventId: string, granted: boolean) =>
    rpc<boolean>('set_marketing_consent', { p_event_id: eventId, p_granted: granted }),
  requestRemoval: (eventId: string, note: string) =>
    rpc<void>('request_data_removal', { p_event_id: eventId, p_note: note }),
  createHostInvitations: (eventId: string, count: number) =>
    rpc<InvitationRow[]>('organizer_create_invitations', { p_event_id: eventId, p_count: count }),
  setRsvpOpen: (eventId: string, open: boolean) =>
    rpc<boolean>('organizer_set_rsvp_open', { p_event_id: eventId, p_open: open }),
  processRemoval: (requestId: string, action: 'complete' | 'dismiss') =>
    rpc<void>('organizer_process_removal', { p_request_id: requestId, p_action: action }),
};

// Supabase caps responses (1000 rows by default); page through everything.
async function selectAll<T>(table: string, eventId: string, order = 'created_at'): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('event_id', eventId)
      .order(order, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new ApiError(friendlyMessage(error));
    rows.push(...(data as T[]));
    if (!data || data.length < pageSize) return rows;
  }
}

export interface OrganizerData {
  event: EventRow;
  guests: GuestRow[];
  invitations: InvitationRow[];
  referrals: ReferralRow[];
  consents: ConsentRow[];
  removals: RemovalRequestRow[];
}

export async function loadOrganizerData(eventId: string): Promise<OrganizerData> {
  const { data: event, error } = await supabase.from('events').select('*').eq('id', eventId).single();
  if (error) throw new ApiError(friendlyMessage(error));
  const [guests, invitations, referrals, consents, removals] = await Promise.all([
    selectAll<GuestRow>('event_guests', eventId),
    selectAll<InvitationRow>('event_invitations', eventId),
    selectAll<ReferralRow>('event_referrals', eventId),
    selectAll<ConsentRow>('event_consents', eventId),
    selectAll<RemovalRequestRow>('event_removal_requests', eventId, 'requested_at'),
  ]);
  return { event: event as EventRow, guests, invitations, referrals, consents, removals };
}
