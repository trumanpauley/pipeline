import { useState } from 'react';
import type { AbcState } from '../lib/api';
import { ScaleQuestion } from './Relationship';
import { Button, ErrorText, Sheet } from './ui';

type Q = 'cold' | 'warm';

export const abcQuestion = (q: Q, name: string, inviter: string) =>
  q === 'cold'
    ? `How likely would you be to respond if ${name} sent you a message asking for advice?`
    : `How likely would you be to respond if ${inviter} personally introduced ${name} to you?`;

/**
 * The ABC questionnaire: a scenario about Jane or John, then the same request
 * arriving cold (a message from a stranger) and through the inviter, in the assigned order.
 * Answers already given are skipped, so a half-finished questionnaire resumes
 * where it stopped. The scenario stays above both questions so they differ
 * only in how the person gets in touch.
 *
 * Used for real participants (answers go to Supabase) and by the admin
 * preview (answers stay in the browser), via the callbacks.
 */
export function AbcFlow({
  state,
  onClassify,
  onAnswer,
  onClose,
  onDone,
}: {
  state: AbcState;
  onClassify: (key: string) => Promise<void>;
  onAnswer: (q: Q, value: number) => Promise<void>;
  /** "Not now": close without finishing (it can be resumed later). */
  onClose: () => void;
  onDone: () => void;
}) {
  const order: Q[] = state.order === 'warm_first' ? ['warm', 'cold'] : ['cold', 'warm'];
  const remaining = order.filter((q) => state[q] == null);
  const [step, setStep] = useState<'intro' | Q | 'done'>(
    state.completed ? 'done' : remaining.length < 2 ? remaining[0] ?? 'done' : 'intro',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = state.name ?? 'Jane';
  const inviter = state.inviter_name || 'the person who invited you';

  const answer = async (q: Q, v: number) => {
    setError(null);
    try {
      await onAnswer(q, v);
      const next = order[order.indexOf(q) + 1];
      setStep(next && state[next] == null ? next : 'done');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (state.needs_classification) {
    return (
      <Sheet onClose={onClose}>
        <div className="stack fade-up abc" data-step="classify">
          <p className="eyebrow">One quick scenario</p>
          <h1 className="question">Which describes you?</h1>
          <div className="category-options" role="radiogroup" aria-label="Which describes you?">
            {(state.groups ?? []).map((g) => (
              <button
                key={g.key}
                type="button"
                role="radio"
                aria-checked={false}
                className="chip"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await onClassify(g.key);
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
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

  return (
    <Sheet onClose={onClose}>
      <div className="stack abc" data-step={step} data-order={state.order} data-name={name}>
        {step === 'intro' && (
          <div className="stack fade-up">
            <p className="eyebrow">One quick scenario</p>
            <h1 className="question abc-scenario">{state.scenario}</h1>
            <p className="muted">Two short questions about how you’d respond. There are no right answers.</p>
            <Button onClick={() => setStep(order[0])}>Continue</Button>
            <button type="button" className="link center-link" onClick={onClose}>Not now</button>
          </div>
        )}
        {(step === 'cold' || step === 'warm') && (
          <div className="fade-up" key={step}>
            <ScaleQuestion
              testId={`abc-${step}`}
              context={state.scenario}
              question={abcQuestion(step, name, inviter)}
              low="Very unlikely"
              high="Very likely"
              onSelect={(v) => void answer(step, v)}
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
