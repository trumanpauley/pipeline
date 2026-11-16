import { useState, type FormEvent } from 'react';
import { api, type MyAccount } from '../lib/api';
import { supabase } from '../lib/supabase';
import { isEmail } from './EmailAuth';
import { Button, Check, Constellation, ErrorText } from './ui';

type Mode = 'waitlist' | 'link';
type Step = 'form' | 'code' | 'done';

/**
 * Full-screen, optional. "waitlist" appears after the second reveal; "link"
 * (save your network to a verified email) is offered from the same screen and
 * from Your data. Waitlist consent is stored separately from research consent.
 */
export function WaitlistOverlay({
  mode,
  account,
  onClose,
}: {
  mode: Mode;
  account: MyAccount | null;
  onClose: (changed: boolean) => void;
}) {
  const canLink = !account?.linked_email;
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState(account?.waitlist_email ?? '');
  const [alsoLink, setAlsoLink] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [linked, setLinked] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);

  const wantsLink = mode === 'link' || (alsoLink && canLink);
  const clean = email.trim().toLowerCase();

  /** Starts email linking; returns null on success or a message explaining why not. */
  const startLink = async (): Promise<string | null> => {
    const { error: e } = await supabase.auth.updateUser(
      { email: clean },
      { emailRedirectTo: window.location.origin },
    );
    if (!e) return null;
    if (/already|exists|registered/i.test(e.message)) return 'That email already holds a saved network, so it wasn’t linked here.';
    if (/rate limit/i.test(e.message)) return 'Too many emails just now. You can save your network later from Your data.';
    return 'We couldn’t send a code right now. You can try again from Your data.';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEmail(clean)) return setError('Enter a valid email.');
    setBusy(true);
    try {
      if (mode === 'waitlist') {
        await api.joinWaitlist(clean, 'reveal');
        setJoined(true);
      }
      const problem = wantsLink ? await startLink() : null;
      if (wantsLink && !problem) setStep('code');
      else if (mode === 'link') setError(problem);
      else {
        setLinkNote(problem);
        setStep('done');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: clean, token: code, type: 'email_change' });
    setBusy(false);
    if (err) return setError('That code didn’t work. Check it and try again.');
    setLinked(clean);
    setStep('done');
  };

  return (
    <div className="waitlist-overlay" role="dialog" aria-modal="true">
      <div className="reveal-glow" aria-hidden="true" />
      <div className="waitlist-inner">
        {step === 'form' && (
          <form className="stack" onSubmit={submit}>
            <Constellation small />
            <p className="eyebrow fade-up" style={{ animationDelay: '.2s' }}>
              {mode === 'waitlist' ? 'Early access' : 'Your network'}
            </p>
            <h1 className="display small fade-up" style={{ animationDelay: '.35s' }}>
              {mode === 'waitlist' ? 'Be first in.' : 'Keep your network.'}
            </h1>
            <p className="muted fade-up" style={{ animationDelay: '.5s' }}>
              {mode === 'waitlist'
                ? 'Pipeline opens to a small group first. Leave your email to join the waitlist.'
                : 'Link a verified email to open your branch on any device.'}
            </p>
            <div className="stack fade-up" style={{ animationDelay: '.65s' }}>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@school.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email"
              />
              {mode === 'waitlist' && canLink && (
                <Check checked={alsoLink} onChange={setAlsoLink}>
                  Also save my network to this email
                  <span className="check-sub">Use it on any device. We’ll send a 6-digit code.</span>
                </Check>
              )}
              <ErrorText error={error} />
              <Button type="submit" busy={busy}>
                {mode === 'waitlist' ? 'Join the waitlist' : 'Send code'}
              </Button>
              <p className="fine text-center">
                {mode === 'waitlist'
                  ? 'Only about early access. Unsubscribe anytime.'
                  : 'Used only to sign you in. Not added to any mailing list.'}
              </p>
              <button type="button" className="link center-link" onClick={() => onClose(false)}>
                Not now
              </button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form className="stack fade-up" onSubmit={verify}>
            {joined && <p className="eyebrow">You’re on the list</p>}
            <h1 className="title">Enter the code</h1>
            <p className="muted">
              Sent to <span className="em">{clean}</span>. This saves your network to that email.
            </p>
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              aria-label="Verification code"
            />
            <ErrorText error={error} />
            <Button type="submit" busy={busy} disabled={code.length < 6}>Verify</Button>
            <button type="button" className="link center-link" onClick={() => (joined ? setStep('done') : onClose(false))}>
              Skip for now
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="stack text-center">
            <div className="ready-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h1 className="title fade-up">{joined ? 'You’re on the list.' : 'Network saved.'}</h1>
            {joined && <p className="muted fade-up">We’ll email {clean} when early access opens.</p>}
            {linked && <p className="muted fade-up">Your network is saved to {linked}. Sign in with it on any device.</p>}
            {linkNote && <p className="muted small fade-up">{linkNote}</p>}
            <Button onClick={() => onClose(true)}>Continue</Button>
          </div>
        )}
      </div>
    </div>
  );
}
