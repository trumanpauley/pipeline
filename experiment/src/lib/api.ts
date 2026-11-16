import { supabase } from './supabase';
import type { MethodKey } from '../config/experiment';

export type InvitationStatus = 'created' | 'opened' | 'accepted' | 'duplicate' | 'revoked';

export interface MyAccount {
  is_anonymous: boolean;
  linked_email: string | null;
  waitlist_email: string | null;
}

export interface AdminAccountStats {
  anonymous: number;
  linked_emails: number;
  waitlist: number;
  flagged_same_network: number;
}

export interface OpenResult {
  state: 'ok' | 'invalid' | 'used' | 'own' | 'joined' | 'rate_limited';
  sender_name?: string | null;
  method?: MethodKey;
  answered?: boolean;
  already_participant?: boolean;
}

export interface MyInvitation {
  id: string;
  token: string;
  recipient_label: string | null;
  status: InvitationStatus;
  created_at: string;
  opened_at: string | null;
  accepted_at: string | null;
}

export interface BranchNode {
  k: number;
  p: number | null;
  g: number;
  label: string | null;
}

export interface MyState {
  is_admin: boolean;
  participant: null | {
    display_name: string;
    email: string;
    method: MethodKey;
    depth: number;
    reveal_level: number;
    revealed_via: 'invite' | 'feedback' | null;
    marketing_consent: boolean;
    created_at: string;
  };
  max_invites?: number;
  feedback_question?: string;
  reveals?: { title: string }[];
  invitations?: MyInvitation[];
  branch?: BranchNode[];
  network?: { participants: number; generations: number };
}

const MESSAGES: Record<string, string> = {
  invalid_invitation: 'This invitation isn’t active.',
  invitation_used: 'This invitation has already been used.',
  self_invite: 'You can’t accept your own invitation.',
  consent_required: 'Please agree to take part in the research to continue.',
  invalid_name: 'Please enter your first name.',
  invite_limit: 'You’ve used both invitations.',
  link_limit: 'You’ve reached the limit for new links.',
  invalid_value: 'Please choose an answer.',
  invalid_label: 'That name is too long.',
  not_participant: 'You’re not part of the experiment yet.',
  not_authenticated: 'Please sign in again.',
  forbidden: 'You don’t have access to this.',
  cannot_revoke: 'That link can’t be removed anymore.',
  invalid_answer: 'Please write a short answer.',
  invalid_email: 'Enter a valid email.',
  rate_limited: 'Too many attempts from this network. Try again in a little while.',
  device_already_joined: 'This browser is already part of the experiment. Open the link on your own phone.',
};

export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(MESSAGES[code] ?? 'Something went wrong. Please try again.');
    this.code = code;
  }
}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(error.message);
  return data as T;
}

export const api = {
  openInvitation: (token: string) => rpc<OpenResult>('open_invitation', { p_token: token }),
  answerInvitation: (token: string, value: string, ms: number) =>
    rpc('answer_invitation', { p_token: token, p_value: value, p_response_ms: ms }),
  acceptInvitation: (token: string, name: string, research: boolean, device: string) =>
    rpc<{ state: 'joined' | 'already_participant' }>('accept_invitation', {
      p_token: token,
      p_display_name: name,
      p_research_consent: research,
      p_marketing_consent: false, // never collected at join; see the waitlist instead
      p_device: device,
    }),
  createInvitation: (value: string, label: string | null, ms: number) =>
    rpc<{ id: string; token: string }>('create_invitation', {
      p_value: value,
      p_recipient_label: label,
      p_response_ms: ms,
    }),
  revokeInvitation: (id: string) => rpc('revoke_invitation', { p_invitation_id: id }),
  submitFeedback: (answer: string) => rpc('submit_feedback', { p_answer: answer }),
  setMarketingConsent: (consent: boolean) => rpc('set_marketing_consent', { p_consent: consent }),
  getMyState: () => rpc<MyState>('get_my_state'),
  getMyAccount: () => rpc<MyAccount>('get_my_account'),
  joinWaitlist: (email: string, source: string) => rpc('join_waitlist', { p_email: email, p_source: source }),
  leaveWaitlist: () => rpc('leave_waitlist'),
  adminAccountStats: () => rpc<AdminAccountStats>('admin_account_stats'),
  deleteMyData: () => rpc('delete_my_data'),
  // admin
  adminOverview: () => rpc<AdminOverview>('admin_overview'),
  adminExport: (kind: string) => rpc<Record<string, unknown>[]>('admin_export', { p_kind: kind }),
  adminCreateSeeds: (count: number, senderName: string, note: string) =>
    rpc<{ id: string; token: string }[]>('admin_create_seed_invitations', {
      p_count: count,
      p_sender_name: senderName,
      p_note: note,
    }),
  adminRevoke: (id: string) => rpc('admin_revoke_invitation', { p_invitation_id: id }),
};

export const inviteUrl = (token: string) => `${window.location.origin}/i/${token}`;

export interface AdminOverview {
  totals: {
    participants: number;
    verified_emails: number;
    marketing_opt_in: number;
    deleted: number;
    seed_participants: number;
    max_depth: number;
    feedback: number;
  };
  invitations: Record<
    | 'generated' | 'opened' | 'answered' | 'accepted' | 'duplicate' | 'revoked'
    | 'seed_generated' | 'seed_opened' | 'seed_accepted',
    number
  >;
  by_depth: { depth: number; participants: number; inviters: number; links: number; opened: number; accepted: number }[];
  distribution: { method: string; direction: 'inbound' | 'outbound'; value: string; n: number }[];
  methods: {
    method: string;
    participants: number;
    opened: number;
    answered: number;
    joined: number;
    inviters: number;
    links: number;
    links_accepted: number;
    chose_feedback: number;
    median_ms_inbound: number | null;
    median_ms_outbound: number | null;
  }[];
  reciprocity: {
    pairs: number;
    same_method_pairs: number;
    same_method_exact_agreement: number;
    scored_pairs: number;
    mean_abs_score_gap: number | null;
    mean_out_minus_in: number | null;
    matrix: { out_method: string; out_value: string; in_method: string; in_value: string; n: number }[];
  };
  seeds: {
    id: string;
    token: string;
    sender_name: string | null;
    note: string | null;
    status: InvitationStatus;
    opened_at: string | null;
    accepted_at: string | null;
    created_at: string;
    branch_size: number;
  }[];
  tree: { id: string; parent: string | null; depth: number; method: string; deleted: boolean }[];
  settings: Record<string, unknown>;
}
