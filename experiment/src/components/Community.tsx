import { useState, type FormEvent } from 'react';
import { api, type MyAccount } from '../lib/api';
import { isEmail } from './EmailAuth';
import { Button, Check, Constellation, ErrorText } from './ui';

const TEXTS = {
  research_invites: 'Invite me to future Pipeline experiments.',
  updates: 'Send me Pipeline updates and early access.',
};

type Step = 'form' | 'manage' | 'done' | 'saved';

/**
 * Optional Pipeline Community signup, shown once after the mission reveal and
 * reachable later from the home screen and the privacy sheet.
 *
 * Two independent, unticked consents. Joining needs at least one; with neither
 * ticked nothing is stored. No password and no account: the email is attached
 * to the participant's existing anonymous identity on the server.
 */
export function CommunityOverlay({
  account,
  onClose,
  onSkip,
}: {
  account: MyAccount | null;
  /** changed: the signup or preferences were saved. */
  onClose: (changed: boolean) => void;
  /** "Maybe later" from the first screen. */
  onSkip: () => void;
}) {
  const current = account?.community ?? null;
  const subscribed = Boolean(current?.subscribed);
  const texts = { ...TEXTS, ...(account?.community_consent_texts ?? {}) };

  const [step, setStep] = useState<Step>(subscribed ? 'manage' : 'form');
  const [email, setEmail] = useState(current?.email ?? '');
  const [research, setResearch] = useState(subscribed ? Boolean(current?.research_invites) : false);
  const [updates, setUpdates] = useState(subscribed ? Boolean(current?.updates) : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = email.trim().toLowerCase();
  const anyChosen = research || updates;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEmail(clean)) return setError('Enter a valid email address.');
    if (!anyChosen) return setError('Choose at least one option to join.');
    setBusy(true);
    try {
      await api.joinCommunity(clean, research, updates);
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
    <div className="waitlist-overlay community" role="dialog" aria-modal="true" aria-label="Pipeline Community">
      <div className="reveal-glow" aria-hidden="true" />
      <div className="waitlist-inner">
        {step === 'form' && (
          <form className="stack" onSubmit={join} noValidate>
            <Constellation small />
            <p className="eyebrow fade-up" style={{ animationDelay: '.2s' }}>Welcome to Pipeline</p>
            <h1 className="display small fade-up" style={{ animationDelay: '.35s' }}>You’re just getting connected.</h1>
            <p className="muted fade-up" style={{ animationDelay: '.5s' }}>
              Help us build a better way to navigate the people and communities we’re connected to.
            </p>
            <div className="stack fade-up" style={{ animationDelay: '.65s' }}>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Your email address"
                value={email}
                maxLength={254}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                aria-label="Your email address"
              />
              <div className="consents">
                <Check checked={research} onChange={(v) => { setResearch(v); setError(null); }}>{texts.research_invites}</Check>
                <Check checked={updates} onChange={(v) => { setUpdates(v); setError(null); }}>{texts.updates}</Check>
              </div>
              <ErrorText error={error} />
              <Button type="submit" busy={busy} disabled={!anyChosen || !clean}>Join the Pipeline Community</Button>
              {!anyChosen && (
                <p className="fine text-center" data-testid="community-none-note">
                  Choose at least one option to join. Nothing is saved otherwise.
                </p>
              )}
              <button type="button" className="link center-link" onClick={current ? () => onClose(false) : onSkip}>
                Maybe later
              </button>
              <p className="fine text-center">Early access, future experiments, and occasional updates. Optional.</p>
            </div>
          </form>
        )}

        {step === 'manage' && (
          <div className="stack fade-up">
            <p className="eyebrow">Pipeline Community</p>
            <h1 className="title">Your preferences</h1>
            <p className="muted">Signed up as <span className="em">{current?.email}</span>.</p>
            <div className="consents">
              <Check checked={research} onChange={setResearch}>{texts.research_invites}</Check>
              <Check checked={updates} onChange={setUpdates}>{texts.updates}</Check>
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
              {step === 'done' ? 'You’re in.' : anyChosen ? 'Preferences saved.' : 'You’re unsubscribed.'}
            </h1>
            <p className="muted fade-up">
              {step === 'done'
                ? 'Welcome to the Pipeline Community.'
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
