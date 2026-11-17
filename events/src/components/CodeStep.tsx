import { useEffect, useState, type FormEvent } from 'react';
import { sendCode, verifyCode } from '../lib/auth';
import { ErrorNote } from './Layout';

interface Props {
  email: string;
  onVerified: () => Promise<void> | void;
  onChangeEmail: () => void;
  submitLabel?: string;
}

/** Enter the one-time code we emailed. Works inside in-app browsers (no link switching). */
export function CodeStep({ email, onVerified, onChangeEmail, submitLabel = 'Continue' }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(45);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email, code);
      await onVerified();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await sendCode(email);
      setCooldown(45);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="muted">Code sent to <span style={{ color: 'var(--ink)' }}>{email}</span></p>
      <input
        className="code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Code"
        maxLength={12}
        placeholder="••••••"
        value={code}
        onChange={e => setCode(e.target.value)}
        autoFocus
        required
      />
      <ErrorNote message={error} />
      <button className="btn btn--primary btn--block" disabled={busy || code.replace(/\D/g, '').length < 6}>
        {busy ? 'Checking…' : submitLabel}
      </button>
      <div className="row row--between">
        <button type="button" className="text-btn" onClick={onChangeEmail}>Change email</button>
        <button type="button" className="text-btn" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
        </button>
      </div>
    </form>
  );
}
