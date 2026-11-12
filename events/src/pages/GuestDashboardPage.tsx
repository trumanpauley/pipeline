import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { signOut, useSession } from '../lib/auth';
import { firstName, formatShortDate, inviteUrl } from '../lib/format';
import type { DashboardInvitation, GuestDashboard } from '../lib/types';
import { Chain } from '../components/Chain';
import { EventHeader } from '../components/EventHeader';
import { ConfirmButton, useToast } from '../components/Feedback';
import { CheckIcon, MoreIcon, ShareIcon } from '../components/Icons';
import { ErrorNote, Layout, Spinner } from '../components/Layout';
import { Sheet } from '../components/Sheet';

export function GuestDashboardPage() {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const session = useSession();
  const [data, setData] = useState<GuestDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    api.guestDashboard(eventId).then(setData).catch(e => setError(e.message));
  }, [eventId]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // One-time notice after arriving from an invitation; cleared so a reload doesn't repeat it.
  const welcome = (location.state as { welcome?: string } | null)?.welcome;
  const { show } = toast;
  useEffect(() => {
    if (!welcome || !data) return;
    if (welcome === 'already_guest') show('You’d already RSVP’d');
    window.history.replaceState({}, '');
  }, [welcome, data, show]);

  if (session === undefined) return <Layout><Spinner /></Layout>;
  if (session === null) return <Navigate to={`/me?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (error) {
    return (
      <Layout>
        <div className="state"><ErrorNote message={error} /><Link className="btn btn--block" to="/me">My events</Link></div>
      </Layout>
    );
  }
  if (!data) return <Layout><Spinner /></Layout>;

  const { event, guest } = data;
  const isHost = guest.role === 'host';
  const going = guest.rsvp_status === 'attending';
  const accepted = data.invitations.filter(i => i.status === 'accepted').length;

  return (
    <Layout action={<button className="icon-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}><MoreIcon /></button>}>
      <EventHeader
        event={event}
        status={<span className={going ? 'status status--going' : 'status'}>{isHost ? 'Hosting' : going ? 'You’re going' : 'Not going'}</span>}
      />

      {going && event.private_details && (
        <section className="section">
          <span className="label">Details</span>
          <p className="details">{event.private_details}</p>
        </section>
      )}

      {!isHost && (
        <section className="section">
          <div className="section-head">
            <span className="label">Invite</span>
            <span className="faint small">{accepted}/2</span>
          </div>
          <div className="passes">
            {data.invitations.map(inv => (
              <InvitationPass key={inv.id} inv={inv} guestName={guest.full_name} eventName={event.name}
                onChanged={load} onToast={toast.show} />
            ))}
          </div>
        </section>
      )}

      {!isHost && (
        <section className="section">
          <span className="label">How you got here</span>
          <Chain nodes={data.path.map(p => ({ name: p.is_you ? guest.full_name : p.name, role: p.role, isYou: p.is_you }))} />
        </section>
      )}

      <GuestMenu open={menuOpen} onClose={() => setMenuOpen(false)} data={data} onChanged={load} />
      {toast.node}
    </Layout>
  );
}

function InvitationPass({ inv, guestName, eventName, onChanged, onToast }: {
  inv: DashboardInvitation; guestName: string; eventName: string; onChanged: () => void; onToast: (m: string) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (inv.status === 'accepted') {
    return (
      <div className="pass">
        <div className="pass-body">
          <span className="pass-title">{inv.accepted_name}</span>
          <span className="pass-sub">Joined {formatShortDate(inv.accepted_at)}</span>
        </div>
        <span className="pass-check" aria-label="Accepted"><CheckIcon /></span>
      </div>
    );
  }
  if (inv.status !== 'open' || !inv.token) {
    return <div className="pass"><div className="pass-body"><span className="pass-sub">Unavailable</span></div></div>;
  }

  const url = inviteUrl(inv.token);
  const message = `${firstName(guestName)} invited you to ${eventName}. RSVP here (this link works once): ${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onToast('Link copied');
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  async function share() {
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

  async function rotate() {
    setError(null);
    try {
      await api.rotateInvitation(inv.id);
      setOptionsOpen(false);
      onChanged();
      onToast('New link created');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="pass pass--open">
      <div className="pass-body">
        <span className="pass-title">Invitation {inv.slot}</span>
        <span className="pass-sub">Single use</span>
      </div>
      <button className="icon-btn" aria-label={`More options for invitation ${inv.slot}`} onClick={() => setOptionsOpen(true)}><MoreIcon /></button>
      <button className="btn btn--primary btn--sm" onClick={share}><ShareIcon />Share</button>

      <Sheet open={optionsOpen} onClose={() => setOptionsOpen(false)} title={`Invitation ${inv.slot}`}>
        <ul className="menu">
          <li><button className="menu-item" onClick={() => { copy(); setOptionsOpen(false); }}>Copy link</button></li>
          <li><a className="menu-item" href={`sms:?&body=${encodeURIComponent(message)}`}>Send as text</a></li>
        </ul>
        <div className="menu-group">
          <ul className="menu">
            <li><ConfirmButton className="menu-item menu-item--danger" confirmLabel="Tap again — the old link will stop working" onConfirm={rotate}>Reset link</ConfirmButton></li>
          </ul>
        </div>
        <ErrorNote message={error} />
      </Sheet>
    </div>
  );
}

function GuestMenu({ open, onClose, data, onChanged }: {
  open: boolean; onClose: () => void; data: GuestDashboard; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'menu' | 'remove'>('menu');
  const [note, setNote] = useState('');
  const { event, guest } = data;
  const isHost = guest.role === 'host';
  const going = guest.rsvp_status === 'attending';

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const close = () => { setView('menu'); onClose(); };

  if (view === 'remove') {
    return (
      <Sheet open={open} onClose={close} title="Remove my information">
        <div className="form">
          <p className="muted">Your name and email are removed. An anonymous record of your RSVP stays with the event.</p>
          <textarea rows={2} maxLength={1000} aria-label="Note" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <ErrorNote message={error} />
          <button className="btn btn--block btn--danger" disabled={busy}
            onClick={() => run(() => api.requestRemoval(event.id, note)).then(ok => ok && setView('menu'))}>Send request</button>
          <button className="text-btn center" onClick={() => setView('menu')}>Cancel</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={close}>
      {isHost && (
        <div className="menu-group">
          <ul className="menu">
            <li><Link className="menu-item menu-item--green" to={`/organizer?event=${event.id}`}>Organizer dashboard</Link></li>
          </ul>
        </div>
      )}

      {!isHost && (
        <div className="menu-group">
          <ul className="menu">
            <li>
              {going ? (
                <ConfirmButton className="menu-item" confirmLabel="Tap again to release your spot" disabled={busy}
                  onConfirm={() => run(() => api.setRsvpStatus(event.id, 'declined'))}>
                  Can’t make it
                </ConfirmButton>
              ) : (
                <button className="menu-item menu-item--green" disabled={busy} onClick={() => run(() => api.setRsvpStatus(event.id, 'attending'))}>
                  I can come after all
                </button>
              )}
            </li>
            <li>
              <button className="menu-item" role="switch" aria-checked={data.marketing_consent} disabled={busy}
                onClick={() => run(() => api.setMarketingConsent(event.id, !data.marketing_consent))}>
                <span>Pipeline updates</span>
                <span className={data.marketing_consent ? 'switch switch--on' : 'switch'} aria-hidden="true" />
              </button>
            </li>
          </ul>
          <p className="menu-caption">{data.marketing_consent_text}</p>
        </div>
      )}

      <div className="menu-group">
        <ul className="menu">
          <li><Link className="menu-item" to="/me" onClick={close}>My events</Link></li>
          {!isHost && (
            <li>
              {data.removal_requested ? (
                <button className="menu-item" disabled>Removal requested</button>
              ) : (
                <button className="menu-item menu-item--danger" onClick={() => setView('remove')}>Remove my information</button>
              )}
            </li>
          )}
          <li><button className="menu-item" onClick={() => signOut()}><span>Sign out</span><span className="faint small">{guest.email}</span></button></li>
        </ul>
      </div>
      <ErrorNote message={error} />
    </Sheet>
  );
}
