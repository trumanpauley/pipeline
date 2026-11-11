import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, loadOrganizerData, type OrganizerData } from '../lib/api';
import { signOut, useSession } from '../lib/auth';
import { downloadCsv, toCsv } from '../lib/csv';
import { formatEventDate, formatShortDate, inviteUrl } from '../lib/format';
import {
  CONSENT_CSV_HEADERS, GUEST_CSV_HEADERS, REFERRAL_CSV_HEADERS, computeStats, consentCsvRows,
  growthByDay, guestCsvRows, latestMarketingConsent, referralCsvRows,
} from '../lib/organizer';
import type { MyEvent } from '../lib/types';
import { ErrorNote, Layout, Spinner } from '../components/Layout';
import { SignIn } from '../components/SignIn';

export function OrganizerPage() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [hosted, setHosted] = useState<MyEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    api.myEvents()
      .then(evts => setHosted(evts.filter(e => e.role === 'host')))
      .catch(e => setError(e.message));
  }, [session]);

  if (session === undefined) return <Layout><Spinner /></Layout>;
  if (session === null) {
    return <Layout><SignIn title="Organizer sign in" intro="Sign in with your organizer email. We'll send you a code." /></Layout>;
  }
  if (error) return <Layout><div className="card"><ErrorNote message={error} /></div></Layout>;
  if (!hosted) return <Layout><Spinner /></Layout>;
  if (hosted.length === 0) {
    return (
      <Layout>
        <div className="card stack">
          <h1>No organizer access</h1>
          <p className="muted"><strong>{session.user.email}</strong> isn't an organizer for any event. Organizers are added in the Supabase SQL editor (see the README).</p>
          <button className="link" onClick={() => signOut()}>Sign out</button>
        </div>
      </Layout>
    );
  }

  const selected = hosted.find(e => e.event_id === params.get('event')) ?? hosted[0];
  return (
    <Layout wide>
      {hosted.length > 1 && (
        <select className="event-picker" value={selected.event_id} onChange={e => setParams({ event: e.target.value })}>
          {hosted.map(e => <option key={e.event_id} value={e.event_id}>{e.name}</option>)}
        </select>
      )}
      <OrganizerDashboard key={selected.event_id} eventId={selected.event_id} />
      <div className="row row--between small">
        <Link to={`/e/${selected.event_id}`}>My guest view</Link>
        <button className="link" onClick={() => signOut()}>Sign out ({session.user.email})</button>
      </div>
    </Layout>
  );
}

