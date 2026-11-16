import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { Button, ErrorText } from './ui';

/** Email → one-time code (or magic link). The parent reacts to the session. */
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
      options: { emailRedirectTo: window.location.href.split('#')[0] },
    });
    if (error) setError(error.message);
  };

  return (
    <form className="stack fade-up" onSubmit={verify}>
      <p className="eyebrow">Check your email</p>
      <h1 className="title">Enter the code</h1>
      <p className="muted">
        Sent to <span className="em">{email}</span>. You can also tap the link in the email.
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
      <Button type="submit" busy={busy} disabled={code.length < 6}>
        Verify
      </Button>
      <div className="row-links">
        <button type="button" className="link" onClick={onBack}>
          Change email
        </button>
        <button type="button" className="link" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}

export async function sendCode(email: string, data?: Record<string, unknown>) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: window.location.href.split('#')[0], data },
  });
  if (error) {
    if (/rate limit/i.test(error.message)) throw new Error('Too many emails just now. Try again in a minute.');
    throw new Error(error.message);
  }
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/** Plain sign-in for returning participants and the admin. */
export function SignIn({ heading, sub }: { heading: ReactNode; sub?: ReactNode }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) return <EmailCodeStep email={email.trim().toLowerCase()} onBack={() => setSent(false)} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError('Enter a valid email.');
    setBusy(true);
    setError(null);
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
      <ErrorText error={error} />
      <Button type="submit" busy={busy}>
        Email me a code
      </Button>
    </form>
  );
}
