import { useState, type FormEvent } from 'react';
import { api, type MyAccount } from '../lib/api';
import { LANDING_LINK } from '../config/experiment';
import { isEmail } from './EmailAuth';
import { Button, Check, Constellation, ErrorText } from './ui';

const RESEARCH_TEXT = 'I’m interested in participating in future Pipeline experiments.';
const PRIVACY =
  'We’ll only use your email for Pipeline early access and, if you tick the box, invitations to future experiments. It’s never shown to anyone. No account is created, and you can unsubscribe anytime from “Your data”.';

/**
 * Shown when a participant has finished the experiment (after the second
 * invitation, or after the "answer one question instead" skip), and reachable
 * later from the home screen.
 *
 *  - It says plainly that the experiment is complete: nothing more is required.
 *  - "Explore Pipeline" links to the public site with a non-identifying
 *    ?source=experiment tag. No name, link token or experiment id is ever in the URL.
 *  - Early access is optional and never pre-selected. Joining goes through the
 *    same server function as before (join_community): the email is stored with the
 *    exact consent wording and timestamp, the experiment is set by the server, and
 *    repeat signups are idempotent. Someone who already opted in to updates is not
 *    asked again.
 */
export function CompletionOverlay({
  account,
  onClose,
  onSkip,
}: {
  account: MyAccount | null;
  /** changed: a signup was saved. */
  onClose: (changed: boolean) => void;
  /** "Back to my network" without signing up (the server remembers, so this screen doesn't pop up again). */
  onSkip: () => void;
}) {
  const current = account?.community ?? null;
  const alreadyIn = Boolean(current?.subscribed && current.updates);
  const researchText = account?.community_consent_texts?.research_invites ?? RESEARCH_TEXT;

  const [email, setEmail] = useState(current?.email ?? '');
  const [research, setResearch] = useState(false);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = email.trim().toLowerCase();

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEmail(clean)) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      await api.joinCommunity(clean, research, true);
      setJoined(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onList = alreadyIn || joined;

  return (
    <div className="waitlist-overlay completion" role="dialog" aria-modal="true" aria-label="Experiment complete">
      <div className="reveal-glow" aria-hidden="true" />
      <div className="waitlist-inner">
        <div className="stack">
          <Constellation small />
          <p className="complete-pill fade-up" style={{ animationDelay: '.15s' }}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Experiment complete
          </p>
          <h1 className="display small fade-up" style={{ animationDelay: '.3s' }}>Every connection tells a story.</h1>
          <p className="muted fade-up" style={{ animationDelay: '.45s' }}>
            Thank you for helping us better understand how people are connected.
          </p>
          <p className="muted fade-up" style={{ animationDelay: '.55s' }}>
            We’re building Pipeline to help people discover and navigate the networks they already belong to.
          </p>

          <div className="stack fade-up" style={{ animationDelay: '.7s' }}>
            <a className="btn btn-primary" href={LANDING_LINK} rel="noopener">Explore Pipeline</a>

            {onList ? (
              <p className="fine text-center" data-testid="completion-on-list">
                You’re on the early-access list{current?.email && !joined ? ` as ${current.email}` : ''}. We’ll be in touch.
              </p>
            ) : (
              <form className="stack completion-form" onSubmit={join} noValidate>
                <p className="eyebrow">Early access · optional</p>
                <input
                  className="input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="Your email"
                  value={email}
                  maxLength={254}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  aria-label="Email address"
                />
                <div className="consents">
                  <Check checked={research} onChange={setResearch}>{researchText}</Check>
                </div>
                <ErrorText error={error} />
                <Button type="submit" variant="secondary" busy={busy} disabled={!clean}>Join Early Access</Button>
                <p className="fine text-center">{PRIVACY}</p>
              </form>
            )}

            <button type="button" className="link center-link" onClick={() => (onList ? onClose(joined) : onSkip())}>
              Back to my network
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
