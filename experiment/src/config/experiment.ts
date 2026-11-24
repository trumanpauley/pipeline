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

/**
 * The public Pipeline website. The completion screen links here with a
 * non-identifying ?source=experiment tag (never a name, link token or experiment id).
 * Override with VITE_LANDING_URL (no trailing slash) for a preview deployment.
 */
export const LANDING_URL = (
  ((import.meta.env.VITE_LANDING_URL as string | undefined) ?? '').trim().replace(/\/+$/, '') ||
  'https://pipeline-networking.com'
);
export const LANDING_LINK = `${LANDING_URL}/?source=experiment`;

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
  joinBody: 'A quick experiment about how we’re connected.',
  joinConsent: 'I agree to take part in this research.',
  // Accurate: a private anonymous session is created in this browser; nobody signs up.
  joinFooter: 'No sign-up, email or password.',
  aboutTitle: 'About this experiment & privacy',
  // When the inviter gave a name: the recipient confirms or corrects it.
  joinConfirmTitle: (invited: string) => `Are you ${invited}?`,
  joinConfirmBody: (sender: string | null) => (sender ? `That’s who ${sender} invited.` : 'That’s who this invitation is for.'),
  joinConfirmYes: 'Yes, that’s me',
  joinConfirmNo: 'That’s not my name',
  joinWrongPerson: 'This invite wasn’t meant for me',
  // Seed links (no inviter-provided name).
  joinSeedTitle: 'And you are?',
  // Name entry: first name and last initial ("James P.").
  nameInstruction: 'Enter your first name and last initial.',
  namePlaceholder: 'First name, last initial',
  nameDisclosure:
    'We use your first name and last initial to identify you within this networking experiment. Your name may be visible to people participating in your invitation chain.',
  namePrivacy: [
    'We only ask for a first name and last initial: never a full surname, and no account or email.',
    'People you invite see your first name when they open your link. Whoever invited you typed your name, and sees when you join.',
    'Other participants don’t see your name. The network view shows people as anonymous dots.',
    'We record who invited whom, in which experiment, and how each person describes the connection. Nobody sees how you described them.',
    'The research team sees names and the invitation network to run and study the experiment, and reports results in aggregate.',
    'If you join more than one experiment, your participations are linked through this browser’s sign-in, never by matching names.',
    'You can delete your data at any time from “Your data”.',
  ],
  categoryQuestion: 'Which describes you?',
  research: [
    'We record how people describe their connections and how invitations spread.',
    'Analysis is aggregate. Nobody sees how you described them.',
    'You can delete your data at any time.',
  ],
  /** The full disclosure behind "About this experiment & privacy" (the consent covers all of it). */
  about: [
    {
      title: 'The experiment',
      lines: [
        'We’re a Harvard student startup studying how people are connected. You’ll discover our name and what we’re building as you take part.',
        'It takes about two minutes and is voluntary. You can stop at any point.',
      ],
    },
    {
      title: 'What we record',
      lines: [
        'How you describe your connection to the person who invited you, the people you invite, how invitations spread, and which experiment you’re in.',
        'Analysis is aggregate. Nobody sees how you described them.',
      ],
    },
    {
      title: 'Your name',
      lines: [
        'We use your first name and last initial to identify you within this networking experiment. Your name may be visible to people participating in your invitation chain.',
        'People you invite see your first name when they open your link. Whoever invited you typed your name, and sees when you join.',
        'Other participants don’t see your name. The network view shows people as anonymous dots.',
        'The research team sees names and the invitation network to run and study the experiment.',
        'If you join more than one experiment, your participations are linked through this browser’s sign-in, never by matching names.',
      ],
    },
    {
      title: 'Your choices',
      lines: [
        'We never ask for a full surname, an email or a password.',
        'You can delete your data at any time from “Your data”.',
      ],
    },
  ],
};
