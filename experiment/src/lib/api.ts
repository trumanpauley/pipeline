import { supabase } from './supabase';
import { appUrl } from './router';
import type { MethodKey } from '../config/experiment';

export type InvitationStatus = 'created' | 'opened' | 'accepted' | 'duplicate' | 'revoked';

export interface AdminMethodStats {
  methods: {
    method: string;
    participants: number;
    in_shown: number;
    in_completed: number;
    out_shown: number;
    out_completed: number;
    in_avg_strength: number | null;
    out_avg_strength: number | null;
    in_median_ms: number | null;
    out_median_ms: number | null;
    answers: number;
  }[];
  circular_bands: { ord: number; label: string; inbound: number; outbound: number }[];
  circular_bins: { bin: number; n: number }[];
  agreement: { sender_method: string; recipient_method: string; pairs: number; mean_abs_gap: number | null; mean_sender_minus_recipient: number | null }[];
}

export interface AdminNames {
  participants: {
    id: string;
    display_name: string | null;
    name_status: 'ok' | 'pending' | 'flagged' | 'hidden';
    suspended_at: string | null;
    suspended_reason: string | null;
    depth: number;
    created_at: string;
    links: number;
  }[];
  labels: {
    id: string;
    recipient_label: string | null;
    label_status: 'ok' | 'flagged' | 'hidden';
    status: string;
    created_at: string;
    sender_id: string;
    sender_name: string | null;
  }[];
  log: {
    id: number;
    admin_email: string;
    target_type: string;
    target_id: string;
    action: string;
    old_value: string | null;
    new_value: string | null;
    reason: string | null;
    created_at: string;
  }[];
  name_review: 'after' | 'before';
}

export interface MyAccount {
  is_anonymous: boolean;
  linked_email: string | null;
  linked_phone?: string | null;
  waitlist_email: string | null;
  /** Exact consent text shown on the waitlist checkbox (and stored with the signup). */
  waitlist_consent_text?: string;
  /** This participant's own Pipeline Community signup (null if never joined). */
  community?: CommunityStatus | null;
  /** "Maybe later" was chosen (or the signup completed): don't show the screen again. */
  community_prompt_dismissed?: boolean;
  /** Exact checkbox wording, stored with each consent. */
  community_consent_texts?: { research_invites?: string; updates?: string };
}

export interface CommunityStatus {
  email: string;
  research_invites: boolean;
  updates: boolean;
  /** False once both preferences are withdrawn. */
  subscribed: boolean;
  signed_up_at: string;
}

export interface AdminCommunityStats {
  total: number;
  research_invites: number;
  updates: number;
  both: number;
  unsubscribed: number;
  dismissed: number;
  /** Participants who reached the mission reveal (saw the signup). */
  eligible: number;
  participants: number;
  by_generation: { depth: number; eligible: number; signups: number }[];
}

export interface AdminAccountStats {
  anonymous: number;
  linked_emails: number;
  waitlist: number;
  flagged_same_network: number;
  shared?: number;
  linked_phones?: number;
  shared_by_share?: number;
  shared_by_copy?: number;
}

/** What participants may see about an experiment (no stats, no other members). */
export interface ExperimentInfo {
  id: string;
  name: string;
  description: string | null;
  invite_instruction: string | null;
  /** e.g. ["Current Student", "Alumni"]; empty = not asked. */
  categories: string[];
  invites_per_participant: number;
  status: 'active' | 'paused';
  is_default: boolean;
}

export interface Experiment extends ExperimentInfo {
  created_at: string;
  updated_at: string;
  stats: {
    participants: number;
    people: number;
    links_created: number;
    seed_links: number;
    opened: number;
    accepted: number;
    secondary_connections: number;
    median_response_s: number | null;
    median_link_to_join_s: number | null;
    max_depth: number;
    categories: Record<string, number>;
  };
}

