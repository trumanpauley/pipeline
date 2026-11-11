import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { sendCode, signOut } from '../lib/auth';
import { EMAIL_RE, firstName, formatEventDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { InvitationLookup } from '../lib/types';
import { CodeStep } from '../components/CodeStep';
import { ErrorNote, Layout, Spinner } from '../components/Layout';

type Step = 'details' | 'code' | 'accepting';

interface Draft {
  fullName: string;
  email: string;
  marketing: boolean;
  step: Step;
}

const EMPTY: Draft = { fullName: '', email: '', marketing: false, step: 'details' };

// Survives a reload (e.g. the in-app browser refreshing while the guest checks email).
function loadDraft(token: string): Draft {
  try {
    const raw = sessionStorage.getItem(`pe-rsvp-${token}`);
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Partial<Draft>;
    return { ...EMPTY, ...saved, step: saved.step === 'code' ? 'code' : 'details' };
  } catch {
    return EMPTY;
  }
}

function saveDraft(token: string, draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(`pe-rsvp-${token}`, JSON.stringify(draft));
    else sessionStorage.removeItem(`pe-rsvp-${token}`);
  } catch {
    /* storage unavailable: the flow still works without persistence */
  }
}

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InvitationLookup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => loadDraft(token));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getInvitation(token).then(setInvite).catch(e => setLoadError(e.message));
  }, [token]);

  useEffect(() => saveDraft(token, draft), [token, draft]);

  const update = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));

  async function accept(fullName: string, marketing: boolean) {
    update({ step: 'accepting' });
    setError(null);
    try {
      const result = await api.acceptInvitation(token, fullName, marketing);
      saveDraft(token, null);
      navigate(`/e/${result.event_id}`, { replace: true, state: { welcome: result.result } });
    } catch (err) {
      setError((err as Error).message);
      update({ step: 'details' });
      // Refresh status: the link may have just been used or the event filled up.
      api.getInvitation(token).then(setInvite).catch(() => {});
    }
  }

  async function submitDetails(e: FormEvent) {
    e.preventDefault();
    const fullName = draft.fullName.trim().replace(/\s+/g, ' ');
    const email = draft.email.trim().toLowerCase();
    if (fullName.length < 2) return setError('Please enter your full name.');
    if (!EMAIL_RE.test(email)) return setError('Please enter a valid email address.');
    update({ fullName, email });
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const sessionEmail = data.session?.user.email?.toLowerCase();
      if (sessionEmail === email && data.session?.user.email_confirmed_at) {
        // Already verified on this device: no code needed.
        await accept(fullName, draft.marketing);
        return;
      }
      if (data.session) await signOut();
      await sendCode(email);
      update({ fullName, email, step: 'code' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <Layout><div className="card"><ErrorNote message={loadError} /></div></Layout>;
  }
  if (!invite) return <Layout><Spinner /></Layout>;

  if (invite.status !== 'open' || !invite.event) {
    return <Layout><InviteUnavailable invite={invite} /></Layout>;
  }

  const { event, inviter_name = 'A friend', consent_texts } = invite;

  return (
    <Layout>
      <section className="hero">
        <p className="eyebrow">You're invited</p>
        <h1 className="hero-title">
          {firstName(inviter_name)} invited you to <span className="accent">{event.name}</span>
        </h1>
        <ul className="facts">
          <li><span aria-hidden="true">📅</span>{formatEventDate(event.starts_at, event.ends_at)}</li>
          {event.location_name && <li><span aria-hidden="true">📍</span>{event.location_name}</li>}
          <li><span aria-hidden="true">✉️</span>From {inviter_name}</li>
        </ul>
        {event.description && <p className="hero-desc">{event.description}</p>}
      </section>

      <div className="card">
        {draft.step === 'details' && (
          <form className="stack" onSubmit={submitDetails} noValidate>
            <h2>RSVP</h2>
            <label className="field">
              <span>Full name</span>
              <input autoComplete="name" value={draft.fullName} maxLength={100}
                onChange={e => update({ fullName: e.target.value })} placeholder="First and last name" required />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" inputMode="email" autoComplete="email" value={draft.email}
                onChange={e => update({ email: e.target.value })} placeholder="you@example.com" required />
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.marketing} onChange={e => update({ marketing: e.target.checked })} />
              <span>
                {consent_texts?.pipeline_marketing.body}
                <em className="optional"> Optional.</em>
              </span>
            </label>
            <ErrorNote message={error} />
            <button className="btn btn--primary btn--lg" disabled={busy}>
              {busy ? 'Sending code…' : "I'm in — RSVP"}
            </button>
            <p className="fineprint">{consent_texts?.event_rsvp.body}</p>
          </form>
        )}

        {draft.step === 'code' && (
          <>
            <CodeStep
              email={draft.email}
              submitLabel="Confirm RSVP"
              onVerified={() => accept(draft.fullName, draft.marketing)}
              onChangeEmail={() => update({ step: 'details' })}
            />
            <ErrorNote message={error} />
          </>
        )}

        {draft.step === 'accepting' && <Spinner label="Saving your RSVP…" />}
      </div>

      <p className="center small muted">
        Already RSVP'd? <Link to="/me">Find your invitations</Link>
      </p>
    </Layout>
  );
}

function InviteUnavailable({ invite }: { invite: InvitationLookup }) {
  const copy: Record<string, { title: string; body: string }> = {
    used: {
      title: 'This invitation has been used',
      body: 'Each link works once. If you already RSVP’d, sign in with your email to see your invitations. Otherwise, ask whoever invited you for a new link.',
    },
    full: {
      title: 'This event is full',
      body: 'Every spot has been claimed. Spots open up if guests change their RSVP, so you can try this link again later.',
    },
    closed: { title: 'RSVPs are closed', body: 'The organizer is no longer accepting RSVPs for this event.' },
    not_found: {
      title: 'Invitation not found',
      body: 'This link is invalid or was replaced by a newer one. Ask whoever invited you to send it again.',
    },
  };
  const c = copy[invite.status] ?? copy.not_found;
  return (
    <div className="card stack">
      {invite.event && <p className="eyebrow">{invite.event.name}</p>}
      <h1>{c.title}</h1>
      <p className="muted">{c.body}</p>
      <Link className="btn" to="/me">Sign in to my invitations</Link>
    </div>
  );
}
