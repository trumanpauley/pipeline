// Everything a non-engineer is likely to tweak lives here: copy and the three
// classification methods. If you add/rename a stored value, also update the
// `method_options` row in public.experiment_settings (the server validates it).

export type MethodKey = 'strength' | 'context' | 'comfort' | 'circular';

export interface MethodOption {
  value: string;
  label: string;
  hint?: string;
}

export interface MethodDef {
  key: MethodKey;
  /** Short name used in the admin dashboard. */
  adminName: string;
  layout: 'stack' | 'grid' | 'scale' | 'circular';
  question: (name: string) => string;
  options: MethodOption[];
  scaleLabels?: [string, string];
}

export const METHODS: Record<MethodKey, MethodDef> = {
  strength: {
    key: 'strength',
    adminName: 'A · Strength',
    layout: 'stack',
    question: (name) => `How close are you to ${name}?`,
    options: [
      { value: 'close_friend', label: 'Close friend' },
      { value: 'acquaintance', label: 'Acquaintance' },
      { value: 'weak', label: 'Weak connection' },
    ],
  },
  context: {
    key: 'context',
    adminName: 'B · Context',
    layout: 'grid',
    question: (name) => `Where do you know ${name} from?`,
    options: [
      { value: 'class', label: 'Class' },
      { value: 'team', label: 'Team' },
      { value: 'club', label: 'Club' },
      { value: 'work', label: 'Work' },
      { value: 'social', label: 'Social' },
      { value: 'other', label: 'Other' },
    ],
  },
  comfort: {
    key: 'comfort',
    adminName: 'C · Comfort',
    layout: 'scale',
    question: (name) => `How comfortable would you feel asking ${name} for an introduction?`,
    options: ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v })),
    scaleLabels: ['Not at all', 'Completely'],
  },
  circular: {
    key: 'circular',
    adminName: 'D · Circular',
    layout: 'circular',
    question: (name) => `How well do you know ${name}?`,
    options: [], // any whole number 0–100 (see CircularSlider)
  },
};

/**
 * Experiment D — circular connection strength (0–100). The participant drags a
 * node clockwise around a circle; a full turn is 100%. Bands shown inside the
 * circle while dragging (also used to summarise results in the admin dashboard).
 */
export const CIRCULAR_BANDS: { min: number; max: number; label: string }[] = [
  { min: 0, max: 0, label: 'Not well' },
  { min: 1, max: 24, label: 'Not very well' },
  { min: 25, max: 49, label: 'Somewhat' },
  { min: 50, max: 74, label: 'Well' },
  { min: 75, max: 100, label: 'Very well' },
];
export const circularLabel = (pct: number) =>
  CIRCULAR_BANDS.find((b) => pct >= b.min && pct <= b.max)?.label ?? '';

export const methodDef = (key: string): MethodDef =>
  METHODS[(key as MethodKey) in METHODS ? (key as MethodKey) : 'strength'];

export const labelFor = (method: string, value: string) =>
  method === 'circular'
    ? `${value}% · ${circularLabel(Number(value))}`
    : methodDef(method).options.find((o) => o.value === value)?.label ?? value;

/**
 * Branding. Before a participant's first unlock, the company name must not
 * appear anywhere they can see (headers, tab title, share previews). Admin
 * screens always use the real name.
 */
export const BRAND = {
  hidden: 'The Experiment',
  revealed: 'Pipeline',
};

export const COPY = {
  /** Invitation landing. `name` is the inviter's first name from the referral data. */
  landingTitle: (name: string | null) => (name ? `${name} invited you.` : 'You’ve been invited.'),
  landingBody: 'We’re a Harvard startup trying to understand how people are connected.',
  landingCta: 'Enter the Experiment',
  landingFollow: 'Take part in our experiment to learn more about us.',
  landingMeta: 'Under two minutes · Voluntary',
  shareText: 'A small student experiment about how people are connected. You’re invited:',
  // First-name + consent page (after the relationship question). Never name the company here.
  joinEyebrow: 'We’re in stealth mode.',
  joinTitle: 'The more you connect, the more we reveal.',
  joinBody: 'Participate in our experiment to discover our name and what we’re building.',
  joinConsent: 'I agree to take part in this research on how people are connected.',
  joinFooter: 'No account needed.',
  // When the inviter gave a name: the recipient confirms or corrects it.
  joinConfirmTitle: (invited: string) => `Are you ${invited}?`,
  joinConfirmBody: (sender: string | null) => (sender ? `That’s who ${sender} invited.` : 'That’s who this invitation is for.'),
  joinConfirmYes: 'Yes, that’s me',
  joinConfirmNo: 'That’s not my name',
  joinWrongPerson: 'This invite wasn’t meant for me',
  // Seed links (no inviter-provided name).
  joinSeedTitle: 'And you are?',
  research: [
    'We record how people describe their connections and how invitations spread.',
    'Analysis is aggregate. Nobody sees how you described them.',
    'Your name is shown only to people you invite.',
    'You can delete your data at any time.',
  ],
};