export interface ExperimentDetail {
  seeds: AdminOverview['seeds'];
  tree: (AdminOverview['tree'][number] & { category: string | null })[];
  secondary: { from: string | null; to: string }[];
}

export interface OpenResult {
  state: 'ok' | 'invalid' | 'expired' | 'paused' | 'used' | 'own' | 'joined' | 'rate_limited' | 'preview';
  experiment?: ExperimentInfo;
  sender_name?: string | null;
  /** First name the inviter gave for this invitation (seed links have none). */
  invited_name?: string | null;
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
  shared_at: string | null;
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
    id?: string;
    display_name: string;
    email: string;
    method: MethodKey;
    depth: number;
    reveal_level: number;
    revealed_via: 'invite' | 'feedback' | null;
    name_status?: 'ok' | 'pending' | 'flagged' | 'hidden';
    suspended?: boolean;
    marketing_consent: boolean;
    created_at: string;
    category?: string | null;
  };
  max_invites?: number;
  /** The experiment this home screen is about. */
  experiment?: ExperimentInfo;
  /** Every experiment this person is in (same account). */
  experiments?: { id: string; name: string; current: boolean }[];
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
  invalid_name: 'Please enter a different name.',
  invalid_name_format: 'Enter a first name and last initial, like “James P.”',
  category_required: 'Choose the option that describes you.',
  experiment_paused: 'This experiment is paused right now.',
  invalid_experiment_name: 'Give the experiment a name (up to 80 characters).',
  invalid_experiment_text: 'The description or instruction is too long.',
  invalid_invite_count: 'Invitations per participant must be between 1 and 10.',
  invalid_categories: 'Use up to 8 categories of 40 characters or fewer.',
  experiment_name_taken: 'Another experiment already has that name.',
  not_found: 'That experiment no longer exists.',
  invalid_count: 'Choose between 1 and 50 links.',
  suspended: 'Your participation is paused.',
  invite_limit: 'You’ve used all your invitations.',
  link_limit: 'You’ve reached the limit for new links.',
  invalid_value: 'Please choose an answer.',
  invalid_label: 'That name is too long.',
  not_participant: 'You’re not part of the experiment yet.',
  not_authenticated: 'Please sign in again.',
  forbidden: 'You don’t have access to this.',
  cannot_revoke: 'That link can’t be removed anymore.',
  invalid_answer: 'Please write a short answer.',
  invalid_email: 'Enter a valid email.',
  no_preference: 'Choose at least one option to join.',
  not_subscribed: 'You haven’t joined the Pipeline Community yet.',
  rate_limited: 'Too many attempts from this network. Try again in a little while.',
  invalid_phone: 'Enter a valid phone number.',
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
  // Some checks (e.g. a rejected name) return { error } so the server can record
  // the attempt for rate limiting instead of aborting the request.
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { error?: unknown }).error === 'string') {
    throw new ApiError((data as { error: string }).error);
  }
  return data as T;
}

