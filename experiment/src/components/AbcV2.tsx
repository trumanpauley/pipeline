import { useRef, useState } from 'react';
import type { AbcV2Question, AbcV2Scenario, AbcV2State, Experiment, IntermediaryType } from '../lib/api';
import { CircularSlider } from './CircularSlider';
import { ScaleQuestion } from './Relationship';
import { Button, ErrorText, Sheet } from './ui';

/**
 * ABC V2: the same hypothetical Jane/John in up to three scenarios that differ
 * only in what they share with the participant and how they get in touch:
 *   university    shares the university, reaches out directly
 *   shared_group  shares the group (e.g. the team), reaches out directly
 *   warm          shares the group, introduced by someone the participant knows
 * in a random order chosen (and stored) by the server.
 *
 * A named broadcast link first asks "How well do you know {sender}?" on the
 * circular dial, with "I don't know {sender} personally" underneath; not knowing
 * them skips the warm question. The dial needs a deliberate drag before
 * Continue works, so its starting position is never recorded by accident.
 *
 * Used for real participants (answers go to Supabase) and by the admin
 * simulator (answers stay in the browser), via the callbacks.
 */
export function AbcV2Flow({
  state,
  onClassify,
  onKnows,
  onAnswer,
  onClose,
  onDone,
}: {
  state: AbcV2State;
  onClassify: (key: string) => Promise<void>;
  onKnows: (knows: boolean, strength: number | null, responseMs: number) => Promise<void>;
  onAnswer: (q: AbcV2Question, value: number) => Promise<void>;
  /** "Not now": close without finishing (it can be resumed later). */
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [introSeen, setIntroSeen] = useState(false);
  const shownAt = useRef(performance.now());
  const order = state.order ?? [];
  const answered = (q: AbcV2Question) => state.answers?.[q] != null;
  const next = order.find((q) => !answered(q));
  const sender = state.intermediary?.name ?? 'them';

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state.needs_classification) {
    return (
      <Sheet onClose={onClose}>
        <div className="stack fade-up abc" data-step="classify" data-version="v2">
          <p className="eyebrow">A few quick scenarios</p>
          <h1 className="question">Which describes you?</h1>
          <div className="category-options" role="radiogroup" aria-label="Which describes you?">
            {(state.groups ?? []).map((g) => (
              <button key={g.key} type="button" role="radio" aria-checked={false} className="chip" disabled={busy}
                onClick={() => void run(() => onClassify(g.key))}>
                {g.label}
              </button>
            ))}
          </div>
          <ErrorText error={error} />
          <button type="button" className="link center-link" onClick={onClose}>Not now</button>
        </div>
      </Sheet>
    );
  }

  if (state.needs_knows) {
    return (
      <Sheet onClose={onClose}>
        <div className="stack fade-up abc abc-knows" data-step="knows" data-version="v2">
          <p className="eyebrow">First, one question</p>
          <CircularSlider
            name={sender}
            question={`How well do you know ${sender}?`}
            onConfirm={(v, ms) => void run(() => onKnows(true, v, ms))}
          />
          <button type="button" className="link center-link abc-dont-know" disabled={busy}
            onClick={() => void run(() => onKnows(false, null, Math.round(performance.now() - shownAt.current)))}>
            I don’t know {sender} personally
          </button>
          <ErrorText error={error} />
        </div>
      </Sheet>
    );
  }

  const step: 'intro' | AbcV2Question | 'done' =
    state.completed || !next ? 'done' : !introSeen && !order.some(answered) ? 'intro' : next;
  const q = step !== 'intro' && step !== 'done' ? state.questions?.[step] : undefined;

  return (
    <Sheet onClose={onClose}>
      <div className="stack abc" data-step={step} data-version="v2" data-order={order.join('>')} data-name={state.name}>
        {step === 'intro' && (
          <div className="stack fade-up">
            <p className="eyebrow">{order.length === 3 ? 'Three quick scenarios' : 'Two quick scenarios'}</p>
            <h1 className="question">How would you respond?</h1>
            <p className="muted">Each one changes a single detail. There are no right answers.</p>
            <Button onClick={() => setIntroSeen(true)}>Continue</Button>
            <button type="button" className="link center-link" onClick={onClose}>Not now</button>
          </div>
        )}
        {q && step !== 'intro' && step !== 'done' && (
          <div className="fade-up" key={step}>
            <p className="eyebrow abc-progress">{order.indexOf(step) + 1} of {order.length}</p>
            <ScaleQuestion
              testId={`abc-v2-${step}`}
              context={q.scenario}
              question={q.question}
              low="Very unlikely"
              high="Very likely"
              onSelect={(v) => void run(() => onAnswer(step, v))}
            />
            <ErrorText error={error} />
          </div>
        )}
        {step === 'done' && (
          <div className="stack fade-up text-center">
            <div className="ready-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h1 className="title">Thank you.</h1>
            <p className="muted">That really helps.</p>
            <Button onClick={onDone}>Continue</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Default V2 groups for a new experiment (the same as the database default). */
export const DEFAULT_V2_SCENARIOS: AbcV2Scenario[] = [
  {
    key: 'student',
    label: 'Current Harvard student',
    university: 'Imagine {name} is a Harvard first-year looking for advice about which classes to take.',
    group: 'Imagine {name} is a Harvard first-year in {group} looking for advice about which classes to take.',
    direct_question: 'How likely would you be to respond if {name} reached out to you directly?',
    warm_question: 'How likely would you be to respond if {inviter} personally introduced {name} to you?',
  },
  {
    key: 'alumni',
    label: 'Harvard alumnus/alumna',
    university: 'Imagine {name} is a Harvard junior looking for advice about internship opportunities.',
    group: 'Imagine {name} is a Harvard junior in {group} looking for advice about internship opportunities.',
    direct_question: 'How likely would you be to respond if {name} reached out to you directly?',
    warm_question: 'How likely would you be to respond if {inviter} personally introduced {name} to you?',
  },
];

/** Same placeholders as the server's px_abc_v2_render. */
export const renderV2 = (text: string, name: string, inviter: string | null, group: string) =>
  text.split('{name}').join(name).split('{inviter}').join(inviter || 'the person who invited you').split('{group}').join(group);

/**
 * The V2 questionnaire built in the browser exactly as the server would build it,
 * for the admin simulator (nothing is saved).
 */
export function previewV2State(opts: {
  experiment: Experiment;
  groupKey: string | undefined;
  name: 'Jane' | 'John';
  intermediary: { type: IntermediaryType; name: string | null };
  /** Named broadcast only: null = not answered yet (shows the dial). */
  knows: boolean | null;
  order: AbcV2Question[];
  answers: Partial<Record<AbcV2Question, number>>;
}): AbcV2State {
  const { experiment: e, intermediary } = opts;
  const groups = e.abc_v2_scenarios?.length ? e.abc_v2_scenarios : DEFAULT_V2_SCENARIOS;
  const g = groups.find((x) => x.key === opts.groupKey) ?? groups[0];
  if (intermediary.type === 'broadcast_sender' && opts.knows === null) {
    return { eligible: true, version: 'v2', needs_knows: true, intermediary };
  }
  const warm = intermediary.type === 'inviter' || intermediary.type === 'seed_sender' || (intermediary.type === 'broadcast_sender' && opts.knows === true);
  const order = opts.order.filter((q) => q !== 'warm' || warm);
  const community = e.community_name?.trim() || e.name;
  const r = (t: string) => renderV2(t, opts.name, intermediary.name, community);
  const questions: AbcV2State['questions'] = {
    university: { scenario: r(g.university), question: r(g.direct_question) },
    shared_group: { scenario: r(g.group), question: r(g.direct_question) },
    ...(warm ? { warm: { scenario: r(g.group), question: r(g.warm_question) } } : {}),
  };
  const completed = order.every((q) => opts.answers[q] != null);
  return {
    eligible: true, version: 'v2', name: opts.name, order, questions, answers: opts.answers,
    classification: g.key, intermediary: { ...intermediary, knows: opts.knows }, completed,
  };
}
