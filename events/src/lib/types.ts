export type InvitationStatus = 'open' | 'used' | 'full' | 'closed' | 'not_found';

export interface PublicEvent {
  id: string;
  name: string;
  description: string;
  starts_at: string | null;
  ends_at: string | null;
  location_name: string;
}

export interface ConsentText {
  id: string;
  body: string;
}

export interface InvitationLookup {
  status: InvitationStatus;
  event?: PublicEvent;
  inviter_name?: string;
  consent_texts?: { event_rsvp: ConsentText; pipeline_marketing: ConsentText };
}

export interface AcceptResult {
  result: 'accepted' | 'already_guest';
  event_id: string;
  guest_id: string;
}

export interface MyEvent {
  event_id: string;
  name: string;
  starts_at: string | null;
  role: 'host' | 'guest';
  rsvp_status: RsvpStatus;
}

export type RsvpStatus = 'attending' | 'declined';

export interface DashboardInvitation {
  id: string;
  slot: number;
  status: 'open' | 'accepted' | 'revoked';
  token: string | null;
  accepted_at: string | null;
  accepted_name: string | null;
}

export interface GuestDashboard {
  event: PublicEvent & { private_details: string; rsvp_open: boolean };
  guest: {
    id: string;
    full_name: string;
    email: string;
    role: 'host' | 'guest';
    rsvp_status: RsvpStatus;
    depth: number;
    created_at: string;
  };
  path: { name: string; role: 'host' | 'guest'; is_you: boolean }[];
  invitations: DashboardInvitation[];
  marketing_consent: boolean;
  marketing_consent_text: string;
  removal_requested: boolean;
}

// Rows readable by hosts through RLS.
export interface EventRow extends PublicEvent {
  slug: string;
  private_details: string;
  capacity: number;
  rsvp_open: boolean;
  created_at: string;
}

export interface GuestRow {
  id: string;
  event_id: string;
  role: 'host' | 'guest';
  full_name: string;
  email: string | null;
  rsvp_status: RsvpStatus;
  rsvp_updated_at: string;
  depth: number;
  created_at: string;
  anonymized_at: string | null;
}

export interface InvitationRow {
  id: string;
  inviter_guest_id: string;
  slot: number;
  token: string;
  status: 'open' | 'accepted' | 'revoked';
  accepted_guest_id: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface ReferralRow {
  id: string;
  inviter_guest_id: string;
  invitee_guest_id: string;
  invitation_id: string;
  created_at: string;
}

export interface ConsentRow {
  id: string;
  guest_id: string;
  consent_text_id: string;
  consent_type: 'event_rsvp' | 'pipeline_marketing';
  granted: boolean;
  source: string;
  created_at: string;
}

export interface RemovalRequestRow {
  id: string;
  guest_id: string;
  note: string;
  status: 'pending' | 'completed' | 'dismissed';
  requested_at: string;
  processed_at: string | null;
}
