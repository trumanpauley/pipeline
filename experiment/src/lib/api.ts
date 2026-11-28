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
  by_experiment?: { experiment_id: string; name: string; participants: number; signups: number; research_invites: number }[];
}

/** One waitlist across the landing page and the end of the experiment (admin only). */
export interface AdminWaitlistOverview {
  unique_total: number;
  landing_total: number;
  experiment_total: number;
  on_both: number;
  last_7_days: number;
  by_source: { source: string; count: number }[];
  recent: {
    email: string;
    source: string;
    created_at: string;
    origin?: 'landing' | 'experiment';
    experiment?: string | null;
    consent?: string | null;
  }[];
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
  /** One line under "And you are?", e.g. "A small experiment exploring … Harvard Baseball players." */
  welcome_message?: string | null;
  /** false: no "Where do you know them from?" question for invitees or inviters (default true). */
  ask_relationship_question?: boolean;
  /** Optional membership question asked before joining (null = not asked). */
  eligibility?: EligibilityInfo | null;
  /** Readable public name in links, e.g. "harvard-baseball" → /harvard-baseball/TOKEN. */
  slug?: string | null;
  /** e.g. "Harvard Baseball Network Experiment" (link previews). */
  public_title?: string | null;
  /** What participants send with their referral links. */
  forward_message?: string | null;
  /** Migration 018: the community the experiment is for, e.g. "Harvard Baseball". */
  community_name?: string | null;
  /** Replaces the default thank-you line on the completion page. */
  completion_message?: string | null;
  allow_additional_invites?: boolean;
  enable_feedback?: boolean;
  enable_waitlist?: boolean;
}

/** An experiment's public link-preview settings (for /harvard-baseball and link previews). */
export interface ShareMeta {
  found: boolean;
  id?: string;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
}

export interface EligibilityInfo {
  question: string;
  eligible_label: string;
  ineligible_label: string;
  ineligible_message: string;
}

export interface AbcScenario {
  key: string;
  label: string;
  /** "{name}" is replaced with Jane or John. */
  scenario: string;
}

