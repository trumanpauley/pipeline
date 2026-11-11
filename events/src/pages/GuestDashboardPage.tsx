import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { signOut, useSession } from '../lib/auth';
import { firstName, formatEventDate, formatShortDate, inviteUrl } from '../lib/format';
import type { DashboardInvitation, GuestDashboard } from '../lib/types';
import { ErrorNote, Layout, Spinner } from '../components/Layout';

export function GuestDashboardPage() {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const session = useSession();
  const [data, setData] = useState<GuestDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const welcome = (location.state as { welcome?: string } | null)?.welcome;

  const load = useCallback(() => {
    api.guestDashboard(eventId).then(setData).catch(e => setError(e.message));
  }, [eventId]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (session === undefined) return <Layout><Spinner /></Layout>;
  if (session === null) return <Navigate to={`/me?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (error) return <Layout><div className="card stack"><ErrorNote message={error} /><Link to="/me">Back to my events</Link></div></Layout>;
  if (!data) return <Layout><Spinner /></Layout>;

  const { event, guest } = data;
  const isHost = guest.role === 'host';

  return (
    <Layout>
      {welcome === 'accepted' && (
        <div className="banner banner--ok" role="status">
          <strong>You're on the list, {firstName(guest.full_name)}!</strong> Now pass it on — you have two invitations to share.
        </div>
      )}
      {welcome === 'already_guest' && (
        <div className="banner" role="status">You'd already RSVP'd to this event — here are your invitations. The link you opened is still unused.</div>
      )}

      <section className="hero hero--compact">
        <p className="eyebrow">{guest.rsvp_status === 'attending' ? "You're going" : "You're not going"}</p>
        <h1 className="hero-title">{event.name}</h1>
        <ul className="facts">
          <li><span aria-hidden="true">📅</span>{formatEventDate(event.starts_at, event.ends_at)}</li>
          {event.location_name && <li><span aria-hidden="true">📍</span>{event.location_name}</li>}
        </ul>
        {event.private_details && guest.rsvp_status === 'attending' && (
          <div className="private-details"><span className="tag">Guests only</span><p>{event.private_details}</p></div>
        )}
      </section>

      {isHost ? (
        <div className="card stack">
          <h2>You're an organizer</h2>
          <p className="muted">Create invitation links and follow RSVPs from the organizer dashboard.</p>
          <Link className="btn btn--primary" to={`/organizer?event=${event.id}`}>Open organizer dashboard</Link>
        </div>
      ) : (
        <section className="stack">
          <div className="section-head">
            <h2>Your invitations</h2>
            <span className="muted small">{data.invitations.filter(i => i.status === 'accepted').length} of 2 accepted</span>
          </div>
          <p className="muted small">Each link works once. Send each one to a single person you'd like to bring.</p>
          {data.invitations.map(inv => (
            <InvitationSlot key={inv.id} inv={inv} guestName={guest.full_name} eventName={event.name} onChanged={load} />
          ))}
        </section>
      )}

      <section className="card stack">
        <h2>How you got here</h2>
        <ol className="path">
          {data.path.map((p, i) => (
            <li key={i} className={p.is_you ? 'path-node path-node--you' : 'path-node'}>
              <span className="path-dot" aria-hidden="true" />
              <span>{p.is_you ? 'You' : p.name}</span>
              {p.role === 'host' && <span className="tag">Organizer</span>}
            </li>
          ))}
        </ol>
        {!isHost && (
          <p className="muted small">
            {guest.depth === 1 ? 'You were invited directly by the organizer.' : `You're ${guest.depth} invitations away from the organizer.`}
          </p>
        )}
      </section>

      {!isHost && <RsvpCard eventId={event.id} status={guest.rsvp_status} onChanged={load} />}
      <PrivacyCard data={data} onChanged={load} />

      <div className="row row--between small">
        <Link to="/me">My events</Link>
        <button className="link" onClick={() => signOut()}>Sign out ({guest.email})</button>
      </div>
    </Layout>
  );
}

