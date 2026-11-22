import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { captchaToken } from '../lib/captcha';
import { formatPhone, normalizePhone, phoneEnabled } from '../lib/phone';
import { Button, ErrorText } from './ui';

/**
 * Email → sign-in link. Supabase's default email (no custom SMTP) contains only
 * a link, so that's what this screen asks for; tapping it opens the app signed
 * in. A code box stays one tap away for emails that include a code (custom
 * templates, and the local demo, where it's shown straight away). The parent
 * reacts to the session either way.
 */
export function EmailCodeStep({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(30);
  const [showCode, setShowCode] = useState(Boolean(import.meta.env.VITE_DEMO));

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const verify = async (e?: FormEvent) => {
    e?.preventDefault();
    if (code.length < 6) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    setBusy(false);
    if (error) setError('That code didn’t work. Check it and try again.');
  };

  const resend = async () => {
    setCooldown(30);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0], captchaToken: await captchaToken() },
    });
    if (error) setError(error.message);
  };

  return (
    <form className="stack fade-up" onSubmit={verify}>
      <p className="eyebrow">Check your email</p>
      <h1 className="title">Tap the link in your email</h1>
      <p className="muted">
        We sent a sign-in link to <span className="em">{email}</span>. Open it on this device to continue.
      </p>
      {showCode ? (
        <>
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
          <Button type="submit" busy={busy} disabled={code.length < 6}>
            Verify
          </Button>
        </>
      ) : (
        <>
          <ErrorText error={error} />
          <button type="button" className="link center-link" onClick={() => setShowCode(true)}>
            Have a code instead?
          </button>
        </>
      )}
      <div className="row-links">
        <button type="button" className="link" onClick={onBack}>
          Change email
        </button>
        <button type="button" className="link" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
        </button>
      </div>
    </form>
  );
}

export async function sendCode(email: string, data?: Record<string, unknown>) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: window.location.href.split('#')[0], data, captchaToken: await captchaToken() },
  });
  if (error) {
    if (/rate limit/i.test(error.message)) throw new Error('Too many emails just now. Try again in a minute.');
    throw new Error(error.message);
  }
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/** Plain sign-in for returning participants and the admin. */
export function SignIn({
  heading,
  sub,
  allowPhone = true,
}: {
  heading: ReactNode;
  sub?: ReactNode;
  /** Offer "Use phone number instead" (only when phone verification is enabled). */
  allowPhone?: boolean;
}) {
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUsePhone = allowPhone && phoneEnabled;

  if (sent && mode === 'email') return <EmailCodeStep email={email.trim().toLowerCase()} onBack={() => setSent(false)} />;
  if (sent && mode === 'phone') return <PhoneCodeStep phone={phone} onBack={() => setSent(false)} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'phone') {
      const number = normalizePhone(phoneInput);
      if (!number) return setError('Enter a valid phone number.');
      setBusy(true);
      // shouldCreateUser: false — only numbers already linked to a participant
      // can sign in, so nobody can create accounts (or SMS costs) by guessing.
      const { error: err } = await supabase.auth.signInWithOtp({
        phone: number,
        options: { shouldCreateUser: false, captchaToken: await captchaToken() },
      });
      setBusy(false);
      if (err) {
        return setError(/signups not allowed|not found/i.test(err.message)
          ? 'No saved network uses that number.'
          : /rate limit/i.test(err.message) ? 'Too many texts just now. Try again in a few minutes.' : 'We couldn’t send a code.');
      }
      setPhone(number);
      return setSent(true);
    }
    if (!isEmail(email)) return setError('Enter a valid email.');
    setBusy(true);
    try {
      await sendCode(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack fade-up" onSubmit={submit}>
      <h1 className="title">{heading}</h1>
      {sub && <p className="muted">{sub}</p>}
      {mode === 'email' ? (
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
      ) : (
        <input
          className="input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(617) 555-0142"
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          aria-label="Phone number"
        />
      )}
      <ErrorText error={error} />
      <Button type="submit" busy={busy}>
        {mode === 'email' ? 'Email me a sign-in link' : 'Text me a code'}
      </Button>
      {canUsePhone && (
        <button
          type="button"
          className="link center-link"
          onClick={() => { setMode(mode === 'email' ? 'phone' : 'email'); setError(null); }}
        >
          {mode === 'email' ? 'Use phone number instead' : 'Use email instead'}
        </button>
      )}
    </form>
  );
}

/** SMS code entry for returning participants who saved their network by phone. */
function PhoneCodeStep({ phone, onBack }: { phone: string; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    setBusy(false);
    if (err) setError('That code didn’t work. Check it and try again.');
  };
  return (
    <form className="stack fade-up" onSubmit={verify}>
      <p className="eyebrow">Check your messages</p>
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
      <button type="button" className="link center-link" onClick={onBack}>Change number</button>
    </form>
  );
}
