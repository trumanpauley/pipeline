import { useState, type FormEvent } from 'react';
import { api, type MyAccount } from '../lib/api';
import { isEmail } from './EmailAuth';
import { Button, Check, Constellation, ErrorText } from './ui';

const RESEARCH_TEXT = 'I’m interested in participating in future Pipeline experiments.';
const PRIVACY =
  'We’ll only use your email for Pipeline early access and, if you tick the box, invitations to future experiments. It’s never shown to anyone. No account is created, and you can unsubscribe anytime from “Your data”.';

type Step = 'form' | 'manage' | 'done' | 'saved';

/**
 * Optional early-access signup, shown once at the end of the invitation
 * experiment (after the second invitation, or after the "answer one question
 * instead" skip) and reachable later from the home screen and "Your data".
 *
 * "Join Early Access" puts the email on the early-access list; the separate,
 * unticked checkbox adds consent to be contacted about future experiments.
 * No password, no code, no account: the email is attached on the server to the
 * participant's existing anonymous identity and the experiment they're in.
 */
export function CommunityOverlay({
  account,
  onClose,
  onSkip,
}: {
  account: MyAccount | null;
  /** changed: the signup or preferences were saved. */
  onClose: (changed: boolean) => void;
  /** "Not Now" on the first screen. */
  onSkip: () => void;
}) {
  const current = account?.community ?? null;
  const subscribed = Boolean(current?.subscribed);
  const researchText = account?.community_consent_texts?.research_invites ?? RESEARCH_TEXT;

  const [step, setStep] = useState<Step>(subscribed ? 'manage' : 'form');
  const [email, setEmail] = useState(current?.email ?? '');
  const [research, setResearch] = useState(subscribed ? Boolean(current?.research_invites) : false);
  const [updates, setUpdates] = useState(subscribed ? Boolean(current?.updates) : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = email.trim().toLowerCase();
  const anyChosen = research || updates;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEmail(clean)) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      await api.joinCommunity(clean, research, true);
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (r: boolean, u: boolean) => {
    setError(null);
    setBusy(true);
    try {
      await api.updateCommunityPreferences(r, u);
      setResearch(r);
      setUpdates(u);
      setStep('saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="waitlist-overlay community" role="dialog" aria-modal="true" aria-label="Early access">
      <div className="reveal-glow" aria-hidden="true" />
      <div className="waitlist-inner">
        {step === 'form' && (
          <form className="stack" onSubmit={join} noValidate>
            <Constellation small />
            <h1 className="display small fade-up" style={{ animationDelay: '.2s' }}>Be part of what’s next.</h1>
            <p className="muted fade-up" style={{ animationDelay: '.35s' }}>
              Pipeline is building a new way to discover connections through shared communities. Join our
              early-access list to be among the first to experience it.
            </p>
            <div className="stack fade-up" style={{ animationDelay: '.5s' }}>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Your email (optional)"
                value={email}
                maxLength={254}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                aria-label="Email address"
              />
              <div className="consents">
                <Check checked={research} onChange={setResearch}>{researchText}</Check>
              </div>
              <ErrorText error={error} />
              <Button type="submit" busy={busy} disabled={!clean}>Join Early Access</Button>
              <button type="button" className="link center-link" onClick={current ? () => onClose(false) : onSkip}>
                Not Now
              </button>
              <p className="fine text-center">{PRIVACY}</p>
            </div>
          </form>
        )}

        {step === 'manage' && (
          <div className="stack fade-up">
            <p className="eyebrow">Early access</p>
            <h1 className="title">Your preferences</h1>
            <p className="muted">Signed up as <span className="em">{current?.email}</span>.</p>
            <div className="consents">
              <Check checked={updates} onChange={setUpdates}>Pipeline early-access updates.</Check>
              <Check checked={research} onChange={setResearch}>{researchText}</Check>
            </div>
            {!anyChosen && <p className="fine">With neither selected, you’ll be unsubscribed.</p>}
            <ErrorText error={error} />
            <Button busy={busy} onClick={() => void save(research, updates)}>
              {anyChosen ? 'Save preferences' : 'Unsubscribe'}
            </Button>
            {anyChosen && (
              <button type="button" className="link center-link" onClick={() => void save(false, false)}>
                Unsubscribe from everything
              </button>
            )}
            <button type="button" className="link center-link" onClick={() => onClose(false)}>Close</button>
          </div>
        )}

        {(step === 'done' || step === 'saved') && (
          <div className="stack text-center">
            <div className="ready-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h1 className="title fade-up">
              {step === 'done' ? 'You’re on the list.' : anyChosen ? 'Preferences saved.' : 'You’re unsubscribed.'}
            </h1>
            <p className="muted fade-up">
              {step === 'done'
                ? research
                  ? 'We’ll be in touch about early access and future experiments.'
                  : 'We’ll be in touch when early access opens.'
                : anyChosen
                  ? 'You can change them anytime.'
                  : 'We won’t contact you. You can rejoin anytime.'}
            </p>
            <Button onClick={() => onClose(true)}>Continue</Button>
          </div>
        )}
      </div>
    </div>
  );
}
