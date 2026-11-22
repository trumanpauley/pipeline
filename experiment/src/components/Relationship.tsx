import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from './ui';

export const CLOSENESS_LABELS = [
  'Barely know them',
  'Acquaintance',
  'Know them fairly well',
  'Good friend',
  'Very close friend',
] as const;

/**
 * Connection-strength meter: five bars that fill up like a signal meter.
 * Tap a bar or slide along them (touch, mouse or arrow keys); the description
 * of the chosen level shows underneath. One tap to choose, one to continue.
 */
export function ClosenessMeter({
  name,
  onConfirm,
}: {
  name: string;
  onConfirm: (value: number, responseMs: number) => void;
}) {
  const [value, setValue] = useState<number | null>(null);
  const started = useRef(performance.now());
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromPointer = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const v = Math.min(5, Math.max(1, Math.ceil(((clientX - left) / width) * 5)));
    setValue(v);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fromPointer(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => dragging.current && fromPointer(e.clientX);
  const onUp = () => { dragging.current = false; };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const v = value ?? 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setValue(Math.min(5, v + 1));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setValue(Math.max(1, (v || 2) - 1));
    else if (e.key === 'Home') setValue(1);
    else if (e.key === 'End') setValue(5);
    else return;
    e.preventDefault();
  };

  return (
    <div className="closeness" data-value={value ?? ''}>
      <h1 className="question">How close are you to {name}?</h1>
      <div
        ref={track}
        className="closeness-meter"
        role="slider"
        tabIndex={0}
        aria-label={`How close are you to ${name}?`}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value ? `${value} of 5: ${CLOSENESS_LABELS[value - 1]}` : 'Not chosen'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        {CLOSENESS_LABELS.map((label, i) => (
          <span
            key={label}
            className={`closeness-bar ${value !== null && i < value ? 'is-on' : ''} ${value === i + 1 ? 'is-current' : ''}`}
            style={{ ['--h' as string]: `${36 + i * 16}%`, animationDelay: `${0.05 * i}s` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="closeness-scale" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" tabIndex={-1} className={value === n ? 'is-current' : ''} onClick={() => setValue(n)}>
            {n}
          </button>
        ))}
      </div>
      <p className={`closeness-label ${value ? 'is-shown' : ''}`} aria-live="polite">
        {value ? CLOSENESS_LABELS[value - 1] : 'Tap or slide to choose'}
      </p>
      <Button
        disabled={value === null}
        onClick={() => value && onConfirm(value, Math.round(performance.now() - started.current))}
      >
        Continue
      </Button>
    </div>
  );
}

/** A 1–5 question that moves on as soon as a number is tapped. */
export function ScaleQuestion({
  question,
  context,
  low,
  high,
  onSelect,
  testId,
}: {
  question: string;
  /** Optional line above the question (e.g. the ABC scenario, kept in view). */
  context?: string;
  low: string;
  high: string;
  onSelect: (value: number) => void;
  testId?: string;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const choose = (v: number) => {
    if (chosen) return;
    setChosen(v);
    window.setTimeout(() => onSelect(v), 320);
  };
  return (
    <div className="classifier layout-scale" data-testid={testId}>
      {context && <p className="scale-context">{context}</p>}
      <h1 className="question">{question}</h1>
      <div className="options-scale">
        <div className="scale-row">
          {[1, 2, 3, 4, 5].map((v, i) => (
            <button
              key={v}
              type="button"
              className={`scale-dot ${chosen === v ? 'is-chosen' : ''} ${chosen && chosen !== v ? 'is-dimmed' : ''}`}
              onClick={() => choose(v)}
              aria-label={`${v} of 5${v === 1 ? ` (${low})` : v === 5 ? ` (${high})` : ''}`}
              style={{ animationDelay: `${0.06 * i}s`, ['--size' as string]: `${40 + i * 6}px` }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="scale-labels">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      </div>
    </div>
  );
}

export const COMFORT_QUESTION = (name: string) => `How comfortable would you feel asking ${name} for an introduction?`;
