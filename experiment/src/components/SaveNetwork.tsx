import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { formatPhone, normalizePhone } from '../lib/phone';
import { Button, Constellation, ErrorText } from './ui';

type Step = 'phone' | 'code' | 'done';

/**
 * Save your network with a verified phone number (Supabase Phone Auth).
 *
 * The number is attached to the participant's *existing* anonymous account:
 * updateUser({ phone }) texts a code, then verifyOtp({ type: 'phone_change' })
 * confirms it. The auth user id never changes, so the participant record,
 * referral links and answers stay exactly as they are, and no duplicate
 * account is created. Only shown when VITE_PHONE_AUTH=1.
 */
export function SaveNetworkOverlay({ onClose }: { onClose: (changed: boolean) => void }) {
  const [step, setStep] = useState<Step>('phone');
  const [input, setInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const sendCode = async (number: string) => {
    const { error: e } = await supabase.auth.updateUser({ phone: number });
    if (!e) return null;
    if (/already|exists|registered/i.test(e.message)) return 'That number already holds a saved network.';
    if (/rate limit|too many/i.test(e.message)) return 'Too many texts just now. Try again in a few minutes.';
    if (/provider|disabled|not enabled|sms/i.test(e.message)) return 'Text messages aren’t available yet.';
    return 'We couldn’t send a code. Check the number and try again.';
  };

  const submitPhone = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const number = normalizePhone(input);
    if (!number) return setError('Enter a valid phone number.');
    setBusy(true);
    const problem = await sendCode(number);
    setBusy(false);
    if (problem) return setError(problem);
    setPhone(number);
    setCooldown(30);
    setStep('code');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ phone, token: code, type: 'phone_change' });
    setBusy(false);
    if (err) return setError('That code didn’t work. Check it and try again.');
    setStep('done');
  };

  const resend = async () => {
    setCooldown(30);
    const problem = await sendCode(phone);
    if (problem) setError(problem);
  };

  return (
    <div className="waitlist-overlay" role="dialog" aria-modal="true">
      <div className="reveal-glow" aria-hidden="true" />
      <div className="waitlist-inner">
        {step === 'phone' && (
          <form className="stack" onSubmit={submitPhone}>
            <Constellation small />
            <p className="eyebrow fade-up" style={{ animationDelay: '.2s' }}>Your network</p>
            <h1 className="display small fade-up" style={{ animationDelay: '.35s' }}>Keep your network.</h1>
            <p className="muted fade-up" style={{ animationDelay: '.5s' }}>
              Verify your phone to open it on any device.
            </p>
            <div className="stack fade-up" style={{ animationDelay: '.65s' }}>
              <input
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(617) 555-0142"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="Phone number"
              />
              <ErrorText error={error} />
              <Button type="submit" busy={busy} disabled={!input.trim()}>Text me a code</Button>
              <p className="fine text-center">Used only to sign you in. Message and data rates may apply.</p>
              <button type="button" className="link center-link" onClick={() => onClose(false)}>Not now</button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form className="stack fade-up" onSubmit={verify}>
            <h1 className="title">Enter the code</h1>
            <p className="muted">Texted to <span className="em">{formatPhone(phone)}</span>.</p>
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
            <div className="row-links">
              <button type="button" className="link" onClick={() => { setStep('phone'); setCode(''); setError(null); }}>
                Change number
              </button>
              <button type="button" className="link" onClick={resend} disabled={cooldown > 0}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {step === 'done' && (
          <div className="stack text-center">
            <div className="ready-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h1 className="title fade-up">Network saved.</h1>
            <p className="muted fade-up">Sign in with {formatPhone(phone)} on any device.</p>
            <Button onClick={() => onClose(true)}>Continue</Button>
          </div>
        )}
      </div>
    </div>
  );
}
