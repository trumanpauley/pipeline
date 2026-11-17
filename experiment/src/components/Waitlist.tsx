import { useState, type FormEvent } from 'react';
import { api, type MyAccount } from '../lib/api';
import { supabase } from '../lib/supabase';
import { isEmail } from './EmailAuth';
import { Button, Check, Constellation, ErrorText } from './ui';

type Mode = 'waitlist' | 'link';
type Step = 'form' | 'code' | 'done';

const DEFAULT_CONSENT = 'Email me Pipeline updates and early-access news. Unsubscribe anytime.';

/**
 * Full-screen and optional.
 *  - "waitlist": Pipeline updates / early-access signup. Requires an explicit,
 *    unticked-by-default consent checkbox; the exact wording comes from the
 *    server and is stored with the signup. It is separate from research
 *    consent and from saving the network.
 *  - "link": save the network to a verified email (used while phone
 *    verification is switched off). Not a mailing list.
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
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState(account?.waitlist_email ?? '');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consentText = account?.waitlist_consent_text ?? DEFAULT_CONSENT;
  const clean = email.trim().toLowerCase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEmail(clean)) return setError('Enter a valid email.');
    setBusy(true);
    try {
      if (mode === 'waitlist') {
        if (!consent) return setError('Tick the box to get Pipeline updates.');
        await api.joinWaitlist(clean, 'reveal');
        setStep('done');
      } else {
        const { error: err } = await supabase.auth.updateUser({ email: clean }, { emailRedirectTo: window.location.origin });
        if (!err) return setStep('code');
        if (/already|exists|registered/i.test(err.message)) setError('That email already holds a saved network.');
        else if (/rate limit/i.test(err.message)) setError('Too many emails just now. Try again in a few minutes.');
        else setError('We couldn’t send a code right now.');
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
                : 'Link a verified email to open your network on any device.'}
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
              {mode === 'waitlist' && (
                <Check checked={consent} onChange={setConsent}>{consentText}</Check>
              )}
              <ErrorText error={error} />
              <Button type="submit" busy={busy} disabled={mode === 'waitlist' && !consent}>
                {mode === 'waitlist' ? 'Join the waitlist' : 'Send code'}
              </Button>
              {mode === 'link' && (
                <p className="fine text-center">Used only to sign you in. Not added to any mailing list.</p>
              )}
              <button type="button" className="link center-link" onClick={() => onClose(false)}>
                Not now
              </button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form className="stack fade-up" onSubmit={verify}>
            <h1 className="title">Enter the code</h1>
            <p className="muted">Sent to <span className="em">{clean}</span>.</p>
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
            <button type="button" className="link center-link" onClick={() => onClose(false)}>Skip for now</button>
          </form>
        )}

        {step === 'done' && (
          <div className="stack text-center">
            <div className="ready-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h1 className="title fade-up">{mode === 'waitlist' ? 'You’re on the list.' : 'Network saved.'}</h1>
            <p className="muted fade-up">
              {mode === 'waitlist'
                ? `We’ll email ${clean} when early access opens.`
                : `Sign in with ${clean} on any device.`}
            </p>
            <Button onClick={() => onClose(true)}>Continue</Button>
          </div>
        )}
      </div>
    </div>
  );
}
