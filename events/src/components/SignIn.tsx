import { useState, type FormEvent } from 'react';
import { sendCode } from '../lib/auth';
import { EMAIL_RE } from '../lib/format';
import { CodeStep } from './CodeStep';
import { ErrorNote } from './Layout';

export function SignIn({ title, intro }: { title: string; intro: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.');
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
  }

  if (sent) {
    // The session listener in the parent page takes over once verified.
    return <div className="card"><CodeStep email={email.trim().toLowerCase()} onVerified={() => {}} onChangeEmail={() => setSent(false)} /></div>;
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div>
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
      </div>
      <label className="field">
        <span>Email</span>
        <input type="email" inputMode="email" autoComplete="email" value={email}
          onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
      </label>
      <ErrorNote message={error} />
      <button className="btn btn--primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
    </form>
  );
}