export const api = {
  /** The device id lets the server recognise the sender's own browser (never counted as an open). */
  openInvitation: (token: string, device?: string) => rpc<OpenResult>('open_invitation', { p_token: token, p_device: device ?? null }),
  answerInvitation: (token: string, value: string, ms: number) =>
    rpc('answer_invitation', { p_token: token, p_value: value, p_response_ms: ms }),
  acceptInvitation: (token: string, name: string, research: boolean, device: string, category?: string | null) =>
    rpc<{ state: 'joined' | 'already_participant' }>('accept_invitation', {
      p_token: token,
      p_display_name: name,
      p_research_consent: research,
      p_marketing_consent: false, // never collected at join; see the waitlist instead
      p_device: device,
      p_category: category ?? null,
    }),
  /** Show another experiment this person is in on the home screen. */
  switchExperiment: (experimentId: string) => rpc('switch_experiment', { p_experiment_id: experimentId }),
  createInvitation: (value: string, label: string | null, ms: number) =>
    rpc<{ id: string; token: string }>('create_invitation', {
      p_value: value,
      p_recipient_label: label,
      p_response_ms: ms,
    }),
  revokeInvitation: (id: string) => rpc('revoke_invitation', { p_invitation_id: id }),
  /** Records a Share/Copy tap (intent to share, not proof of delivery). May unlock a reveal. */
  markShared: (id: string, method: 'share' | 'copy') =>
    rpc<{ ok: boolean; reveal_level: number }>('mark_invitation_shared', { p_invitation_id: id, p_method: method }),
  submitFeedback: (answer: string) => rpc('submit_feedback', { p_answer: answer }),
  setMarketingConsent: (consent: boolean) => rpc('set_marketing_consent', { p_consent: consent }),
  getMyState: () => rpc<MyState>('get_my_state'),
  getMyAccount: () => rpc<MyAccount>('get_my_account'),
  /** Server-side name check (profanity, slurs, URLs, spam…). Returns ok only. */
  /** "This wasn't meant for me": records a forwarded link without accepting it. */
  reportWrongRecipient: (token: string) => rpc<{ ok: boolean }>('report_wrong_recipient', { p_token: token }),
  checkName: (name: string) => rpc<{ ok: boolean }>('check_name', { p_name: name }),
  /** Research telemetry: a classification question was shown / first touched. Fire-and-forget. */
  logClassificationEvent: (direction: 'inbound' | 'outbound', event: 'shown' | 'interacted', token?: string, elapsedMs?: number) =>
    rpc('log_classification_event', { p_direction: direction, p_event: event, p_token: token ?? null, p_elapsed_ms: elapsedMs ?? null }),
  adminMethodStats: () => rpc<AdminMethodStats>('admin_method_stats'),
  adminNames: () => rpc<AdminNames>('admin_names'),
  adminModerate: (target: 'participant' | 'invitation', id: string, action: string, value?: string, reason?: string) =>
    rpc('admin_moderate', { p_target: target, p_id: id, p_action: action, p_value: value ?? null, p_reason: reason ?? null }),
  joinWaitlist: (email: string, source: string) => rpc('join_waitlist', { p_email: email, p_source: source }),
  leaveWaitlist: () => rpc('leave_waitlist'),
  joinCommunity: (email: string, researchInvites: boolean, updates: boolean) =>
    rpc('join_community', { p_email: email, p_research_invites: researchInvites, p_updates: updates }),
  updateCommunityPreferences: (researchInvites: boolean, updates: boolean) =>
    rpc('update_community_preferences', { p_research_invites: researchInvites, p_updates: updates }),
  dismissCommunityPrompt: () => rpc('dismiss_community_prompt'),
  adminCommunityStats: () => rpc<AdminCommunityStats>('admin_community_stats'),
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
  adminExperiments: () => rpc<Experiment[]>('admin_experiments'),
  adminExperimentDetail: (id: string) => rpc<ExperimentDetail>('admin_experiment_detail', { p_experiment_id: id }),
  adminSaveExperiment: (e: {
    id: string | null;
    name: string;
    description: string;
    invite_instruction: string;
    invites_per_participant: number;
    categories: string[];
    status: 'active' | 'paused';
  }) =>
    rpc<ExperimentInfo>('admin_save_experiment', {
      p_id: e.id,
      p_name: e.name,
      p_description: e.description,
      p_invite_instruction: e.invite_instruction,
      p_invites_per_participant: e.invites_per_participant,
      p_categories: e.categories,
      p_status: e.status,
    }),
  adminCreateExperimentSeeds: (experimentId: string, count: number, senderName: string, note: string) =>
    rpc<{ id: string; token: string }[]>('admin_create_experiment_seeds', {
      p_experiment_id: experimentId,
      p_count: count,
      p_sender_name: senderName,
      p_note: note,
    }),
};

/** Permanent public link for an invitation: {VITE_PUBLIC_APP_URL}/join/{token}. */
export const inviteUrl = (token: string) => appUrl(`/join/${token}`);

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
