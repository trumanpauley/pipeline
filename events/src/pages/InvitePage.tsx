import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { sendCode, signOut } from '../lib/auth';
import { EMAIL_RE } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { InvitationLookup } from '../lib/types';
import { Chain } from '../components/Chain';
import { CodeStep } from '../components/CodeStep';
import { EventHeader } from '../components/EventHeader';
import { ErrorNote, Layout, Spinner } from '../components/Layout';
import { Sheet } from '../components/Sheet';

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
  // Reopen the sheet after a reload mid-verification.
  const [sheetOpen, setSheetOpen] = useState(() => draft.step === 'code');

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
    return <Layout><div className="state"><ErrorNote message={loadError} /></div></Layout>;
  }
  if (!invite) return <Layout><Spinner /></Layout>;

  if (invite.status !== 'open' || !invite.event) {
    return <Layout><InviteUnavailable invite={invite} /></Layout>;
  }

  const { event, inviter_name = 'A friend', consent_texts } = invite;
  const accepting = draft.step === 'accepting';

  return (
    <Layout cta>
      <EventHeader event={event} />

      <section className="section" aria-label="Invited by">
        <span className="label">Invited by</span>
        <Chain nodes={[{ name: inviter_name, role: 'guest' }, { name: draft.fullName, role: 'guest', isYou: true, pending: true }]} />
      </section>

      <div className="cta-bar">
        <div>
          <button className="btn btn--primary btn--block" onClick={() => setSheetOpen(true)}>RSVP</button>
        </div>
      </div>

      <Sheet open={sheetOpen} onClose={() => !busy && !accepting && setSheetOpen(false)}
        title={draft.step === 'code' ? 'Confirm it’s you' : 'RSVP'}>
        {draft.step === 'details' && (
          <form className="form" onSubmit={submitDetails} noValidate>
            <input autoComplete="name" aria-label="Full name" value={draft.fullName} maxLength={100}
              onChange={e => update({ fullName: e.target.value })} placeholder="Full name" required autoFocus />
            <input type="email" inputMode="email" autoComplete="email" aria-label="Email" value={draft.email}
              onChange={e => update({ email: e.target.value })} placeholder="Email" required />
            <label className="check">
              <input type="checkbox" checked={draft.marketing} onChange={e => update({ marketing: e.target.checked })} />
              <span>{consent_texts?.pipeline_marketing.body}</span>
            </label>
            <ErrorNote message={error} />
            <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Sending code…' : 'Continue'}</button>
            <p className="fineprint">{consent_texts?.event_rsvp.body}</p>
            <Link className="text-btn center" to="/me">Already RSVP’d? Sign in</Link>
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

        {accepting && <Spinner label="Saving your RSVP" />}
      </Sheet>
    </Layout>
  );
}

function InviteUnavailable({ invite }: { invite: InvitationLookup }) {
  const copy: Record<string, { title: string; body: string }> = {
    used: { title: 'Already used', body: 'Each invitation works once.' },
    full: { title: 'Fully booked', body: 'Every spot has been claimed.' },
    closed: { title: 'RSVPs closed', body: 'This event is no longer taking RSVPs.' },
    not_found: { title: 'Invitation not found', body: 'Ask whoever invited you for a new link.' },
  };
  const c = copy[invite.status] ?? copy.not_found;
  return (
    <div className="state">
      <div className="state-body">
        {invite.event && <span className="label">{invite.event.name}</span>}
        <h1 className="title title--sm">{c.title}</h1>
        <p className="muted">{c.body}</p>
      </div>
      <Link className="btn btn--block" to="/me">Already RSVP’d? Sign in</Link>
    </div>
  );
}
