import { useEffect, useState } from 'react';

/** Full-screen reveal: words resolve out of blur one at a time. */
export function RevealOverlay({
  step,
  title,
  onDone,
}: {
  step: number;
  title: string;
  onDone: () => void;
}) {
  const [ready, setReady] = useState(false);
  const words = title.split(' ');
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 500 + words.length * 110);
    return () => window.clearTimeout(t);
  }, [words.length]);

  return (
    <div className="reveal-overlay" onClick={() => ready && onDone()} role="dialog" aria-live="polite">
      <div className="reveal-glow" aria-hidden="true" />
      <p className="eyebrow reveal-eyebrow">Unlocked · {step} of 2</p>
      <h1 className={`reveal-title ${step === 1 ? 'is-name' : ''}`}>
        {words.map((w, i) => (
          <span key={i}>
            <span className="reveal-word" style={{ animationDelay: `${0.25 + i * 0.11}s` }}>{w}</span>{' '}
          </span>
        ))}
      </h1>
      <button className={`btn btn-secondary reveal-continue ${ready ? 'is-ready' : ''}`} onClick={onDone}>
        Continue
      </button>
    </div>
  );
}
