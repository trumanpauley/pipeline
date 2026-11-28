import { useState } from 'react';
import type { AbcV2Question, AbcV2Scenario, AbcV2State, Experiment, IntermediaryType } from '../lib/api';
import { Button, ErrorText, Sheet } from './ui';

const SCALE = [1, 2, 3, 4, 5] as const;
const QUESTION = 'How likely are you to respond?';

/**
 * ABC V2: "Would you respond?" The same hypothetical Jane/John in up to three
 * situations that change one thing at a time:
 *   university    shares the university, messages them directly
 *   shared_group  shares the group (e.g. the team), messages them directly
 *   warm          shares the group, introduced by someone they know
 * in a random order chosen (and stored) by the server.
 *
 * Three quick taps: the description is the main text, the way they get in touch
 * sits in its own small box, and the question is always the same. Tapping a
 * circle saves and moves on; Back changes an earlier answer (until the last one
 * is in). Used for real participants and by the admin simulator via the callbacks.
 */
export function AbcV2Flow({
  state,
  onClassify,
  onAnswer,
  onClose,
  onDone,
}: {
  state: AbcV2State;
  onClassify: (key: string) => Promise<void>;
  onAnswer: (q: AbcV2Question, value: number) => Promise<void>;
  /** Skip / close: nothing is lost, and it can be finished later. */
  onClose: () => void;
  onDone: () => void;
}) {
  const order = state.order ?? [];
  const answers = state.answers ?? {};
  const firstOpen = order.findIndex((q) => answers[q] == null);
  const [step, setStep] = useState<'intro' | 'done' | number>(() =>
    state.completed || (order.length > 0 && firstOpen === -1) ? 'done'
    : firstOpen <= 0 ? 'intro' : firstOpen);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.needs_classification) {
    return (
      <Sheet onClose={onClose}>
        <div className="abc2 fade-up" data-step="classify" data-version="v2">
          <h1 className="abc2-title">Which describes you?</h1>
          <div className="category-options" role="radiogroup" aria-label="Which describes you?">
            {(state.groups ?? []).map((g) => (
              <button key={g.key} type="button" role="radio" aria-checked={false} className="chip" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try { await onClassify(g.key); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
                }}>
                {g.label}
              </button>
            ))}
          </div>
          <ErrorText error={error} />
          <button type="button" className="link center-link abc2-skip" onClick={onClose}>Skip for now</button>
        </div>
      </Sheet>
    );
  }

  const choose = async (q: AbcV2Question, i: number, v: number) => {
    if (busy) return;
    setPicked(v);
    setBusy(true);
    setError(null);
    // A short beat so the choice registers before the next situation slides in.
    await new Promise((r) => window.setTimeout(r, 180));
    try {
      await onAnswer(q, v);
      setStep(i + 1 < order.length ? i + 1 : 'done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPicked(null);
      setBusy(false);
    }
  };

  const count = order.length === 2 ? 'two' : 'three';

  return (
    <Sheet onClose={onClose}>
      <div className="abc2" data-step={typeof step === 'number' ? order[step] : step} data-version="v2"
        data-order={order.join('>')} data-name={state.name}>
        {step === 'intro' && (
          <div className="abc2-intro abc2-in">
            <h1 className="abc2-title">Would you respond?</h1>
            <p className="abc2-lede">Imagine someone reaches out to you for advice. Tell us how likely you would be to respond in {count} different situations.</p>
            <Button onClick={() => setStep(0)}>Let’s go</Button>
            <button type="button" className="link center-link abc2-skip" onClick={onClose}>Skip for now</button>
          </div>
        )}

        {typeof step === 'number' && order[step] && (() => {
          const q = order[step];
          const text = state.questions?.[q];
          const current = picked ?? answers[q] ?? null;
          return (
            <div className="abc2-q-wrap">
              <div className="abc2-top">
                <button type="button" className="abc2-back" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}
                  aria-label="Previous situation" style={{ visibility: step === 0 ? 'hidden' : 'visible' }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <div className="abc2-progress" role="progressbar" aria-valuemin={1} aria-valuemax={order.length} aria-valuenow={step + 1}
                  aria-label={`Situation ${step + 1} of ${order.length}`}>
                  {order.map((x, i) => (
                    <span key={x} className={`abc2-seg ${i < step || answers[x] != null ? 'is-done' : ''} ${i === step ? 'is-current' : ''}`} />
                  ))}
                </div>
                <span className="abc2-back-spacer" aria-hidden="true" />
              </div>

              <div className="abc2-card abc2-in" key={q} data-testid={`abc-v2-${q}`}>
                <p className="abc2-desc">{text?.scenario}</p>
                <p className="abc2-contact">{text?.contact}</p>
              </div>

              <p className="abc2-ask">{QUESTION}</p>
              <div className="abc2-scale" role="radiogroup" aria-label={QUESTION}>
                {SCALE.map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={current === v}
                    className={`abc2-dot ${current === v ? 'is-chosen' : ''}`} disabled={busy && picked !== v}
                    onClick={() => void choose(q, step, v)}
                    aria-label={`${v} of 5${v === 1 ? ' (very unlikely)' : v === 5 ? ' (very likely)' : ''}`}>
                    {v}
                  </button>
                ))}
              </div>
              <div className="abc2-labels" aria-hidden="true"><span>Very unlikely</span><span>Very likely</span></div>
              <ErrorText error={error} />
            </div>
          );
        })()}

        {step === 'done' && (
          <div className="abc2-intro abc2-in text-center">
            <div className="ready-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h1 className="abc2-title">Thank you.</h1>
            <Button onClick={onDone}>Continue</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Default V2 wording for a new experiment (the same as the database default). */
export const DEFAULT_V2_SCENARIOS: AbcV2Scenario[] = [
  {
    key: 'student',
    label: 'Current Harvard student',
    university: '{name} is a Harvard first-year looking for advice on which classes to take.',
    group: '{name} is a Harvard first-year {group} looking for advice on which classes to take.',
    direct_contact: '{name} messages you directly.',
    warm_contact: '{inviter} personally introduces you to {name}.',
  },
  {
    key: 'alumni',
    label: 'Harvard alumnus/alumna',
    university: '{name} is a Harvard junior looking for internship advice.',
    group: '{name} is a Harvard junior {group} looking for internship advice.',
    direct_contact: '{name} messages you directly.',
    warm_contact: '{inviter} personally introduces you to {name}.',
  },
];

/** Fills in any wording missing from an older saved version with the defaults. */
export const withV2Defaults = (groups: Partial<AbcV2Scenario>[] | undefined): AbcV2Scenario[] =>
  (groups?.length ? groups : DEFAULT_V2_SCENARIOS).map((g) => {
    const d = DEFAULT_V2_SCENARIOS.find((x) => x.key === g.key) ?? DEFAULT_V2_SCENARIOS[1];
    return {
      key: g.key ?? d.key,
      label: g.label ?? d.label,
      university: g.university || d.university,
      group: g.group || d.group,
      direct_contact: g.direct_contact || d.direct_contact,
      warm_contact: g.warm_contact || d.warm_contact,
    };
  });

/** Same placeholders and tidying as the server's px_abc_v2_render. */
export const renderV2 = (text: string, name: string, inviter: string | null, group: string) =>
  text.split('{name}').join(name).split('{inviter}').join(inviter || 'someone you know')
    .split('{group}').join(group.trim()).replace(/\s{2,}/g, ' ').trim();

/**
 * The V2 questionnaire built in the browser exactly as the server would build it,
 * for the admin simulator (nothing is saved).
 */
export function previewV2State(opts: {
  experiment: Experiment;
  groupKey: string | undefined;
  name: 'Jane' | 'John';
  intermediary: { type: IntermediaryType; name: string | null };
  order: AbcV2Question[];
  answers: Partial<Record<AbcV2Question, number>>;
}): AbcV2State {
  const { experiment: e, intermediary } = opts;
  const groups = withV2Defaults(e.abc_v2_scenarios);
  const g = groups.find((x) => x.key === opts.groupKey) ?? groups[0];
  const warm = intermediary.type !== 'none';
  const order = opts.order.filter((q) => q !== 'warm' || warm);
  const r = (t: string) => renderV2(t, opts.name, intermediary.name, e.abc_v2_group ?? '');
  const questions: AbcV2State['questions'] = {
    university: { scenario: r(g.university), contact: r(g.direct_contact), question: QUESTION },
    shared_group: { scenario: r(g.group), contact: r(g.direct_contact), question: QUESTION },
    ...(warm ? { warm: { scenario: r(g.group), contact: r(g.warm_contact), question: QUESTION } } : {}),
  };
  return {
    eligible: true, version: 'v2', name: opts.name, order, questions, answers: opts.answers,
    classification: g.key, intermediary, completed: order.every((q) => opts.answers[q] != null),
  };
}
