import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, inviteUrl, type AdminOverview } from '../lib/api';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { labelFor, METHODS, methodDef, type MethodKey } from '../config/experiment';
import { SignIn } from '../components/EmailAuth';
import { Tree, type TreeNode } from '../components/Tree';
import { Button, ErrorText, Loading, Screen } from '../components/ui';

// Categorical slots validated for the dark surface (dataviz palette, slots 1–3).
const METHOD_COLOR: Record<string, string> = {
  strength: '#3987e5',
  context: '#d95926',
  comfort: '#199e70',
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const secs = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);

export function AdminPage({ session }: { session: Session | null }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.adminOverview());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (!session) {
    return (
      <Screen className="center">
        <SignIn heading="Admin" sub="Sign in with an admin email." />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen className="center">
        <div className="stack text-center">
          <h1 className="title">No access</h1>
          <ErrorText error={error} />
          <p className="muted small">Signed in as {session.user.email}</p>
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </Screen>
    );
  }
  if (!data) return <Loading />;

  const t = data.totals;
  const inv = data.invitations;

  return (
    <main className="admin">
      <header className="admin-header">
        <div>
          <p className="eyebrow">The Pipeline Experiment</p>
          <h1 className="title">Dashboard</h1>
        </div>
        <div className="admin-header-actions">
          <button className="chip" onClick={load}>Refresh</button>
          <button className="chip" onClick={() => navigate('/')}>App</button>
        </div>
      </header>

      <section className="tiles">
        <Tile label="Participants" value={t.participants} sub={`${t.seed_participants} seeds`} />
        <Tile label="Verified emails" value={t.verified_emails} sub={pct(t.verified_emails, t.participants)} />
        <Tile label="Tree depth" value={t.max_depth} sub="generations" />
        <Tile label="Referral conversion" value={pct(inv.accepted, inv.generated)} sub={`${inv.accepted} of ${inv.generated} links`} />
        <Tile label="Marketing opt-in" value={t.marketing_opt_in} sub={pct(t.marketing_opt_in, t.participants)} />
        <Tile label="Feedback answers" value={t.feedback} sub={`${t.deleted} deleted accounts`} />
      </section>

      <Panel title="Invitation funnel" note="Referral links created by participants (seed links shown separately).">
        <Funnel
          steps={[
            ['Generated', inv.generated],
            ['Opened', inv.opened],
            ['Answered', inv.answered],
            ['Joined', inv.accepted],
          ]}
        />
        <p className="muted small">
          Seeds: {inv.seed_generated} generated · {inv.seed_opened} opened · {inv.seed_accepted} joined ·{' '}
          {inv.duplicate} opened by existing participants (no credit) · {inv.revoked} revoked
        </p>
      </Panel>

      <SeedPanel seeds={data.seeds} onChanged={load} />

      <Panel title="By generation">
        <Table
          head={['Gen', 'People', 'Inviters', 'Links', 'Opened', 'Joined', 'Open → join']}
          rows={data.by_depth.map((d) => [
            d.depth, d.participants, `${d.inviters} (${pct(d.inviters, d.participants)})`,
            d.links, d.opened, d.accepted, pct(d.accepted, d.opened),
          ])}
        />
      </Panel>

      <Panel
        title="Classification methods"
        note="Inbound = invitee rating the sender after opening a link. Outbound = participant rating someone before inviting them."
      >
        <Table
          head={['Method', 'People', 'Answered / opened', 'Joined / opened', 'Invited ≥1', 'Their links joined', 'Chose feedback', 'Median time in / out']}
          rows={data.methods.map((m) => [
            <MethodName key={m.method} method={m.method} />,
            m.participants,
            `${m.answered}/${m.opened} · ${pct(m.answered, m.opened)}`,
            `${m.joined}/${m.opened} · ${pct(m.joined, m.opened)}`,
            pct(m.inviters, m.participants),
            `${m.links_accepted}/${m.links} · ${pct(m.links_accepted, m.links)}`,
            m.chose_feedback,
            `${secs(m.median_ms_inbound)} / ${secs(m.median_ms_outbound)}`,
          ])}
        />
      </Panel>

      <Panel title="Relationship categories">
        <div className="dist-grid">
          {(Object.keys(METHODS) as MethodKey[]).map((m) => (
            <Distribution key={m} method={m} rows={data.distribution.filter((d) => d.method === m)} />
          ))}
        </div>
      </Panel>

      <Panel title="Reciprocal responses" note="Pairs where both the sender and the invitee classified each other.">
        <ReciprocityView r={data.reciprocity} />
      </Panel>

      <Panel title="Referral tree" note="Every participant; color = assigned method. Seeds hang from the root.">
        <AdminTree tree={data.tree} />
        <Legend />
      </Panel>

      <Panel title="Research exports" note="CSV. Only the participants file contains email addresses.">
        <div className="export-row">
          {['participants', 'invitations', 'classifications', 'reciprocal', 'feedback'].map((k) => (
            <ExportButton key={k} kind={k} />
          ))}
        </div>
      </Panel>

      <Panel title="Settings" note="Edit in Supabase → Table editor → experiment_settings. Changes apply immediately.">
        <pre className="settings">{JSON.stringify(data.settings, null, 2)}</pre>
      </Panel>
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="tile-stat">
      <span className="tile-label">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {note && <p className="muted small">{note}</p>}
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="muted small">No data yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodName({ method }: { method: string }) {
  return (
    <span className="method-name">
      <i style={{ background: METHOD_COLOR[method] }} />
      {methodDef(method).adminName}
    </span>
  );
}

function Funnel({ steps }: { steps: [string, number][] }) {
  const top = Math.max(steps[0][1], 1);
  return (
    <div className="funnel">
      {steps.map(([label, n], i) => (
        <div className="funnel-row" key={label} title={`${label}: ${n}`}>
          <span className="funnel-label">{label}</span>
          <div className="bar-track"><div className="bar" style={{ width: `${(n / top) * 100}%` }} /></div>
          <span className="funnel-value">
            {n}
            {i > 0 && <small> {pct(n, steps[i - 1][1])}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Distribution({ method, rows }: { method: MethodKey; rows: AdminOverview['distribution'] }) {
  const def = METHODS[method];
  const get = (dir: string, v: string) => rows.find((r) => r.direction === dir && r.value === v)?.n ?? 0;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="dist">
      <MethodName method={method} />
      <div className="dist-legend"><span className="sw in" />Inbound <span className="sw out" />Outbound</div>
      {def.options.map((o) => {
        const a = get('inbound', o.value);
        const b = get('outbound', o.value);
        return (
          <div className="dist-row" key={o.value}>
            <span className="dist-label">{o.label}</span>
            <div className="dist-bars">
              <div className="bar-track thin" title={`Inbound ${o.label}: ${a}`}>
                <div className="bar in" style={{ width: `${(a / max) * 100}%` }} />
              </div>
              <div className="bar-track thin" title={`Outbound ${o.label}: ${b}`}>
                <div className="bar out" style={{ width: `${(b / max) * 100}%` }} />
              </div>
            </div>
            <span className="dist-n">{a} · {b}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReciprocityView({ r }: { r: AdminOverview['reciprocity'] }) {
  return (
    <>
      <div className="tiles compact">
        <Tile label="Reciprocal pairs" value={r.pairs} />
        <Tile label="Same-method agreement" value={pct(r.same_method_exact_agreement, r.same_method_pairs)}
          sub={`${r.same_method_exact_agreement} of ${r.same_method_pairs} same-method pairs`} />
        <Tile label="Mean strength gap" value={r.mean_abs_score_gap ?? '—'} sub={`0–1 scale · ${r.scored_pairs} pairs`} />
        <Tile label="Sender − invitee" value={r.mean_out_minus_in ?? '—'} sub="> 0: senders rate ties stronger" />
      </div>
      <Table
        head={['Sender said', 'Invitee said', 'Pairs']}
        rows={r.matrix.map((m) => [
          <span key="a"><MethodName method={m.out_method} /> {labelFor(m.out_method, m.out_value)}</span>,
          <span key="b"><MethodName method={m.in_method} /> {labelFor(m.in_method, m.in_value)}</span>,
          m.n,
        ])}
      />
    </>
  );
}

function AdminTree({ tree }: { tree: AdminOverview['tree'] }) {
  const nodes = useMemo<TreeNode[]>(() => [
    { id: 'root', parent: null, kind: 'root', label: 'Seeds', info: `${tree.length} participants` },
    ...tree.map((n): TreeNode => ({
      id: n.id,
      parent: n.parent ?? 'root',
      kind: n.deleted ? 'deleted' : 'member',
      color: n.deleted ? undefined : METHOD_COLOR[n.method],
      info: `Generation ${n.depth} · ${methodDef(n.method).adminName}${n.deleted ? ' · deleted' : ''}`,
    })),
  ], [tree]);
  return <Tree nodes={nodes} height={520} />;
}

function Legend() {
  return (
    <div className="legend">
      {Object.keys(METHOD_COLOR).map((m) => <MethodName key={m} method={m} />)}
      <span className="method-name"><i className="deleted" />Deleted</span>
    </div>
  );
}

function SeedPanel({ seeds, onChanged }: { seeds: AdminOverview['seeds']; onChanged: () => void }) {
  const [count, setCount] = useState(10);
  const [sender, setSender] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!sender.trim()) return setError('Enter the name invitees will see (e.g. your first name).');
    setBusy(true);
    setError(null);
    try {
      await api.adminCreateSeeds(count, sender, note);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token)).catch(() => undefined);
    setCopied(token);
    window.setTimeout(() => setCopied(null), 1400);
  };
  const copyAll = async () => {
    const unused = seeds.filter((s) => s.status === 'created').map((s) => inviteUrl(s.token)).join('\n');
    await navigator.clipboard.writeText(unused).catch(() => undefined);
    setCopied('all');
  };

  return (
    <Panel title="Seed invitations" note="Unique single-use links you send personally. Invitees see “How do you know {name}?”.">
      <form className="seed-form" onSubmit={create}>
        <input className="input" type="number" min={1} max={50} value={count}
          onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of links" />
        <input className="input" placeholder="Your name, as invitees see it" value={sender}
          onChange={(e) => setSender(e.target.value)} aria-label="Sender name" />
        <input className="input" placeholder="Private note (optional)" value={note}
          onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <Button type="submit" busy={busy}>Generate</Button>
      </form>
      <ErrorText error={error} />
      {seeds.length > 0 && (
        <>
          <button className="link" onClick={copyAll}>{copied === 'all' ? 'Copied unused links' : 'Copy all unused links'}</button>
          <Table
            head={['Link', 'From', 'Note', 'Status', 'Branch', '']}
            rows={seeds.map((s) => [
              <button key="c" className="chip mono" onClick={() => copy(s.token)}>
                {copied === s.token ? 'Copied' : `/i/${s.token.slice(0, 8)}…`}
              </button>,
              s.sender_name ?? '—',
              s.note ?? '',
              s.status,
              s.branch_size,
              s.status === 'created' || s.status === 'opened' ? (
                <button key="r" className="chip ghost" onClick={async () => { await api.adminRevoke(s.id); onChanged(); }}>Revoke</button>
              ) : '',
            ])}
          />
        </>
      )}
    </Panel>
  );
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Quote, and neutralize spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function ExportButton({ kind }: { kind: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const rows = await api.adminExport(kind);
      const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pipeline-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="chip" onClick={run} disabled={busy}>
      {busy ? '…' : `${kind}.csv`}
    </button>
  );
}