export interface Experiment extends ExperimentInfo {
  // Onboarding settings as stored (the public `eligibility` is derived from these).
  ask_relationship_question?: boolean;
  // Invitation settings (migration 016)
  preview_description?: string | null;
  preview_image_url?: string | null;
  invite_message?: string | null;
  affiliation_authorized?: boolean;
  eligibility_enabled: boolean;
  eligibility_question: string | null;
  eligible_label: string;
  ineligible_label: string;
  ineligible_message: string | null;
  /** Rehearsal experiment: left out of the ABC / connection-strength analytics. */
  is_test: boolean;
  abc_enabled: boolean;
  /** Generation from which participants get the ABC experiment (seed-link joiners are 1). */
  abc_min_depth: number;
  abc_scenarios: AbcScenario[];
  /** Which ABC questionnaire this experiment uses when abc_enabled (migration 021; absent before = v1). */
  abc_version?: AbcVersion;
  abc_v2_scenarios?: AbcV2Scenario[];
  /** V2's shared group as it reads in a sentence, e.g. "on the Harvard Baseball team". */
  abc_v2_group?: string | null;
  abc_v2_revision?: number;
  /** The hypothetical person in ABC V1 and V2 (migration 021; absent before = random). */
  abc_name_mode?: AbcNameMode;
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

export type ReferralKind = 'seed_personal' | 'seed_broadcast' | 'standard' | 'additional';
export const REFERRAL_KIND_LABEL: Record<ReferralKind, string> = {
  seed_personal: 'Personal seed',
  seed_broadcast: 'Broadcast seed',
  standard: 'Standard referral',
  additional: 'Additional referral',
};

export interface ExperimentDetail {
  seeds: (AdminOverview['seeds'][number] & { kind?: ReferralKind })[];
  tree: (AdminOverview['tree'][number] & {
    category: string | null;
    kind?: ReferralKind | null;
    seed?: string | null;
    group?: string | null;
    completed?: boolean;
    strength?: number | null;
  })[];
  secondary: { from: string | null; to: string }[];
}

export type AbcVersion = 'v1' | 'v2';
export type AbcNameMode = 'random' | 'jane' | 'john';
/** "None" is abc_enabled = false; otherwise the version. */
export type AbcMode = 'none' | AbcVersion;
export const abcModeOf = (e?: Pick<Experiment, 'abc_enabled' | 'abc_version'>): AbcMode =>
  !e ? 'v1' : !e.abc_enabled ? 'none' : (e.abc_version ?? 'v1');

/**
 * ABC V2 wording for one participant type (e.g. current students, alumni). Placeholders:
 * {name} = Jane/John, {inviter} = the intermediary's first name, {group} = the
 * experiment's shared group phrase (abc_v2_group).
 */
export interface AbcV2Scenario {
  key: string;
  label: string;
  /** Situation 1: who they are, sharing only the university. */
  university: string;
  /** Situations 2 and 3: who they are, sharing the group. */
  group: string;
  /** Situations 1 and 2: how they get in touch (directly). */
  direct_contact: string;
  /** Situation 3: how they get in touch (introduced). */
  warm_contact: string;
}

export type AbcV2Question = 'university' | 'shared_group' | 'warm';
export type IntermediaryType = 'inviter' | 'seed_sender' | 'broadcast_sender' | 'none';

/** The ABC V2 questionnaire, as the participant sees it. */
export interface AbcV2State {
  eligible: boolean;
  version: 'v2';
  needs_classification?: boolean;
  groups?: { key: string; label: string }[];
  name?: 'Jane' | 'John';
  /** The questions they get, in the order shown (warm only when they know the intermediary). */
  order?: AbcV2Question[];
  questions?: Partial<Record<AbcV2Question, { scenario: string; contact: string; question: string }>>;
  answers?: Partial<Record<AbcV2Question, number | null>>;
  classification?: string;
  intermediary?: { type: IntermediaryType; name: string | null; knows?: boolean | null };
  completed?: boolean;
}

/** The ABC questionnaire, as the participant sees it. */
export interface AbcState {
  eligible: boolean;
  needs_classification?: boolean;
  groups?: { key: string; label: string }[];
  name?: 'Jane' | 'John';
  scenario?: string;
  order?: 'cold_first' | 'warm_first';
  classification?: string;
  cold?: number | null;
  warm?: number | null;
  completed?: boolean;
  /** The inviter's approved first name, if any. */
  inviter_name?: string | null;
}

type Avg = number | null;
export interface AbcV2Row {
  n: number; completed?: number;
  avg_university: Avg; avg_group: Avg; avg_warm: Avg;
  group_minus_university?: Avg; warm_minus_group?: Avg;
}
export interface AdminAbcV2Stats {
  participation: { started: number; completed: number; warm_eligible: number; named_broadcast: number; unnamed_broadcast: number };
  paired: {
    group_vs_university: { n: number; a: Avg; b: Avg; diff: Avg };
    warm_vs_group: { n: number; a: Avg; b: Avg; diff: Avg };
    warm_vs_university: { n: number; diff: Avg };
  };
  by_strength: (AbcV2Row & { band: string })[];
  by_link: (AbcV2Row & { link: 'broadcast' | 'personal' })[];
  by_classification: (AbcV2Row & { classification: string })[];
  by_first_question: (AbcV2Row & { first: AbcV2Question })[];
  by_revision: { revision: number; n: number }[];
}
export interface AdminAbcStats {
  participation: { eligible: number; started: number; completed: number };
  by_experiment: { experiment_id: string; name: string; eligible: number; completed: number; avg_cold: Avg; avg_warm: Avg; avg_advantage: Avg }[];
  outreach: {
    avg_cold: Avg;
    avg_warm: Avg;
    avg_advantage: Avg;
    cold_dist: number[];
    warm_dist: number[];
    advantage_dist: { advantage: number; n: number }[];
    by_order: { order: string; n: number; avg_cold: Avg; avg_warm: Avg }[];
    by_name: { name: string; n: number; avg_advantage: Avg }[];
  };
  by_classification: { classification: string; abc_n: number | null; avg_cold: Avg; avg_warm: Avg; avg_advantage: Avg; ratings_n: number | null; avg_closeness: Avg }[];
  by_depth: { depth: number; ratings_n: number | null; avg_closeness: Avg; abc_n: number | null; avg_advantage: Avg }[];
  strength: {
    ratings_n: number;
    avg_closeness: Avg;
    closeness_dist: number[];
    advantage_by_closeness: { closeness: number; n: number; avg_cold: Avg; avg_warm: Avg; avg_advantage: Avg }[];
    comfort_by_closeness: { closeness: number; n: number; avg_comfort: Avg; comfort_dist: number[] }[];
  };
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
  /** A broadcast link (one link for a whole group chat): sign in before answering (migration 021). */
  reusable?: boolean;
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
  abc?: { eligible: boolean; completed: boolean; version?: AbcVersion };
  feedback_question?: string;
  reveals?: { title: string }[];
  invitations?: MyInvitation[];
  /** Voluntary extra invitations after completion (migration 018). */
  additional?: {
    allowed: boolean;
    created: number;
    joined: number;
    recent: { id: string; token: string; recipient_label: string | null; status: InvitationStatus; created_at: string }[];
  };
  branch?: BranchNode[];
  network?: { participants: number; generations: number };
}

const MESSAGES: Record<string, string> = {
  invalid_invitation: 'This invitation isn’t active.',
  invitation_used: 'This invitation has already been used.',
  self_invite: 'You can’t accept your own invitation.',
  consent_required: 'Please agree to take part in the research to continue.',
  invalid_name: 'Please enter a different name.',
  not_eligible: 'This experiment is only for members of this community.',
  eligibility_question_required: 'Add the eligibility question, or turn screening off.',
  eligibility_labels_same: 'The two answers need different labels.',
  invalid_slug: 'Use 3–40 lowercase letters, numbers and single hyphens for the link (e.g. harvard-baseball).',
  slug_reserved: 'That link name is used by the app itself. Choose another.',
  slug_taken: 'Another experiment already uses that link name.',
  invalid_image_url: 'The preview image must be a public https:// address.',
  sponsorship_language: 'The wording suggests official sponsorship or endorsement. Rephrase it, or tick “Officially authorized” if the organization has approved this experiment.',
  abc_completed: 'You’ve already answered these. Thank you!',
  abc_started: 'Your group can’t be changed now.',
  needs_classification: 'Choose the option that describes you first.',
  invalid_scenarios: 'Each ABC V2 participant type needs a short key (lowercase letters, numbers, _), a label, both descriptions and both contact lines.',
  invalid_group: 'ABC V2 needs the shared group as it reads in a sentence (up to 80 characters), e.g. “on the Harvard Baseball team”.',
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
  /** False for errors without a friendly message (the raw server text is in `code`). */
  known: boolean;
  constructor(code: string) {
    super(MESSAGES[code] ?? 'Something went wrong. Please try again.');
    this.code = code;
    this.known = code in MESSAGES;
  }
}

/** For admin screens: the friendly message, plus the server's own words when there isn't one. */
export function adminErrorText(e: unknown): string {
  if (e instanceof ApiError && !e.known) return `${e.message} (${e.code})`;
  return (e as Error)?.message ?? String(e);
}

// A page left in the background (e.g. an email app's in-app browser) can wake
// with an expired access token before the client refreshes it.
const expiredToken = (message: string) => /jwt expired|invalid jwt|token is expired/i.test(message);

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let { data, error } = await supabase.rpc(fn, args);
  if (error && expiredToken(error.message)) {
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.error) ({ data, error } = await supabase.rpc(fn, args));
  }
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
  acceptInvitation: (token: string, name: string, research: boolean, device: string, category?: string | null, eligible?: boolean | null) =>
    rpc<{ state: 'joined' | 'already_participant' }>('accept_invitation', {
      p_token: token,
      p_display_name: name,
      p_research_consent: research,
      p_marketing_consent: false, // never collected at join; see the waitlist instead
      p_device: device,
      p_category: category ?? null,
      p_eligible: eligible ?? null,
    }),
  /** The invitee's closeness to their inviter (and comfort asking them for an introduction). */
  rateRelationship: (token: string, closeness: number, comfort: number | null) =>
    rpc('rate_relationship', { p_token: token, p_closeness: closeness, p_comfort: comfort }),
  getAbc: () => rpc<AbcState>('get_abc'),
  setMyClassification: (key: string) => rpc('set_my_classification', { p_key: key }),
  answerAbc: (question: 'cold' | 'warm', value: number) => rpc<AbcState>('answer_abc', { p_question: question, p_value: value }),
  getAbcV2: () => rpc<AbcV2State>('get_abc_v2'),
  setAbcV2Group: (key: string) => rpc<AbcV2State>('set_abc_v2_group', { p_key: key }),
  answerAbcV2: (question: AbcV2Question, value: number) => rpc<AbcV2State>('answer_abc_v2', { p_question: question, p_value: value }),
  adminSaveExperimentAbc: (experimentId: string, mode: AbcMode, minDepth: number, scenarios: AbcV2Scenario[] | null, group: string | null, nameMode: AbcNameMode) =>
    rpc('admin_save_experiment_abc', {
      p_experiment_id: experimentId, p_mode: mode, p_min_depth: minDepth, p_v2_scenarios: scenarios, p_v2_group: group, p_name_mode: nameMode,
    }),
  adminAbcV2Stats: (experimentId: string | null, classification: string | null) =>
    rpc<AdminAbcV2Stats>('admin_abc_v2_stats', { p_experiment_id: experimentId, p_classification: classification }),
  adminSetExperimentTest: (experimentId: string, isTest: boolean) =>
    rpc('admin_set_experiment_test', { p_experiment_id: experimentId, p_is_test: isTest }),
  adminAbcStats: (experimentId: string | null, classification: string | null) =>
    rpc<AdminAbcStats>('admin_abc_stats', { p_experiment_id: experimentId, p_classification: classification }),
  /** Show another experiment this person is in on the home screen. */
  switchExperiment: (experimentId: string) => rpc('switch_experiment', { p_experiment_id: experimentId }),
  /** value: null when the experiment doesn't ask the relationship question. */
  createInvitation: (value: string | null, label: string | null, ms: number) =>
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
  adminWaitlistOverview: () => rpc<AdminWaitlistOverview>('admin_waitlist_overview'),
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
  shareMeta: (slug: string) => rpc<ShareMeta>('experiment_share_meta', { p_slug: slug, p_token: null }),
  adminSaveExperimentSharing: (experimentId: string, o: {
    slug: string;
    public_title: string;
    preview_description: string;
    preview_image_url: string;
    invite_message: string;
    forward_message: string;
    affiliation_authorized: boolean;
  }) =>
    rpc<Experiment>('admin_save_experiment_sharing', {
      p_experiment_id: experimentId,
      p_slug: o.slug,
      p_public_title: o.public_title,
      p_preview_description: o.preview_description,
      p_preview_image_url: o.preview_image_url,
      p_invite_message: o.invite_message,
      p_forward_message: o.forward_message,
      p_affiliation_authorized: o.affiliation_authorized,
    }),
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
  adminSetRelationshipQuestion: (experimentId: string, enabled: boolean) =>
    rpc<ExperimentInfo>('admin_set_relationship_question', { p_experiment_id: experimentId, p_enabled: enabled }),
  adminSaveExperimentOnboarding: (experimentId: string, o: {
    welcome_message: string;
    eligibility_enabled: boolean;
    eligibility_question: string;
    eligible_label: string;
    ineligible_label: string;
    ineligible_message: string;
  }) =>
    rpc<ExperimentInfo>('admin_save_experiment_onboarding', {
      p_experiment_id: experimentId,
      p_welcome_message: o.welcome_message,
      p_eligibility_enabled: o.eligibility_enabled,
      p_eligibility_question: o.eligibility_question,
      p_eligible_label: o.eligible_label,
      p_ineligible_label: o.ineligible_label,
      p_ineligible_message: o.ineligible_message,
    }),
  createAdditionalInvitation: (value: string, label: string) =>
    rpc<{ id?: string; token?: string; error?: string }>('create_additional_invitation', {
      p_value: value,
      p_recipient_label: label,
    }),
  submitExperimentFeedback: (body: string, contactOk: boolean, email: string | null) =>
    rpc<{ ok: boolean }>('submit_experiment_feedback', { p_body: body, p_contact_ok: contactOk, p_email: email }),
  adminSaveExperimentLaunch: (experimentId: string, o: {
    community_name: string;
    completion_message: string;
    allow_additional_invites: boolean;
    enable_feedback: boolean;
    enable_waitlist: boolean;
  }) =>
    rpc<Experiment>('admin_save_experiment_launch', {
      p_experiment_id: experimentId,
      p_community_name: o.community_name,
      p_completion_message: o.completion_message,
      p_allow_additional_invites: o.allow_additional_invites,
      p_enable_feedback: o.enable_feedback,
      p_enable_waitlist: o.enable_waitlist,
    }),
  adminCreateSeedsV2: (experimentId: string, count: number, senderName: string, label: string, kind: 'personal' | 'broadcast') =>
    rpc<{ id: string; token: string }[]>('admin_create_experiment_seeds_v2', {
      p_experiment_id: experimentId,
      p_count: count,
      p_sender_name: senderName,
      p_label: label,
      p_kind: kind,
    }),
  adminUpdateSeed: (id: string, label: string, kind: 'personal' | 'broadcast' | null) =>
    rpc('admin_update_seed', { p_invitation_id: id, p_label: label, p_kind: kind }),
  /** Set or change the name a seed link shows (migration 020). Empty clears it on a broadcast link. */
  adminSetSeedSender: (id: string, senderName: string) =>
    rpc<{ ok: boolean; sender_name: string | null }>('admin_set_seed_sender', { p_invitation_id: id, p_sender_name: senderName }),
  adminLaunchAnalytics: (experimentId: string | null) =>
    rpc<AdminLaunchAnalytics>('admin_launch_analytics', { p_experiment_id: experimentId }),
  adminFeedbackList: (experimentId: string | null, status: 'new' | 'reviewed' | null) =>
    rpc<AdminFeedbackList>('admin_feedback_list', { p_experiment_id: experimentId, p_status: status }),
  adminFeedbackReview: (id: string, reviewed: boolean) =>
    rpc('admin_feedback_review', { p_id: id, p_reviewed: reviewed }),
  adminCreateExperimentSeeds: (experimentId: string, count: number, senderName: string, note: string) =>
    rpc<{ id: string; token: string }[]>('admin_create_experiment_seeds', {
      p_experiment_id: experimentId,
      p_count: count,
      p_sender_name: senderName,
      p_note: note,
    }),
};

