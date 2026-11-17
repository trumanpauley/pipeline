import { useState, type FormEvent } from 'react';
import { sendCode } from '../lib/auth';
import { EMAIL_RE } from '../lib/format';
import { CodeStep } from './CodeStep';
import { ErrorNote } from './Layout';

export function SignIn({ title }: { title: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email.');
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

  return (
    <div className="state">
      <h1 className="title title--sm">{title}</h1>
      {sent ? (
        // The session listener in the parent page takes over once verified.
        <CodeStep email={email.trim().toLowerCase()} onVerified={() => {}} onChangeEmail={() => setSent(false)} />
      ) : (
        <form className="form" onSubmit={submit}>
          <input type="email" inputMode="email" autoComplete="email" aria-label="Email" value={email}
            onChange={e => setEmail(e.target.value)} placeholder="Email" required autoFocus />
          <ErrorNote message={error} />
          <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Sending…' : 'Continue'}</button>
        </form>
      )}
    </div>
  );
}
