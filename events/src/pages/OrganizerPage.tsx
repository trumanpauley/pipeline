import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, loadOrganizerData, type OrganizerData } from '../lib/api';
import { signOut, useSession } from '../lib/auth';
import { downloadCsv, toCsv } from '../lib/csv';
import { eventWhen, formatShortDate, inviteUrl } from '../lib/format';
import {
  CONSENT_CSV_HEADERS, GUEST_CSV_HEADERS, REFERRAL_CSV_HEADERS, computeStats, consentCsvRows,
  growthByDay, guestCsvRows, latestMarketingConsent, referralCsvRows,
} from '../lib/organizer';
import type { MyEvent } from '../lib/types';
import { ConfirmButton, useToast } from '../components/Feedback';
import { MoreIcon } from '../components/Icons';
import { ErrorNote, Layout, Spinner } from '../components/Layout';
import { Sheet } from '../components/Sheet';
import { SignIn } from '../components/SignIn';

export function OrganizerPage() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [hosted, setHosted] = useState<MyEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    api.myEvents()
      .then(evts => setHosted(evts.filter(e => e.role === 'host')))
      .catch(e => setError(e.message));
  }, [session]);

  if (session === undefined) return <Layout><Spinner /></Layout>;
  if (session === null) {
    return <Layout><SignIn title="Organizer" /></Layout>;
  }
  if (error) return <Layout><div className="state"><ErrorNote message={error} /></div></Layout>;
  if (!hosted) return <Layout><Spinner /></Layout>;
  if (hosted.length === 0) {
    return (
      <Layout>
        <div className="state">
          <div className="state-body">
            <h1 className="title title--sm">No organizer access</h1>
            <p className="muted">{session.user.email}</p>
          </div>
          <button className="btn btn--block" onClick={() => signOut()}>Use another email</button>
        </div>
      </Layout>
    );
  }

  const selected = hosted.find(e => e.event_id === params.get('event')) ?? hosted[0];
  return (
    <Layout wide action={<button className="icon-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}><MoreIcon /></button>}>
      <OrganizerDashboard key={selected.event_id} eventId={selected.event_id} />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)}>
        {hosted.length > 1 && (
          <div className="menu-group">
            <ul className="menu">
              {hosted.map(e => (
                <li key={e.event_id}>
                  <button className="menu-item" onClick={() => { setParams({ event: e.event_id }); setMenuOpen(false); }}>
                    <span>{e.name}</span>{e.event_id === selected.event_id && <span className="faint small">Current</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="menu-group">
          <ul className="menu">
            <li><Link className="menu-item" to={`/e/${selected.event_id}`}>Event page</Link></li>
            <li><button className="menu-item" onClick={() => signOut()}><span>Sign out</span><span className="faint small">{session.user.email}</span></button></li>
          </ul>
        </div>
      </Sheet>
    </Layout>
  );
}

function OrganizerDashboard({ eventId }: { eventId: string }) {
  const [data, setData] = useState<OrganizerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    loadOrganizerData(eventId)
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message));
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  if (error && !data) return <div className="state"><ErrorNote message={error} /></div>;
  if (!data) return <Spinner />;

  const stats = computeStats(data);
  const pct = Math.min(100, (stats.attending / stats.capacity) * 100);
  const when = eventWhen(data.event.starts_at, data.event.ends_at);

  function exportCsv(kind: 'guests' | 'referrals' | 'consents') {
    if (!data) return;
    const slug = data.event.slug;
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'guests') downloadCsv(`${slug}-guests-${stamp}.csv`, toCsv(GUEST_CSV_HEADERS, guestCsvRows(data)));
    if (kind === 'referrals') downloadCsv(`${slug}-referrals-${stamp}.csv`, toCsv(REFERRAL_CSV_HEADERS, referralCsvRows(data)));
    if (kind === 'consents') downloadCsv(`${slug}-consents-${stamp}.csv`, toCsv(CONSENT_CSV_HEADERS, consentCsvRows(data)));
  }

  return (
    <>
      <header className="hero">
        <span className={data.event.rsvp_open ? 'status status--going' : 'status'}>{data.event.rsvp_open ? 'RSVPs open' : 'RSVPs closed'}</span>
        <h1 className="title title--sm">{data.event.name}</h1>
        <div className="row row--between">
          <span className="muted">{when.date}{when.time ? ` · ${when.time}` : ''}</span>
          <button className="text-btn text-btn--green" onClick={load}>Refresh</button>
        </div>
        <ErrorNote message={error} />
      </header>

      <section className="section">
        <div className="stat-hero">
          <span className="stat-hero-num">{stats.attending}</span>
          <span className="muted">of {stats.capacity} attending</span>
        </div>
        <div className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        <div className="stats" style={{ marginTop: 12 }}>
          <Stat label="Spots left" value={stats.capacity - stats.attending} />
          <Stat label="Declined" value={stats.declined} />
          <Stat label="Open links" value={stats.openInvites} />
          <Stat label="Accepted" value={stats.acceptedInvites} />
          <Stat label="Acceptance" value={`${Math.round(stats.acceptanceRate * 100)}%`} />
          <Stat label="Longest chain" value={stats.maxDepth} />
        </div>
      </section>

      <RemovalRequests data={data} onChanged={load} />

      <div className="split">
        <GrowthSection data={data} />
        <section className="section">
          <span className="label">Generations</span>
          <BarList rows={stats.byDepth.map(d => ({ label: d.depth === 0 ? 'Organizers' : `Gen ${d.depth}`, value: d.count }))} />
          {stats.topInviters.length > 0 && (
            <>
              <span className="label" style={{ marginTop: 16 }}>Top inviters</span>
              <BarList rows={stats.topInviters.map(t => ({ label: t.name, value: t.accepted }))} />
            </>
          )}
        </section>
      </div>

      <HostInvitations data={data} onChanged={load} onToast={toast.show} />
      <GuestList data={data} />

      <section className="section">
        <span className="label">Export</span>
        <div className="row row--wrap">
          <button className="btn btn--sm btn--primary" onClick={() => exportCsv('guests')}>Guests CSV</button>
          <button className="btn btn--sm" onClick={() => exportCsv('referrals')}>Referrals CSV</button>
          <button className="btn btn--sm" onClick={() => exportCsv('consents')}>Consent log CSV</button>
        </div>
      </section>

      <RsvpSwitch data={data} onChanged={load} />
      {toast.node}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div><span className="stat-num">{value}</span><span className="stat-label">{label}</span></div>;
}

function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="bars">
      {rows.map(r => (
        <li key={r.label}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="bar-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function GrowthSection({ data }: { data: OrganizerData }) {
  const points = useMemo(() => growthByDay(data.guests), [data.guests]);
  return (
    <section className="section">
      <div className="section-head">
        <span className="label">Growth</span>
        {points.length > 0 && <span className="faint small">{points[points.length - 1].total} joined</span>}
      </div>
      {points.length === 0
        ? <p className="faint">No RSVPs yet</p>
        : <BarList rows={points.slice(-14).map(p => ({ label: formatShortDate(`${p.day}T12:00:00`), value: p.added }))} />}
    </section>
  );
}

function RemovalRequests({ data, onChanged }: { data: OrganizerData; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const pending = data.removals.filter(r => r.status === 'pending');
  if (pending.length === 0) return null;
  const guests = new Map(data.guests.map(g => [g.id, g]));

  async function act(id: string, action: 'complete' | 'dismiss') {
    setError(null);
    try {
      await api.processRemoval(id, action);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="alert">
      <span className="label" style={{ color: 'var(--red)' }}>Removal requests</span>
      {pending.map(r => {
        const g = guests.get(r.guest_id);
        return (
          <div key={r.id} className="form">
            <div>
              <div style={{ fontWeight: 600 }}>{g?.full_name}</div>
              <div className="faint small">{g?.email} · {formatShortDate(r.requested_at)}</div>
              {r.note && <p className="muted small" style={{ marginTop: 6 }}>“{r.note}”</p>}
            </div>
            <div className="row">
              <ConfirmButton className="btn btn--sm btn--danger" confirmLabel="Confirm removal" onConfirm={() => act(r.id, 'complete')}>Remove data</ConfirmButton>
              <ConfirmButton className="btn btn--sm" confirmLabel="Confirm dismiss" onConfirm={() => act(r.id, 'dismiss')}>Dismiss</ConfirmButton>
            </div>
          </div>
        );
      })}
      <ErrorNote message={error} />
    </section>
  );
}

function HostInvitations({ data, onChanged, onToast }: { data: OrganizerData; onChanged: () => void; onToast: (m: string) => void }) {
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostIds = new Set(data.guests.filter(g => g.role === 'host').map(g => g.id));
  const names = new Map(data.guests.map(g => [g.id, g.full_name]));
  const mine = data.invitations.filter(i => hostIds.has(i.inviter_guest_id));
  const open = mine.filter(i => i.status === 'open').sort((a, b) => a.slot - b.slot);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.createHostInvitations(data.event.id, count);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      onToast('Link copied');
    } catch {
      window.prompt('Copy this link:', inviteUrl(token));
    }
  }

  return (
    <section className="section">
      <div className="section-head">
        <span className="label">Organizer links</span>
        <span className="faint small">{mine.length - open.length}/{mine.length} accepted</span>
      </div>
      <div className="row">
        <input type="number" min={1} max={50} value={count} onChange={e => setCount(Number(e.target.value))}
          className="input num-input" aria-label="Number of links" />
        <button className="btn btn--primary grow" onClick={create} disabled={busy || count < 1 || count > 50}>Create links</button>
      </div>
      <ErrorNote message={error} />
      {open.length > 0 && (
        <ul className="list">
          {open.map(i => (
            <li key={i.id} className="list-row">
              <span className="grow mono small faint">#{i.slot} · {names.get(i.inviter_guest_id)}</span>
              <button className="btn btn--sm" onClick={() => copy(i.token)}>Copy link</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GuestList({ data }: { data: OrganizerData }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attending' | 'declined'>('all');
  const parentOf = useMemo(() => new Map(data.referrals.map(r => [r.invitee_guest_id, r.inviter_guest_id])), [data.referrals]);
  const names = useMemo(() => new Map(data.guests.map(g => [g.id, g.full_name])), [data.guests]);
  const consent = useMemo(() => latestMarketingConsent(data.consents), [data.consents]);
  const q = query.trim().toLowerCase();
  const rows = data.guests
    .filter(g => filter === 'all' || g.rsvp_status === filter)
    .filter(g => !q || g.full_name.toLowerCase().includes(q) || (g.email ?? '').includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <section className="section">
      <div className="section-head">
        <span className="label">Guests</span>
        <span className="faint small">{rows.length}</span>
      </div>
      <div className="row">
        <input className="input grow" type="search" placeholder="Search" aria-label="Search guests" value={query} onChange={e => setQuery(e.target.value)} />
        <select className="input picker" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filter RSVP">
          <option value="all">All</option>
          <option value="attending">Going</option>
          <option value="declined">Declined</option>
        </select>
      </div>
      <ul className="list">
        {rows.slice(0, 400).map(g => {
          const parent = parentOf.get(g.id);
          return (
            <li key={g.id} className="list-row">
              <div className="grow">
                <div>
                  <span style={{ fontWeight: 600 }}>{g.full_name}</span>
                  {g.role === 'host' && <span className="tag tag--green">Organizer</span>}
                  {consent.get(g.id)?.granted && <span className="tag" title="Opted in to Pipeline updates">Opt-in</span>}
                </div>
                <div className="faint small" style={{ overflowWrap: 'anywhere' }}>{g.email ?? 'Removed'}</div>
                {parent && <div className="faint small">via {names.get(parent)} · gen {g.depth}</div>}
              </div>
              <div className="guest-meta">
                <span className={g.rsvp_status === 'attending' ? 'pill pill--green' : 'pill'}>{g.rsvp_status === 'attending' ? 'Going' : 'Declined'}</span>
                <span className="faint small">{formatShortDate(g.created_at)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RsvpSwitch({ data, onChanged }: { data: OrganizerData; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const open = data.event.rsvp_open;
  async function toggle() {
    setError(null);
    try {
      await api.setRsvpOpen(data.event.id, !open);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="section">
      {open
        ? <ConfirmButton className="btn btn--block btn--danger" confirmLabel="Tap again — unused links stop working" onConfirm={toggle}>Close RSVPs</ConfirmButton>
        : <button className="btn btn--block btn--primary" onClick={toggle}>Reopen RSVPs</button>}
      <ErrorNote message={error} />
    </section>
  );
}