/**
 * Permanent public link for an invitation: {VITE_PUBLIC_APP_URL}/{slug}/{token}
 * when the experiment has a link name (e.g. /harvard-baseball/AbC…), otherwise
 * /join/{token}. The token alone identifies the invitation and its sender, so
 * both forms (and every link already sent) open the same invitation.
 */
export const inviteUrl = (token: string, slug?: string | null) =>
  appUrl(slug ? `/${slug}/${token}` : `/join/${token}`);

/** The text people send: the experiment's message, then the link. */
export const shareText = (message: string | null | undefined, url: string) =>
  message?.trim() ? `${message.trim()}\n\n${url}` : url;

export interface Ratio { num: number; den: number }
export interface AdminLaunchAnalytics {
  overview: {
    seed_links: number;
    participants: number;
    started: number;
    completed: number;
    completion_rate: Ratio;
    by_group: { group: string; participants: number; completed: number }[];
    waitlist_from_experiment: number;
    waitlist_conversion: Ratio;
  };
  by_kind: {
    kind: ReferralKind;
    generated: number;
    shared: number;
    opened: number;
    started: number;
    completed: number;
    duplicates: number;
    opened_rate: Ratio;
    started_rate: Ratio;
    completed_rate: Ratio;
    conversion: Ratio;
  }[];
  additional: { generated: number; completed_with_any: Ratio; per_completed: Ratio };
  depth: { max: number; avg: number | null };
  timing: { median_created_to_completed_s: number | null; measured: number };
  overlap: { people_invited_more_than_once: number; extra_invitations_received: number };
}

export interface FeedbackItem {
  id: string;
  experiment: string;
  experiment_id: string;
  body: string;
  week: string;
  status: 'new' | 'reviewed';
  reviewed_at: string | null;
  contact_ok: boolean;
  contact_email: string | null;
}
export interface AdminFeedbackList {
  counts: { total: number; new: number; with_contact: number };
  items: FeedbackItem[];
}

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
    kind?: ReferralKind;
    note: string | null;
    status: InvitationStatus;
    opened_at: string | null;
    accepted_at: string | null;
    created_at: string;
    branch_size: number;
    reusable?: boolean;
    uses?: number;
    joined?: number;
  }[];
  tree: { id: string; parent: string | null; depth: number; method: string; deleted: boolean }[];
  settings: Record<string, unknown>;
}