function OrganizerDashboard({ eventId }: { eventId: string }) {
  const [data, setData] = useState<OrganizerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    loadOrganizerData(eventId)
      .then(d => { setData(d); setRefreshedAt(new Date()); setError(null); })
      .catch(e => setError(e.message));
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  if (error && !data) return <div className="card"><ErrorNote message={error} /></div>;
  if (!data) return <Spinner />;

  const stats = computeStats(data);
  const pct = Math.min(100, Math.round((stats.attending / stats.capacity) * 100));

  function exportCsv(kind: 'guests' | 'referrals' | 'consents') {
    if (!data) return;
    const slug = data.event.slug;
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'guests') downloadCsv(`${slug}-guests-${stamp}.csv`, toCsv(GUEST_CSV_HEADERS, guestCsvRows(data)));
    if (kind === 'referrals') downloadCsv(`${slug}-referrals-${stamp}.csv`, toCsv(REFERRAL_CSV_HEADERS, referralCsvRows(data)));
    if (kind === 'consents') downloadCsv(`${slug}-consents-${stamp}.csv`, toCsv(CONSENT_CSV_HEADERS, consentCsvRows(data)));
  }

  return (
    <div className="stack stack--lg">
      <section className="hero hero--compact">
        <p className="eyebrow">Organizer</p>
        <h1 className="hero-title">{data.event.name}</h1>
        <p className="muted small">
          {formatEventDate(data.event.starts_at, data.event.ends_at)}
          {refreshedAt && <> · updated {refreshedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</>}
          {' '}<button className="link" onClick={load}>Refresh</button>
        </p>
        <ErrorNote message={error} />
      </section>

      <section className="card stack">
        <div className="section-head">
          <h2>{stats.attending} / {stats.capacity} attending</h2>
          <span className="muted small">{stats.capacity - stats.attending} spots left</span>
        </div>
        <div className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        <div className="tiles">
          <Tile label="Declined" value={stats.declined} />
          <Tile label="Open links" value={stats.openInvites} />
          <Tile label="Links accepted" value={stats.acceptedInvites} />
          <Tile label="Acceptance" value={`${Math.round(stats.acceptanceRate * 100)}%`} />
          <Tile label="Deepest chain" value={stats.maxDepth} />
          <Tile label="Removal requests" value={data.removals.filter(r => r.status === 'pending').length} />
        </div>
      </section>

      <RemovalRequests data={data} onChanged={load} />

      <div className="grid-2">
        <GrowthCard data={data} />
        <section className="card stack">
          <h2>Generations</h2>
          <p className="muted small">Guests by number of invitations away from the organizers.</p>
          <BarList rows={stats.byDepth.map(d => ({ label: d.depth === 0 ? 'Organizers' : `Gen ${d.depth}`, value: d.count }))} />
          {stats.topInviters.length > 0 && (
            <>
              <h3>Top inviters</h3>
              <BarList rows={stats.topInviters.map(t => ({ label: t.name, value: t.accepted }))} />
            </>
          )}
        </section>
      </div>

      <HostInvitations data={data} onChanged={load} />
      <GuestTable data={data} />

      <section className="card stack">
        <h2>Export</h2>
        <p className="muted small">CSV files include emails — store them carefully. The referral file is the edge list for visualising the network later.</p>
        <div className="row row--wrap">
          <button className="btn btn--primary" onClick={() => exportCsv('guests')}>Guests CSV</button>
          <button className="btn" onClick={() => exportCsv('referrals')}>Referrals CSV</button>
          <button className="btn" onClick={() => exportCsv('consents')}>Consent log CSV</button>
        </div>
      </section>

      <RsvpSwitch data={data} onChanged={load} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return <div className="tile"><span className="tile-value">{value}</span><span className="tile-label">{label}</span></div>;
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

function GrowthCard({ data }: { data: OrganizerData }) {
  const points = useMemo(() => growthByDay(data.guests), [data.guests]);
  return (
    <section className="card stack">
      <h2>Invitation growth</h2>
      {points.length === 0 ? (
        <p className="muted">No RSVPs yet. Share your first links below.</p>
      ) : (
        <BarList rows={points.slice(-14).map(p => ({ label: formatShortDate(`${p.day}T12:00:00`), value: p.added }))} />
      )}
      {points.length > 0 && <p className="muted small">{points[points.length - 1].total} guests have joined through invitations.</p>}
    </section>
  );
}

function RemovalRequests({ data, onChanged }: { data: OrganizerData; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const pending = data.removals.filter(r => r.status === 'pending');
  if (pending.length === 0) return null;
  const names = new Map(data.guests.map(g => [g.id, g]));

  async function act(id: string, action: 'complete' | 'dismiss') {
    const msg = action === 'complete'
      ? "Remove this guest's name and email? Their anonymous node and invitation history are kept. This can't be undone."
      : 'Dismiss this request without removing data?';
    if (!confirm(msg)) return;
    try {
      await api.processRemoval(id, action);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card stack card--alert">
      <h2>Removal requests</h2>
      {pending.map(r => {
        const g = names.get(r.guest_id);
        return (
          <div key={r.id} className="stack stack--sm request">
            <div><strong>{g?.full_name}</strong> <span className="muted small">{g?.email} · {formatShortDate(r.requested_at)}</span></div>
            {r.note && <p className="small">“{r.note}”</p>}
            <div className="row">
              <button className="btn btn--danger" onClick={() => act(r.id, 'complete')}>Remove data</button>
              <button className="btn" onClick={() => act(r.id, 'dismiss')}>Dismiss</button>
            </div>
          </div>
        );
      })}
      <ErrorNote message={error} />
    </section>
  );
}

function HostInvitations({ data, onChanged }: { data: OrganizerData; onChanged: () => void }) {
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
    await navigator.clipboard.writeText(inviteUrl(token)).catch(() => window.prompt('Copy this link:', inviteUrl(token)));
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="card stack">
      <div className="section-head">
        <h2>Organizer invitations</h2>
        <span className="muted small">{mine.length - open.length} of {mine.length} accepted</span>
      </div>
      <p className="muted small">These start new branches of the network. Each link works once; organizers have no two-link limit.</p>
      <div className="row">
        <input type="number" min={1} max={50} value={count} onChange={e => setCount(Number(e.target.value))} className="num" aria-label="Number of links" />
        <button className="btn btn--primary" onClick={create} disabled={busy || count < 1 || count > 50}>Create links</button>
      </div>
      <ErrorNote message={error} />
      {open.length > 0 && (
        <ul className="list">
          {open.map(i => (
            <li key={i.id} className="row row--between invite-row">
              <span className="mono small">#{i.slot} · {names.get(i.inviter_guest_id)}</span>
              <button className="btn btn--sm" onClick={() => copy(i.token)}>{copied === i.token ? 'Copied' : 'Copy link'}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GuestTable({ data }: { data: OrganizerData }) {
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
    <section className="card stack">
      <div className="section-head">
        <h2>Guests</h2>
        <span className="muted small">{rows.length} shown</span>
      </div>
      <div className="row">
        <input className="grow" type="search" placeholder="Search name or email" value={query} onChange={e => setQuery(e.target.value)} />
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filter RSVP">
          <option value="all">All</option>
          <option value="attending">Attending</option>
          <option value="declined">Declined</option>
        </select>
      </div>
      <ul className="guest-list">
        {rows.slice(0, 400).map(g => {
          const parent = parentOf.get(g.id);
          return (
            <li key={g.id} className="guest-row">
              <div className="grow">
                <div>
                  <strong>{g.full_name}</strong>
                  {g.role === 'host' && <span className="tag">Organizer</span>}
                  {consent.get(g.id)?.granted && <span className="tag tag--soft" title="Opted in to Pipeline updates">Opt-in</span>}
                </div>
                <div className="muted small">{g.email ?? 'removed'}</div>
                {parent && <div className="muted small">via {names.get(parent)} · gen {g.depth}</div>}
              </div>
              <div className="guest-meta">
                <span className={g.rsvp_status === 'attending' ? 'pill pill--ok' : 'pill'}>{g.rsvp_status}</span>
                <span className="muted small">{formatShortDate(g.created_at)}</span>
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
    if (!confirm(open ? 'Close RSVPs? Unused links will stop working until you reopen.' : 'Reopen RSVPs?')) return;
    try {
      await api.setRsvpOpen(data.event.id, !open);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card stack">
      <h2>RSVPs are {open ? 'open' : 'closed'}</h2>
      <button className={open ? 'btn btn--danger' : 'btn btn--primary'} onClick={toggle}>{open ? 'Close RSVPs' : 'Reopen RSVPs'}</button>
      <ErrorNote message={error} />
    </section>
  );
}
