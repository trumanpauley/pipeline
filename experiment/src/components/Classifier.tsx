import { useRef, useState } from 'react';
import { methodDef } from '../config/experiment';

/**
 * One-tap relationship classification. Renders whichever experimental method
 * the participant was assigned and reports the value plus time-to-answer.
 */
export function Classifier({
  method,
  name,
  onSelect,
}: {
  method: string;
  name: string;
  onSelect: (value: string, responseMs: number) => void;
}) {
  const def = methodDef(method);
  const started = useRef(performance.now());
  const [chosen, setChosen] = useState<string | null>(null);

  const choose = (value: string) => {
    if (chosen) return;
    setChosen(value);
    const ms = Math.round(performance.now() - started.current);
    window.setTimeout(() => onSelect(value, ms), 320);
  };

  return (
    <div className={`classifier layout-${def.layout}`} data-method={def.key}>
      <h1 className="question">{def.question(name)}</h1>

      {def.layout === 'stack' && (
        <div className="options-stack">
          {def.options.map((o, i) => (
            <button
              key={o.value}
              className={`option ${chosen === o.value ? 'is-chosen' : ''} ${chosen && chosen !== o.value ? 'is-dimmed' : ''}`}
              onClick={() => choose(o.value)}
              style={{ animationDelay: `${0.08 * i}s` }}
            >
              <span className="strength-dots" aria-hidden="true">
                {[0, 1, 2].map((d) => (
                  <i key={d} className={d < def.options.length - i ? 'on' : ''} />
                ))}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}

      {def.layout === 'grid' && (
        <div className="options-grid">
          {def.options.map((o, i) => (
            <button
              key={o.value}
              className={`option tile ${chosen === o.value ? 'is-chosen' : ''} ${chosen && chosen !== o.value ? 'is-dimmed' : ''}`}
              onClick={() => choose(o.value)}
              style={{ animationDelay: `${0.05 * i}s` }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {def.layout === 'scale' && (
        <div className="options-scale">
          <div className="scale-row">
            {def.options.map((o, i) => (
              <button
                key={o.value}
                className={`scale-dot ${chosen === o.value ? 'is-chosen' : ''} ${chosen && chosen !== o.value ? 'is-dimmed' : ''}`}
                onClick={() => choose(o.value)}
                aria-label={`${o.label} of 5`}
                style={{ animationDelay: `${0.06 * i}s`, ['--size' as string]: `${40 + i * 6}px` }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="scale-labels">
            <span>{def.scaleLabels?.[0]}</span>
            <span>{def.scaleLabels?.[1]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