function InvitationSlot({ inv, guestName, eventName, onChanged }: {
  inv: DashboardInvitation; guestName: string; eventName: string; onChanged: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (inv.status === 'accepted') {
    return (
      <div className="slot slot--accepted">
        <span className="slot-num">{inv.slot}</span>
        <div>
          <strong>{inv.accepted_name}</strong>
          <div className="muted small">Accepted {formatShortDate(inv.accepted_at)}</div>
        </div>
        <span className="check-badge" aria-label="Accepted">✓</span>
      </div>
    );
  }
  if (inv.status !== 'open' || !inv.token) {
    return <div className="slot"><span className="slot-num">{inv.slot}</span><span className="muted">No longer available</span></div>;
  }

  const url = inviteUrl(inv.token);
  const message = `${firstName(guestName)} invited you to ${eventName}. RSVP here (this link works once): ${url}`;

  async function share() {
    setError(null);
    if (navigator.share) {
      try {
        await navigator.share({ title: eventName, text: message });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  async function rotate() {
    if (!confirm('Create a new link for this slot? The old link will stop working.')) return;
    setBusy(true);
    try {
      await api.rotateInvitation(inv.id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="slot slot--open">
      <div className="row">
        <span className="slot-num">{inv.slot}</span>
        <div className="grow">
          <strong>Unused invitation</strong>
          <div className="link-preview">{url.replace(/^https?:\/\//, '')}</div>
        </div>
      </div>
      <div className="row slot-actions">
        <button className="btn btn--primary grow" onClick={share}>Share</button>
        <a className="btn" href={`sms:?&body=${encodeURIComponent(message)}`}>Text</a>
        <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <button className="link small" onClick={rotate} disabled={busy}>Sent to the wrong person? Reset this link</button>
      <ErrorNote message={error} />
    </div>
  );
}

function RsvpCard({ eventId, status, onChanged }: { eventId: string; status: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = status === 'attending' ? 'declined' : 'attending';

  async function change() {
    if (next === 'declined' && !confirm('Release your spot? You can change back later if there is still room.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.setRsvpStatus(eventId, next);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Your RSVP</h2>
      <p className="muted">{status === 'attending' ? "You're going." : "You've said you can't make it."} Your invitations stay active either way.</p>
      <ErrorNote message={error} />
      <button className="btn" onClick={change} disabled={busy}>
        {status === 'attending' ? "I can't make it anymore" : 'I can come after all'}
      </button>
    </section>
  );
}

function PrivacyCard({ data, onChanged }: { data: GuestDashboard; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showRemoval, setShowRemoval] = useState(false);

  async function toggleConsent(granted: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.setMarketingConsent(data.event.id, granted);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestRemoval() {
    setBusy(true);
    setError(null);
    try {
      await api.requestRemoval(data.event.id, note);
      setShowRemoval(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Privacy</h2>
      <label className="check">
        <input type="checkbox" checked={data.marketing_consent} disabled={busy}
          onChange={e => toggleConsent(e.target.checked)} />
        <span>{data.marketing_consent_text}</span>
      </label>
      <p className="muted small">Other guests can see your name, never your email.</p>
      {data.guest.role === 'guest' && (data.removal_requested ? (
        <p className="banner">Your removal request is with the organizer.</p>
      ) : showRemoval ? (
        <div className="stack">
          <p className="small">
            We'll remove your name and email. A record that an anonymous guest RSVP'd stays, so the guest
            count and invitation history remain accurate. You won't be able to sign back in to this event.
          </p>
          <textarea rows={2} maxLength={1000} placeholder="Anything we should know? (optional)" value={note}
            onChange={e => setNote(e.target.value)} />
          <div className="row">
            <button className="btn btn--danger" onClick={requestRemoval} disabled={busy}>Request removal</button>
            <button className="btn" onClick={() => setShowRemoval(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="link small" onClick={() => setShowRemoval(true)}>Remove my information</button>
      ))}
      <ErrorNote message={error} />
    </section>
  );
}
