import { useCallback, useEffect, useRef, useState } from 'react';
import { COPY } from '../config/experiment';
import { Button, Constellation } from './ui';

// Timeline (ms). The whole sequence takes ~5.5s; the button works throughout and
// any tap skips straight to the end.
const T = {
  typeStart: 750, // after the headline has settled
  bodyMsPerChar: 38,
  buttonFade: 300, // pause after the sentence before the button fades in
  followDelay: 300,
  followMsPerChar: 32,
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Types `text` once `run` is true. The full sentence is always laid out (the
 * untyped tail is invisible), so nothing reflows while it types. Screen readers
 * get the whole sentence immediately.
 */
function Typewriter({
  text,
  run,
  instant,
  msPerChar,
  onDone,
  className,
}: {
  text: string;
  run: boolean;
  instant: boolean;
  msPerChar: number;
  onDone: () => void;
  className?: string;
}) {
  const [count, setCount] = useState(instant ? text.length : 0);
  const done = count >= text.length;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (instant) setCount(text.length);
  }, [instant, text.length]);

  useEffect(() => {
    if (!run || instant) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const n = Math.min(text.length, Math.floor((now - start) / msPerChar) + 1);
      setCount(n);
      if (n < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, instant, msPerChar, text.length]);

  useEffect(() => {
    if (done) doneRef.current();
  }, [done]);

  return (
    <p className={`typewriter ${className ?? ''}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, count)}
        <span className={`tw-caret ${run && !done ? 'is-on' : ''}`} />
        <span className="tw-rest">{text.slice(count)}</span>
      </span>
    </p>
  );
}

/** The invitation landing: inviter's name, a typed line, then the way in. */
export function LandingIntro({ senderName, onEnter }: { senderName: string | null; onEnter: () => void }) {
  const firstName = senderName?.trim().split(/\s+/)[0] || null;
  const [instant, setInstant] = useState(prefersReducedMotion);
  const [typing, setTyping] = useState(false);
  const [bodyDone, setBodyDone] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [typingFollow, setTypingFollow] = useState(false);
  const [followDone, setFollowDone] = useState(false);

  // Any tap, key or focus on the button finishes the sequence at once.
  const skip = useCallback(() => setInstant(true), []);

  useEffect(() => {
    if (instant) return;
    const t = window.setTimeout(() => setTyping(true), T.typeStart);
    return () => window.clearTimeout(t);
  }, [instant]);

  useEffect(() => {
    if (instant) {
      setBodyDone(true);
      setShowButton(true);
      setFollowDone(true);
      return;
    }
    if (!bodyDone) return;
    const a = window.setTimeout(() => setShowButton(true), T.buttonFade);
    const b = window.setTimeout(() => setTypingFollow(true), T.buttonFade + T.followDelay);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [bodyDone, instant]);

  useEffect(() => {
    if (instant) return;
    const onKey = () => setInstant(true);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [instant]);

  return (
    <div className={`landing-intro ${instant ? 'is-instant' : ''}`} onPointerDown={skip}>
      <Constellation />
      <div className="stack text-center">
        <h1 className="display landing-title fade-up" style={{ animationDelay: instant ? '0s' : '.35s' }}>
          {COPY.landingTitle(firstName)}
        </h1>
        <Typewriter
          className="muted landing-body"
          text={COPY.landingBody}
          run={typing}
          instant={instant}
          msPerChar={T.bodyMsPerChar}
          onDone={() => setBodyDone(true)}
        />
      </div>
      <div className="landing-actions">
        {/* Always in the DOM and clickable, so nobody has to wait for the animation. */}
        <div className={`landing-cta ${showButton ? 'is-shown' : ''}`} onFocus={skip}>
          <Button onClick={onEnter}>{COPY.landingCta}</Button>
        </div>
        <Typewriter
          className="landing-follow"
          text={COPY.landingFollow}
          run={typingFollow}
          instant={instant}
          msPerChar={T.followMsPerChar}
          onDone={() => setFollowDone(true)}
        />
        <p className={`fine landing-meta ${followDone ? 'is-shown' : ''}`}>{COPY.landingMeta}</p>
      </div>
    </div>
  );
}
