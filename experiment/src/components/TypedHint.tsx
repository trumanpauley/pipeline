import { useEffect, useMemo, useState } from 'react';

const reducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * A one-line instruction that types itself in once `start` becomes true
 * (e.g. the first time a field is focused) and then stays.
 *
 * - Natural rhythm: each character gets a slightly varied delay, a little
 *   longer after spaces and punctuation, scaled to `duration` overall.
 * - The full line's space is reserved from the start (the untyped part is
 *   invisible), so nothing around it moves while it types.
 * - Reduced motion: the text appears at once.
 * - Never touches focus or the field: typing in the input is unaffected.
 * - Screen readers get the whole sentence (via the `id`, for aria-describedby).
 */
export function TypedHint({
  text,
  start,
  id,
  duration = 1200,
}: {
  text: string;
  start: boolean;
  id?: string;
  duration?: number;
}) {
  const [shown, setShown] = useState(0);

  // When each character appears, in ms from the start.
  const times = useMemo(() => {
    const chars = [...text];
    const weights = chars.map((_c, i) => {
      const prev = chars[i - 1] ?? '';
      const pause = prev === ' ' ? 1.5 : /[.,]/.test(prev) ? 2.2 : 1;
      return pause * (0.75 + Math.random() * 0.5);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    return weights.map((w) => (acc += w) / total * duration);
  }, [text, duration]);

  useEffect(() => {
    if (!start) return;
    const n = times.length;
    if (reducedMotion()) {
      setShown(n);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = now - t0;
      let k = 0;
      while (k < n && times[k] <= elapsed) k++;
      setShown(k);
      if (k < n) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, times]);

  const chars = [...text];
  const typing = start && shown < chars.length;
  return (
    <p className={`type-hint ${start ? 'is-started' : ''}`} id={id} data-done={shown >= chars.length ? 'true' : 'false'}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {chars.slice(0, shown).join('')}
        {typing && <i className="type-hint-caret" />}
        <span className="type-hint-rest">{chars.slice(shown).join('')}</span>
      </span>
    </p>
  );
}
