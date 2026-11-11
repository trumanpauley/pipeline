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
    <form className="stack" onSubmit={submit}>
      <div>
        <h2>Check your email</h2>
        <p className="muted">
          We sent a code to <strong>{email}</strong>. It confirms this is you, so you can come back to
          your RSVP and invitations from any device.
        </p>
      </div>
      <label className="field">
        <span>Code</span>
        <input
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,12}"
          maxLength={12}
          placeholder="123456"
          value={code}
          onChange={e => setCode(e.target.value)}
          autoFocus
          required
        />
      </label>
      <ErrorNote message={error} />
      <button className="btn btn--primary" disabled={busy || code.replace(/\D/g, '').length < 6}>
        {busy ? 'Checking…' : submitLabel}
      </button>
      <div className="row row--between small">
        <button type="button" className="link" onClick={onChangeEmail}>Use a different email</button>
        <button type="button" className="link" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}
