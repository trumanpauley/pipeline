import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { adminErrorText, api, inviteUrl, shareText, type AbcState, type AdminAbcStats, type AdminAccountStats, type AdminCommunityStats, type AdminMethodStats, type AdminFeedbackList, type AdminLaunchAnalytics, type AdminOverview, type AdminWaitlistOverview, type Ratio, REFERRAL_KIND_LABEL, type Experiment, type ExperimentDetail, type ExperimentInfo } from '../lib/api';
import { AbcFlow } from '../components/Abc';
import { CLOSENESS_LABELS, COMFORT_QUESTION, ClosenessMeter, PRIVATE_NOTE, ScaleQuestion } from '../components/Relationship';
import { JoinForm } from '../components/JoinForm';
import { LandingIntro } from '../components/LandingIntro';
import { Classifier } from '../components/Classifier';
import { supabase } from '../lib/supabase';
import { appUrl, navigate } from '../lib/router';
import { slugify, slugProblem, suggestsSponsorship } from '../lib/sharing';
import { uploadPreviewImage } from '../lib/previewImage';
import { InvitationPreview } from '../components/InvitationPreview';
import { COPY, labelFor, METHODS, methodDef, type MethodKey } from '../config/experiment';
import { SignIn } from '../components/EmailAuth';
import { ModerationPanel } from '../components/ModerationPanel';
import { Tree, type TreeNode } from '../components/Tree';
import { Button, ErrorText, Loading, Screen } from '../components/ui';
import { DemoLinks } from './HomePage';

// Categorical slots validated for the dark surface (dataviz palette, slots 1–3).
const METHOD_COLOR: Record<string, string> = {
  strength: '#3987e5',
  context: '#d95926',
  comfort: '#199e70',
  circular: '#c98500',
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const secs = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);

export function AdminPage({ session }: { session: Session | null }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [acct, setAcct] = useState<AdminAccountStats | null>(null);
  const [mstats, setMstats] = useState<AdminMethodStats | null>(null);
  const [cstats, setCstats] = useState<AdminCommunityStats | null>(null);
  const [wstats, setWstats] = useState<AdminWaitlistOverview | null>(null);
  const [version, setVersion] = useState(0); // bumps on every refresh so sub-panels reload too
  const [error, setError] = useState<string | null>(null);
  // Tabs: the overview, then one per experiment (remembered on this device).
  const [groups, setGroups] = useState<Experiment[]>([]);
  const [tab, setTabState] = useState<string>(() => {
    try { return localStorage.getItem('px.adminTab') || 'overview'; } catch { return 'overview'; }
  });
  const setTab = (t: string) => {
    setTabState(t);
    try { localStorage.setItem('px.adminTab', t); } catch { /* ignore */ }
    window.scrollTo(0, 0);
  };

  const load = useCallback(async () => {
    try {
      const [o, a, m, c, g, w] = await Promise.all([
        api.adminOverview(),
        api.adminAccountStats(),
        api.adminMethodStats().catch(() => null),
        api.adminCommunityStats().catch(() => null),
        api.adminExperiments().catch(() => [] as Experiment[]),
        api.adminWaitlistOverview().catch(() => null),
      ]);
      setGroups(g);
      setData(o);
      setAcct(a);
      setMstats(m);
      setCstats(c);
      setWstats(w);
      setVersion((n) => n + 1);
      setError(null);
    } catch (e) {
      setError(adminErrorText(e));
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  // Admin screens always use the real name.
  useEffect(() => {
    document.title = 'Pipeline · Admin';
  }, []);

  if (!session) {
    return (
      <Screen className="center">
        <SignIn heading="Admin" sub="Sign in with an admin email. With a password, no email is sent." allowPhone={false} allowPassword />
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
  const group = groups.find((g) => g.id === tab) ?? null;
  const special = tab === 'waitlist' || tab === 'feedback';
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

      <nav className="admin-tabs" role="tablist" aria-label="Dashboard sections">
        <button role="tab" aria-selected={!group && !special} className={`chip ${!group && !special ? 'is-active' : ''}`} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button role="tab" aria-selected={tab === 'waitlist'} className={`chip ${tab === 'waitlist' ? 'is-active' : ''}`} onClick={() => setTab('waitlist')}>
          Waitlist
        </button>
        <button role="tab" aria-selected={tab === 'feedback'} className={`chip ${tab === 'feedback' ? 'is-active' : ''}`} onClick={() => setTab('feedback')}>
          Feedback
        </button>
        {groups.map((g) => (
          <button key={g.id} role="tab" aria-selected={group?.id === g.id} className={`chip ${group?.id === g.id ? 'is-active' : ''}`} onClick={() => setTab(g.id)}>
            {g.name}{g.is_test ? ' · test' : ''}
          </button>
        ))}
      </nav>

      {tab === 'waitlist' ? (
        <>
          <WaitlistPanel stats={wstats} />
          {cstats && <CommunityPanel stats={cstats} />}
        </>
      ) : tab === 'feedback' ? (
        <FeedbackPanel groups={groups} refreshKey={version} />
      ) : group ? (
        <>
          <LaunchPanel experimentId={group.id} refreshKey={version} waitlistTotal={null} />
          <ExperimentsPanel refreshKey={version} only={group.id} onChanged={load} />
          <AbcPanel refreshKey={version} fixedExperiment={group.id} />
          <AbcPreviewPanel experimentId={group.id} />
          <DemoLinks />
        </>
      ) : (
      <>

      <section className="tiles">
        <Tile label="Participants" value={t.participants} sub={`${t.seed_participants} seeds`} />
        <Tile
          label="Saved networks"
          value={(acct?.linked_emails ?? t.verified_emails) + (acct?.linked_phones ?? 0)}
          sub={`${acct?.linked_emails ?? 0} email · ${acct?.linked_phones ?? 0} phone · ${acct?.anonymous ?? 0} anonymous`}
        />
        <Tile label="Tree depth" value={t.max_depth} sub="generations" />
        <Tile label="Referral conversion" value={pct(inv.accepted, inv.generated)} sub={`${inv.accepted} of ${inv.generated} links`} />
        <Tile label="Early access" value={cstats?.total ?? 0} sub={`${pct(cstats?.total ?? 0, cstats?.participants ?? 0)} of participants`} />
        <Tile label="Same-network joins" value={acct?.flagged_same_network ?? 0} sub="flagged for review" />
        <Tile label="Feedback answers" value={t.feedback} sub={`${t.deleted} deleted accounts`} />
      </section>

      <LaunchPanel experimentId={null} refreshKey={version} waitlistTotal={wstats?.unique_total ?? null} />

      <Panel
        title="Invitation funnel"
        note="Referral links created by participants (seed links shown separately). Shared = the participant tapped Share or Copy; that's intent, not proof the link was received."
      >
        <Funnel
          steps={[
            ['Generated', inv.generated],
            ['Shared', acct?.shared ?? 0],
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

      <ExperimentsPanel refreshKey={version} onChanged={load} />

      <Panel
        title="Names & moderation"
        note="Names are checked automatically for profanity, slurs, explicit terms, links and spam. Review them here; every action is logged."
      >
        <ModerationPanel refreshKey={version} />
      </Panel>

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
          {(Object.keys(METHODS) as MethodKey[]).filter((m) => m !== 'circular').map((m) => (
            <Distribution key={m} method={m} rows={data.distribution.filter((d) => d.method === m)} />
          ))}
        </div>
      </Panel>

      {mstats && <MethodStatsPanel stats={mstats} />}

      <Panel title="Reciprocal responses" note="Pairs where both the sender and the invitee classified each other.">
        <ReciprocityView r={data.reciprocity} />
      </Panel>

      <Panel title="Referral tree" note="Every participant; color = assigned method. Seeds hang from the root.">
        <AdminTree tree={data.tree} />
        <Legend />
      </Panel>

      <AbcPanel refreshKey={version} />
      <AbcPreviewPanel />

      <WaitlistPanel stats={wstats} />

      {cstats && <CommunityPanel stats={cstats} />}

      <Panel title="Research exports" note="CSV. Only the participants, waitlist and community files contain email addresses.">
        <div className="export-row">
          {['experiments', 'participants', 'invitations', 'connections', 'classifications', 'classification_events', 'reciprocal', 'feedback', 'waitlist'].map((k) => (
            <ExportButton key={k} kind={k} />
          ))}
        </div>
      </Panel>

      <DemoLinks />

      <Panel title="Settings" note="Edit in Supabase → Table editor → experiment_settings. Changes apply immediately.">
        <pre className="settings">
          {JSON.stringify(Object.fromEntries(Object.entries(data.settings).filter(([k]) => k !== 'hash_salt')), null, 2)}
        </pre>
      </Panel>
      </>
      )}
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

function AdminTree({ tree, height = 520 }: { tree: (AdminOverview['tree'][number] & { category?: string | null })[]; height?: number }) {
  const nodes = useMemo<TreeNode[]>(() => [
    { id: 'root', parent: null, kind: 'root', label: 'Seeds', info: `${tree.length} participants` },
    ...tree.map((n): TreeNode => ({
      id: n.id,
      parent: n.parent ?? 'root',
      kind: n.deleted ? 'deleted' : 'member',
      color: n.deleted ? undefined : METHOD_COLOR[n.method],
      info: `Generation ${n.depth} · ${methodDef(n.method).adminName}${n.category ? ` · ${n.category}` : ''}${n.deleted ? ' · deleted' : ''}`,
    })),
  ], [tree]);
  return <Tree nodes={nodes} height={height} />;
}

function Legend() {
  return (
    <div className="legend">
      {Object.keys(METHOD_COLOR).map((m) => <MethodName key={m} method={m} />)}
      <span className="method-name"><i className="deleted" />Deleted</span>
    </div>
  );
}

function SeedPanel({ experimentId, slug, inviteMessage, seeds, onChanged }: {
  experimentId: string;
  slug: string | null;
  /** The experiment's initial invitation message, sent with seed links. */
  inviteMessage: string | null;
  seeds: ExperimentDetail['seeds'];
  onChanged: () => void;
}) {
  const [count, setCount] = useState(10);
  const [sender, setSender] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'personal' | 'broadcast'>('personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (kind === 'personal' && !sender.trim()) return setError('Enter the name invitees will see (e.g. your first name).');
    setBusy(true);
    setError(null);
    try {
      try {
        await api.adminCreateSeedsV2(experimentId, count, sender, note, kind);
      } catch (err) {
        // Before migration 018 only personal seeds exist.
        if (!/could not find the function|admin_create_experiment_seeds_v2/i.test((err as Error).message)) throw err;
        if (kind === 'broadcast') throw new Error('Run migration 018 in the Supabase SQL Editor to create broadcast links.');
        await api.adminCreateExperimentSeeds(experimentId, count, sender, note);
      }
      onChanged();
    } catch (err) {
      setError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token, slug)).catch(() => undefined);
    setCopied(token);
    window.setTimeout(() => setCopied(null), 1400);
  };
  const copyAll = async () => {
    const unused = seeds.filter((s) => s.status === 'created').map((s) => inviteUrl(s.token, slug)).join('\n');
    await navigator.clipboard.writeText(unused).catch(() => undefined);
    setCopied('all');
  };
  // The initial invitation message plus this seed's link: the share sheet on a
  // phone (you choose the app and send it yourself), copied elsewhere.
  const sendMessage = async (token: string) => {
    const url = inviteUrl(token, slug);
    const message = inviteMessage?.trim() || COPY.shareText;
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ text: message, url }); } catch { /* cancelled */ }
      return;
    }
    await navigator.clipboard.writeText(shareText(message, url)).catch(() => undefined);
    setCopied(`m:${token}`);
    window.setTimeout(() => setCopied(null), 1400);
  };

  return (
    <div className="seed-panel">
      <h3>Seed links</h3>
      <p className="muted small">
        Unique single-use links. <strong>Personal</strong>: a founder hands it to someone they know; the invitee sees your name.
        {' '}<strong>Broadcast</strong>: posted to a group chat or list; no name is shown and no personal relationship is recorded.
        The label is internal and never shown to participants.
      </p>
      <form className="seed-form" onSubmit={create}>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'personal' | 'broadcast')} aria-label="Seed type">
          <option value="personal">Personal seed</option>
          <option value="broadcast">Broadcast seed</option>
        </select>
        <input className="input" type="number" min={1} max={50} value={count}
          onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of links" />
        {kind === 'personal' && (
          <input className="input" placeholder="Your name, as invitees see it" value={sender}
            onChange={(e) => setSender(e.target.value)} aria-label="Sender name" />
        )}
        <input className="input" placeholder={kind === 'personal' ? 'Label, e.g. Founder 1 — Current players' : 'Label, e.g. Harvard Baseball group chat'} value={note}
          onChange={(e) => setNote(e.target.value)} aria-label="Note" maxLength={80} />
        <Button type="submit" busy={busy}>Generate</Button>
      </form>
      <ErrorText error={error} />
      {seeds.length > 0 && (
        <>
          <button className="link" onClick={copyAll}>{copied === 'all' ? 'Copied unused links' : 'Copy all unused links'}</button>
          <Table
            head={['Link', 'Message', 'Type', 'From', 'Label', 'Status', 'Branch', '']}
            rows={seeds.map((s) => [
              <button key="c" className="chip mono" onClick={() => copy(s.token)}>
                {copied === s.token ? 'Copied' : `/${slug ?? 'join'}/${s.token.slice(0, 8)}…`}
              </button>,
              s.status === 'created' || s.status === 'opened' ? (
                <button key="m" className="chip" onClick={() => sendMessage(s.token)} aria-label={`Share the invitation message with link ${s.token.slice(0, 8)}`}>
                  {copied === `m:${s.token}` ? 'Copied' : 'Share message'}
                </button>
              ) : '',
              s.kind === 'seed_broadcast' ? 'Broadcast' : 'Personal',
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
    </div>
  );
}

const fmtDuration = (sec: number | null) => {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} d`;
};

type ExperimentDraft = {
  id: string | null;
  name: string;
  description: string;
  invite_instruction: string;
  invites_per_participant: number;
  categories: string;
  status: 'active' | 'paused';
  // Onboarding (shown on the join screen)
  ask_relationship_question: boolean;
  welcome_message: string;
  eligibility_enabled: boolean;
  eligibility_question: string;
  eligible_label: string;
  ineligible_label: string;
  ineligible_message: string;
  // Invitation settings (link name, preview, messages)
  slug: string;
  public_title: string;
  preview_description: string;
  preview_image_url: string;
  invite_message: string;
  forward_message: string;
  affiliation_authorized: boolean;
  // Community & completion (migration 018)
  community_name: string;
  completion_message: string;
  allow_additional_invites: boolean;
  enable_feedback: boolean;
  enable_waitlist: boolean;
};

const draftOf = (e?: Experiment): ExperimentDraft => ({
  id: e?.id ?? null,
  name: e?.name ?? '',
  description: e?.description ?? '',
  invite_instruction: e?.invite_instruction ?? '',
  invites_per_participant: e?.invites_per_participant ?? 2,
  categories: e ? e.categories.join(', ') : 'Current Harvard student, Harvard alumnus/alumna',
  status: e?.status ?? 'active',
  ask_relationship_question: e?.ask_relationship_question ?? true,
  welcome_message: e?.welcome_message ?? '',
  eligibility_enabled: e?.eligibility_enabled ?? false,
  eligibility_question: e?.eligibility_question ?? '',
  eligible_label: e?.eligible_label ?? 'Yes',
  ineligible_label: e?.ineligible_label ?? 'No',
  ineligible_message: e?.ineligible_message ?? '',
  slug: e?.slug ?? '',
  public_title: e?.public_title ?? '',
  preview_description: e?.preview_description ?? '',
  preview_image_url: e?.preview_image_url ?? '',
  invite_message: e?.invite_message ?? '',
  forward_message: e?.forward_message ?? '',
  affiliation_authorized: e?.affiliation_authorized ?? false,
  community_name: e?.community_name ?? '',
  completion_message: e?.completion_message ?? '',
  allow_additional_invites: e?.allow_additional_invites ?? false,
  enable_feedback: e?.enable_feedback ?? false,
  enable_waitlist: e?.enable_waitlist ?? true,
});

/** Fired after an experiment's settings are saved, so other panels (the simulator) reload them. */
const EXPERIMENTS_CHANGED = 'px:experiments-changed';

const saveDraft = async (d: ExperimentDraft) => {
  try {
    return await saveDraftSteps(d);
  } finally {
    window.dispatchEvent(new Event(EXPERIMENTS_CHANGED));
  }
};

const saveDraftSteps = async (d: ExperimentDraft) => {
  const saved = await api.adminSaveExperiment({
    ...d,
    invites_per_participant: Number(d.invites_per_participant),
    categories: d.categories.split(',').map((c) => c.trim()).filter(Boolean),
  });
  await api.adminSaveExperimentOnboarding(saved.id, d);
  try {
    await api.adminSetRelationshipQuestion(saved.id, d.ask_relationship_question);
  } catch (err) {
    // The rest is saved; this one setting needs migration 015.
    if (/could not find the function|admin_set_relationship_question/i.test((err as Error).message)) {
      throw new Error('Saved, except “Where do you know them from?”: run migration 015 in the Supabase SQL Editor first, then save again.');
    }
    throw err;
  }
  try {
    await api.adminSaveExperimentSharing(saved.id, d);
  } catch (err) {
    if (/could not find the function|admin_save_experiment_sharing/i.test((err as Error).message)) {
      throw new Error('Saved, except the invitation settings: run migration 016 in the Supabase SQL Editor first, then save again.');
    }
    throw err;
  }
  try {
    await api.adminSaveExperimentLaunch(saved.id, d);
  } catch (err) {
    if (/could not find the function|admin_save_experiment_launch/i.test((err as Error).message)) {
      throw new Error('Saved, except the community and completion settings: run migration 018 in the Supabase SQL Editor first, then save again.');
    }
    throw err;
  }
  return saved;
};

/**
 * Experiments: create and edit them, pause/resume, make seed links, and see
 * each one's numbers and referral tree. Everything is read from Supabase via
 * admin-only functions (the server checks the admin on every call).
 */
function ExperimentsPanel({ refreshKey, only, onChanged }: { refreshKey: number; only?: string; onChanged?: () => void }) {
  const [all, setList] = useState<Experiment[] | null>(null);
  const list = only ? all?.filter((e) => e.id === only) ?? null : all;
  const [editing, setEditing] = useState<ExperimentDraft | null>(null);
  // A group's own tab opens its seed links and tree straight away.
  const [open, setOpen] = useState<string | null>(only ?? null);
  useEffect(() => { if (only) setOpen(only); }, [only]);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      setList(await api.adminExperiments());
    } catch (e) {
      setError(adminErrorText(e));
    }
  }, []);
  // After a change: refresh this list, and let the page refresh its tabs.
  const reload = useCallback(async () => {
    await fetchList();
    onChanged?.();
  }, [fetchList, onChanged]);
  useEffect(() => { void fetchList(); }, [fetchList, refreshKey]);

  const toggleStatus = async (e: Experiment) => {
    setError(null);
    try {
      await saveDraft({ ...draftOf(e), status: e.status === 'active' ? 'paused' : 'active' });
      await reload();
    } catch (err) {
      setError(adminErrorText(err));
    }
  };

  return (
    <Panel
      title={only ? (list?.[0]?.name ?? 'Experiment') : 'Experiments'}
      note={only
        ? 'This group’s settings, seed links, numbers and referral tree. Links always open this group, and pausing keeps all data.'
        : 'Each experiment has its own seed links, invitation rules and network. A link always opens the experiment it was made for, and pausing keeps all data. Each one also has its own tab above.'}
    >
      {!only && (
        <div className="row-actions">
          <button className="chip" onClick={() => setEditing(draftOf())}>New experiment</button>
        </div>
      )}
      {editing && !editing.id && (
        <ExperimentForm draft={editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      )}
      <ErrorText error={error} />
      {!list && <p className="muted small">Loading…</p>}
      <div className="experiments">
        {list?.map((e) => (
          <article key={e.id} className="experiment-card" data-experiment={e.name}>
            <header className="experiment-card-head">
              <div>
                <h3>{e.name}</h3>
                <span className={`pill tone-${e.status === 'active' ? 'done' : 'idle'}`}><i />{e.status === 'active' ? 'Active' : 'Paused'}</span>
                {e.is_default && <span className="muted small"> · original experiment</span>}
                {e.is_test && <span className="muted small"> · test (left out of ABC analytics)</span>}
              </div>
              <div className="row-actions">
                <button className="chip" onClick={() => setEditing(draftOf(e))}>Edit</button>
                <button className="chip" onClick={() => void toggleStatus(e)}>{e.status === 'active' ? 'Pause' : 'Resume'}</button>
                <button
                  className="chip"
                  title="Test experiments are for trying the full flow on a phone; their data stays out of the ABC analytics."
                  onClick={async () => { await api.adminSetExperimentTest(e.id, !e.is_test).catch((err: Error) => setError(adminErrorText(err))); await reload(); }}
                >
                  {e.is_test ? 'Use as real' : 'Mark as test'}
                </button>
                <button className="chip" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                  {open === e.id ? 'Hide links & tree' : 'Seed links & tree'}
                </button>
              </div>
            </header>
            {editing?.id === e.id ? (
              <ExperimentForm draft={editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
            ) : (
              <dl className="experiment-meta">
                {e.description && (<><dt>Group</dt><dd>{e.description}</dd></>)}
                <dt>Instruction</dt><dd>{e.invite_instruction || <span className="muted">Default (“Invite two people…”)</span>}</dd>
                <dt>Invites each</dt><dd>{e.invites_per_participant}</dd>
                <dt>Link</dt><dd>{e.slug
                  ? <><span className="mono">{appUrl(`/${e.slug}`).replace(/^https?:\/\//, '')}</span>{e.public_title ? <span className="muted"> · “{e.public_title}”</span> : null}</>
                  : <span className="muted">/join/… (no link name)</span>}</dd>
                <dt>Relationship question</dt><dd>{e.ask_relationship_question === false
                  ? <span className="muted">Not asked (everyone knows each other the same way)</span>
                  : 'Asked (“Where do you know them from?” or its variant)'}</dd>
                <dt>Eligibility</dt><dd>{e.eligibility_enabled && e.eligibility_question
                  ? <>{e.eligibility_question} <span className="muted">({e.eligible_label} continues · {e.ineligible_label} stops)</span></>
                  : <span className="muted">Not asked</span>}</dd>
                <dt>Participant types</dt><dd>{e.categories.length ? e.categories.join(' · ') : <span className="muted">Not asked</span>}</dd>
              </dl>
            )}
            <div className="tiles compact">
              <Tile label="Participants" value={e.stats.participants} sub={`${e.stats.people} people`} />
              <Tile label="Links created" value={e.stats.links_created} sub={`${e.stats.seed_links} seed`} />
              <Tile label="Opened" value={e.stats.opened} sub={pct(e.stats.opened, e.stats.links_created)} />
              <Tile label="Accepted" value={e.stats.accepted} sub={`${pct(e.stats.accepted, e.stats.opened)} of opened${e.stats.secondary_connections ? ` · +${e.stats.secondary_connections} repeat` : ''}`} />
              <Tile label="Median response" value={fmtDuration(e.stats.median_response_s)} sub={`open → join · ${fmtDuration(e.stats.median_link_to_join_s)} from link`} />
              <Tile label="Max depth" value={e.stats.max_depth} sub="generations" />
            </div>
            {Object.keys(e.stats.categories).length > 0 && (
              <p className="category-split small" aria-label="Participants by category">
                {Object.entries(e.stats.categories).map(([k, n]) => (
                  <span key={k}><strong>{n}</strong> {k}</span>
                ))}
              </p>
            )}
            {open === e.id && <ExperimentDetailView experimentId={e.id} slug={e.slug ?? null} inviteMessage={e.invite_message ?? null} onChanged={reload} />}
          </article>
        ))}
      </div>
    </Panel>
  );
}

function ExperimentForm({ draft, onCancel, onSaved }: { draft: ExperimentDraft; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ExperimentDraft>(k: K, v: ExperimentDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveDraft(d);
      onSaved();
    } catch (err) {
      setError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="experiment-form" onSubmit={submit} aria-label={d.id ? 'Edit experiment' : 'New experiment'}>
      <label>Name<input className="input" value={d.name} maxLength={80} placeholder="Harvard Baseball" onChange={(e) => set('name', e.target.value)} aria-label="Experiment name" /></label>
      <label>Group description<textarea className="input" rows={2} value={d.description} maxLength={600} placeholder="Current and former Harvard Baseball players." onChange={(e) => set('description', e.target.value)} aria-label="Group description" /></label>
      <label>Invitation instruction<input className="input" value={d.invite_instruction} maxLength={200} placeholder="Invite two Harvard Baseball players, current or alumni." onChange={(e) => set('invite_instruction', e.target.value)} aria-label="Invitation instruction" /></label>
      <div className="experiment-form-row">
        <label>Invites per participant<input className="input" type="number" min={1} max={10} value={d.invites_per_participant} onChange={(e) => set('invites_per_participant', Number(e.target.value))} aria-label="Invites per participant" /></label>
        <label>Status
          <select className="input" value={d.status} onChange={(e) => set('status', e.target.value as 'active' | 'paused')} aria-label="Status">
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </label>
      </div>
      <label>Participant types <span className="muted">(comma-separated, e.g. “Current player, Former player / alumnus”; leave empty to not ask)</span>
        <input className="input" value={d.categories} placeholder="Current player, Former player / alumnus" onChange={(e) => set('categories', e.target.value)} aria-label="Participant categories" />
      </label>
      <fieldset className="experiment-onboarding">
        <legend>Relationship question</legend>
        <label className="preview-check">
          <input type="checkbox" checked={d.ask_relationship_question} onChange={(e) => set('ask_relationship_question', e.target.checked)} aria-label="Ask where they know each other from" />
          Ask “Where do you know them from?” first
        </label>
        <p className="muted small">
          {d.ask_relationship_question
            ? 'Invitees answer it right after opening their link, and inviters answer it when they create a link.'
            : 'Skipped: invitees go straight to “How close are you to …?”, and inviters get their link right after typing the name. Good for one team or chapter, where everyone knows each other the same way.'}
        </p>
      </fieldset>
      <fieldset className="experiment-onboarding">
        <legend>Join screen</legend>
        <label className="preview-check">
          <input type="checkbox" checked={d.eligibility_enabled} onChange={(e) => set('eligibility_enabled', e.target.checked)} aria-label="Ask an eligibility question" />
          Ask an eligibility question first
        </label>
        {d.eligibility_enabled && (
          <>
            <label>Eligibility question
              <input className="input" value={d.eligibility_question} maxLength={160} placeholder="Have you played for Harvard Baseball?"
                onChange={(e) => set('eligibility_question', e.target.value)} aria-label="Eligibility question" />
            </label>
            <div className="experiment-form-row">
              <label>Answer that continues
                <input className="input" value={d.eligible_label} maxLength={40} onChange={(e) => set('eligible_label', e.target.value)} aria-label="Eligible answer" />
              </label>
              <label>Answer that stops
                <input className="input" value={d.ineligible_label} maxLength={40} onChange={(e) => set('ineligible_label', e.target.value)} aria-label="Ineligible answer" />
              </label>
            </div>
            <label>Message for people who can’t take part
              <textarea className="input" rows={2} value={d.ineligible_message} maxLength={300}
                placeholder="This experiment is currently for Harvard Baseball players and alumni. Thanks for your interest."
                onChange={(e) => set('ineligible_message', e.target.value)} aria-label="Ineligible message" />
            </label>
          </>
        )}
      </fieldset>
      <InvitationSettings d={d} set={set} />
      <fieldset className="experiment-onboarding">
        <legend>Community &amp; completion</legend>
        <label>Community name <span className="muted">(used in the thank-you and the experiment’s wording)</span>
          <input className="input" value={d.community_name} maxLength={60} placeholder="Harvard Baseball"
            onChange={(e) => set('community_name', e.target.value)} aria-label="Community name" />
        </label>
        <label>Introductory message <span className="muted">(shown on the invitation page)</span>
          <textarea className="input" rows={2} value={d.welcome_message} maxLength={240}
            placeholder="Current and former Harvard Baseball players are exploring the strength and reach of their network."
            onChange={(e) => set('welcome_message', e.target.value)} aria-label="Introductory message" />
        </label>
        <label>Completion thank-you message <span className="muted">(empty = “Thank you for helping us better understand the {d.community_name.trim() || 'community'} network.”)</span>
          <textarea className="input" rows={2} value={d.completion_message} maxLength={300}
            onChange={(e) => set('completion_message', e.target.value)} aria-label="Completion thank-you message" />
        </label>
        <label className="preview-check">
          <input type="checkbox" checked={d.allow_additional_invites} onChange={(e) => set('allow_additional_invites', e.target.checked)} aria-label="Allow additional invitations after completion" />
          Allow additional invitations after completion <span className="muted">(“Invite someone else”, one person at a time)</span>
        </label>
        <label className="preview-check">
          <input type="checkbox" checked={d.enable_feedback} onChange={(e) => set('enable_feedback', e.target.checked)} aria-label="Enable optional feedback" />
          Enable optional feedback
        </label>
        <label className="preview-check">
          <input type="checkbox" checked={d.enable_waitlist} onChange={(e) => set('enable_waitlist', e.target.checked)} aria-label="Enable optional waitlist signup" />
          Enable optional waitlist signup
        </label>
        <p className="muted small">Connection-strength and the ABC questions have their own setting (“ABC experiment” below); the standard two invitations are unchanged by any of these.</p>
      </fieldset>
      <ErrorText error={error} />
      <div className="row-actions">
        <Button type="submit" busy={busy}>{d.id ? 'Save changes' : 'Create experiment'}</Button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ExperimentDetailView({ experimentId, slug, inviteMessage, onChanged }: {
  experimentId: string;
  slug: string | null;
  inviteMessage: string | null;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setDetail(await api.adminExperimentDetail(experimentId));
    } catch (e) {
      setError(adminErrorText(e));
    }
  }, [experimentId]);
  useEffect(() => { void reload(); }, [reload]);

  if (error) return <ErrorText error={error} />;
  if (!detail) return <p className="muted small">Loading…</p>;
  return (
    <div className="experiment-detail">
      <SeedPanel experimentId={experimentId} slug={slug} inviteMessage={inviteMessage} seeds={detail.seeds} onChanged={() => { void reload(); onChanged(); }} />
      <div>
        <h3>Referral tree</h3>
        <p className="muted small">
          Each person’s primary referral. {detail.secondary.length
            ? `${detail.secondary.length} further invitation${detail.secondary.length === 1 ? '' : 's'} to people already in are kept as extra connections (connections.csv).`
            : 'Further invitations to people already in are kept as extra connections (connections.csv).'}
        </p>
        <FilteredTree detail={detail} />
        <Legend />
      </div>
    </div>
  );
}

/**
 * The referral tree with filters (seed, how people came in, group, strength, depth). People who
 * don't match but sit on the path to someone who does are shown faintly so branches stay connected.
 * This is the referral activity seen in this experiment, not a map of anyone's whole network.
 */
function FilteredTree({ detail }: { detail: ExperimentDetail }) {
  const [seed, setSeed] = useState('');
  const [kind, setKind] = useState('');
  const [group, setGroup] = useState('');
  const [minStrength, setMinStrength] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  const groups = useMemo(() => [...new Set(detail.tree.map((n) => n.group).filter(Boolean) as string[])], [detail.tree]);
  const maxD = useMemo(() => detail.tree.reduce((m, n) => Math.max(m, n.depth), 0), [detail.tree]);
  const filtered = useMemo(() => {
    const active = Boolean(seed || kind || group || minStrength || maxDepth);
    if (!active) return detail.tree.map((n) => ({ ...n, dim: false }));
    const match = (n: ExperimentDetail['tree'][number]) =>
      (!seed || n.seed === seed)
      && (!kind || (kind === 'seed' ? (n.kind === 'seed_personal' || n.kind === 'seed_broadcast') : n.kind === kind))
      && (!group || n.group === group)
      && (!minStrength || (n.strength != null && n.strength >= minStrength))
      && (!maxDepth || n.depth <= maxDepth);
    const byId = new Map(detail.tree.map((n) => [n.id, n]));
    const keep = new Set<string>();
    for (const n of detail.tree) {
      if (!match(n)) continue;
      keep.add(n.id);
      for (let p = n.parent ? byId.get(n.parent) : undefined; p && !keep.has(p.id); p = p.parent ? byId.get(p.parent) : undefined) keep.add(p.id);
    }
    return detail.tree.filter((n) => keep.has(n.id)).map((n) => ({ ...n, dim: !match(n) }));
  }, [detail.tree, seed, kind, group, minStrength, maxDepth]);
  const nodes = useMemo<TreeNode[]>(() => [
    { id: 'root', parent: null, kind: 'root', label: 'Seeds', info: `${filtered.length} shown` },
    ...filtered.map((n): TreeNode => ({
      id: n.id,
      parent: n.parent ?? 'root',
      kind: n.deleted ? 'deleted' : n.dim ? 'pending' : 'member',
      color: n.deleted ? undefined : METHOD_COLOR[n.method],
      info: `Generation ${n.depth} · ${n.kind ? REFERRAL_KIND_LABEL[n.kind] : 'Participant'}${n.group ? ` · ${n.group}` : ''}${n.strength != null ? ` · strength ${n.strength}` : ''}${n.completed ? ' · completed' : ''}`,
    })),
  ], [filtered]);
  return (
    <>
      <div className="tree-filters" aria-label="Referral tree filters">
        <select className="input" value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Filter by seed">
          <option value="">All seeds</option>
          {detail.seeds.map((s) => <option key={s.id} value={s.id}>{s.note || s.sender_name || `Seed ${s.token.slice(0, 6)}`}</option>)}
        </select>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by referral type">
          <option value="">All referral types</option>
          <option value="seed">Seed joiners</option>
          <option value="seed_personal">Personal seeds</option>
          <option value="seed_broadcast">Broadcast seeds</option>
          <option value="standard">Standard referrals</option>
          <option value="additional">Additional referrals</option>
        </select>
        {groups.length > 0 && (
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by group">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <select className="input" value={minStrength} onChange={(e) => setMinStrength(Number(e.target.value))} aria-label="Filter by connection strength">
          <option value={0}>Any strength</option>
          <option value={25}>Strength ≥ 25</option>
          <option value={50}>Strength ≥ 50</option>
          <option value={75}>Strength ≥ 75</option>
        </select>
        <select className="input" value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} aria-label="Filter by referral depth">
          <option value={0}>Any depth</option>
          {Array.from({ length: Math.max(0, maxD) }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Up to generation {d}</option>)}
        </select>
      </div>
      <p className="muted small">
        Shows the referral activity observed in this experiment, not anyone’s complete network. Faint dots are on the path to a match.
      </p>
      <Tree nodes={nodes} height={420} />
    </>
  );
}


// ---------------------------------------------------------------------------
// ABC experiment and connection strength
// ---------------------------------------------------------------------------

const num = (v: number | null | undefined, digits = 2) => (v == null ? '—' : Number(v).toFixed(digits));
const signed = (v: number | null | undefined) => (v == null ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}`);

/** Horizontal bars, one or two series per row (dataviz: same scale, labelled values). */
function BarRows({ rows, legend }: { rows: { label: string; a: number; b?: number; note?: string }[]; legend?: [string, string] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.a), Math.abs(r.b ?? 0)]));
  return (
    <div className="dist">
      {legend && <div className="dist-legend"><span className="sw out" />{legend[0]} <span className="sw accent" />{legend[1]}</div>}
      {rows.map((r) => (
        <div className="dist-row abc-row" key={r.label}>
          <span className="dist-label">{r.label}</span>
          <div className="dist-bars">
            <div className="bar-track thin"><div className={`bar ${legend ? 'out' : 'accent'}`} style={{ width: `${(Math.abs(r.a) / max) * 100}%` }} /></div>
            {r.b !== undefined && <div className="bar-track thin"><div className="bar accent" style={{ width: `${(Math.abs(r.b) / max) * 100}%` }} /></div>}
          </div>
          <span className="dist-n">{r.note ?? (r.b !== undefined ? `${r.a} · ${r.b}` : r.a)}</span>
        </div>
      ))}
    </div>
  );
}

/** Warm vs cold outreach and connection strength, filterable by experiment and group. */
function AbcPanel({ refreshKey, fixedExperiment }: { refreshKey: number; fixedExperiment?: string }) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [expPicked, setExp] = useState('');
  const exp = fixedExperiment ?? expPicked;
  const [cls, setCls] = useState('');
  const [st, setSt] = useState<AdminAbcStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void api.adminExperiments().then(setExperiments).catch(() => undefined); }, [refreshKey]);
  useEffect(() => {
    setError(null);
    api.adminAbcStats(exp || null, cls || null).then(setSt).catch((e: Error) => setError(adminErrorText(e)));
  }, [exp, cls, refreshKey]);

  const groups = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of experiments) for (const g of e.abc_scenarios ?? []) if (!m.has(g.key)) m.set(g.key, g.label);
    return [...m.entries()];
  }, [experiments]);
  const groupLabel = (k: string) => groups.find(([key]) => key === k)?.[1] ?? k;

  return (
    <Panel
      title="ABC experiment"
      note="Would people answer Jane/John more readily through an introduction than a cold message, and does that depend on how close they are to the person who introduces them? These are self-reported answers, so read differences as associations, not causes. Previews are never stored, and test experiments are left out unless you pick one here."
    >
      <div className="abc-filters">
        {!fixedExperiment && (
          <select className="input" value={exp} onChange={(e) => setExp(e.target.value)} aria-label="Filter by experiment">
            <option value="">All experiments</option>
            {experiments.map((e) => <option key={e.id} value={e.id}>{e.name}{e.is_test ? ' (test)' : ''}</option>)}
          </select>
        )}
        <select className="input" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Filter by participant group">
          <option value="">Students and alumni</option>
          {groups.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <ErrorText error={error} />
      {st && (
        <>
          <div className="tiles compact">
            <Tile label="Eligible" value={st.participation.eligible} sub={`${st.participation.started} started`} />
            <Tile label="Completed" value={st.participation.completed} sub={`${pct(st.participation.completed, st.participation.eligible)} of eligible`} />
            <Tile label="Cold (message)" value={num(st.outreach.avg_cold)} sub="average, 1–5" />
            <Tile label="Warm (introduced)" value={num(st.outreach.avg_warm)} sub="average, 1–5" />
            <Tile label="Introduction advantage" value={signed(st.outreach.avg_advantage)} sub="warm − cold, average" />
            <Tile label="Connection strength" value={num(st.strength.avg_closeness)} sub={`average of ${st.strength.ratings_n} ratings, 1–5`} />
          </div>

          <div className="dist-grid">
            <div>
              <h3 className="abc-h">Responses, 1 = very unlikely … 5 = very likely</h3>
              <BarRows
                legend={['Cold', 'Warm']}
                rows={[1, 2, 3, 4, 5].map((k) => ({ label: String(k), a: st.outreach.cold_dist?.[k - 1] ?? 0, b: st.outreach.warm_dist?.[k - 1] ?? 0 }))}
              />
            </div>
            <div>
              <h3 className="abc-h">Introduction advantage (warm − cold), per person</h3>
              <BarRows rows={(st.outreach.advantage_dist ?? []).map((d) => ({ label: d.advantage > 0 ? `+${d.advantage}` : String(d.advantage), a: d.n }))} />
            </div>
            <div>
              <h3 className="abc-h">Connection strength to the inviter</h3>
              <BarRows rows={CLOSENESS_LABELS.map((l, i) => ({ label: `${i + 1} · ${l}`, a: st.strength.closeness_dist?.[i] ?? 0 }))} />
            </div>
            <div>
              <h3 className="abc-h">Introduction advantage by connection strength</h3>
              <BarRows
                rows={(st.strength.advantage_by_closeness ?? []).map((r) => ({
                  label: `${r.closeness} · ${CLOSENESS_LABELS[r.closeness - 1]}`,
                  a: Number(r.avg_advantage ?? 0),
                  note: r.n ? `${signed(r.avg_advantage)} (n=${r.n})` : '—',
                }))}
              />
            </div>
          </div>

          <h3 className="abc-h">Connection strength vs comfort asking for an introduction</h3>
          <Table
            head={['Strength', 'Ratings', 'Avg comfort (1–5)', 'Comfort 1 · 2 · 3 · 4 · 5']}
            rows={(st.strength.comfort_by_closeness ?? []).map((r) => [
              `${r.closeness} · ${CLOSENESS_LABELS[r.closeness - 1]}`, r.n, num(r.avg_comfort), (r.comfort_dist ?? []).join(' · '),
            ])}
          />
          <h3 className="abc-h">By experiment</h3>
          <Table
            head={['Experiment', 'Eligible', 'Completed', 'Rate', 'Cold', 'Warm', 'Advantage']}
            rows={st.by_experiment.map((e) => [e.name, e.eligible, e.completed, pct(e.completed, e.eligible), num(e.avg_cold), num(e.avg_warm), signed(e.avg_advantage)])}
          />
          <h3 className="abc-h">Students and alumni</h3>
          <Table
            head={['Group', 'ABC answers', 'Cold', 'Warm', 'Advantage', 'Strength ratings', 'Avg strength']}
            rows={st.by_classification.map((c) => [groupLabel(c.classification), c.abc_n ?? 0, num(c.avg_cold), num(c.avg_warm), signed(c.avg_advantage), c.ratings_n ?? 0, num(c.avg_closeness)])}
          />
          <h3 className="abc-h">By generation</h3>
          <Table
            head={['Generation', 'Strength ratings', 'Avg strength', 'ABC answers', 'Advantage']}
            rows={st.by_depth.map((d) => [d.depth, d.ratings_n ?? 0, num(d.avg_closeness), d.abc_n ?? 0, signed(d.avg_advantage)])}
          />
          <h3 className="abc-h">Checks for presentation effects</h3>
          <Table
            head={['Asked first', 'Answers', 'Cold', 'Warm']}
            rows={st.outreach.by_order.map((o) => [o.order === 'cold_first' ? 'Cold (message)' : 'Warm (introduction)', o.n, num(o.avg_cold), num(o.avg_warm)])}
          />
          <Table head={['Name shown', 'Answers', 'Advantage']} rows={st.outreach.by_name.map((n) => [n.name, n.n, signed(n.avg_advantage)])} />
          <div className="export-row">
            <ExportButton kind="abc" />
            <ExportButton kind="relationships" />
          </div>
          <p className="muted small">abc.csv and relationships.csv contain random ids only (no names or emails). Generation 1 = joined from a seed link; the ABC questions start at the generation set per experiment (default 3).</p>
        </>
      )}
    </Panel>
  );
}

/** The public onboarding settings, as the invitation page receives them. */
const publicInfo = (e: Experiment): ExperimentInfo => ({
  ...e,
  eligibility: e.eligibility_enabled && e.eligibility_question
    ? {
        question: e.eligibility_question,
        eligible_label: e.eligible_label,
        ineligible_label: e.ineligible_label,
        ineligible_message: e.ineligible_message || `This experiment is currently for ${e.name} members. Thanks for your interest.`,
      }
    : null,
});

/** Same mapping as the server's px_classify: a participant type → the ABC scenario group. */
const scenarioKeyFor = (e: Experiment | undefined, label: string | null) => {
  const scenarios = e?.abc_scenarios ?? [];
  if (!label) return scenarios[0]?.key;
  const exact = scenarios.find((s) => s.label.toLowerCase() === label.toLowerCase());
  if (exact) return exact.key;
  if (/alum/i.test(label)) return 'alumni';
  if (/student|undergrad|current/i.test(label)) return 'student';
  return scenarios[0]?.key;
};

type SimStep = null | 'landing' | 'classify' | 'closeness' | 'comfort' | 'join' | 'abc' | 'summary';

/**
 * Participant experience simulator (admin only): the real invitation screens,
 * in order, for any group: landing, relationship question, connection
 * strength, comfort, the join screen with the group's
 * eligibility question and participant types, then the ABC questions when the
 * chosen generation gets them. Runs entirely in this browser; nothing is
 * saved, so it never reaches the analytics. Works on a phone at /admin.
 */
function AbcPreviewPanel({ experimentId }: { experimentId?: string }) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [expId, setExpId] = useState(experimentId ?? '');
  useEffect(() => { if (experimentId) setExpId(experimentId); }, [experimentId]);
  const [name, setName] = useState<'Jane' | 'John'>('Jane');
  const [order, setOrder] = useState<'cold_first' | 'warm_first'>('cold_first');
  const [depth, setDepth] = useState(3);
  const [inviter, setInviter] = useState('Alex');
  const [invitedName, setInvitedName] = useState('');
  const [method, setMethod] = useState<string>('context');
  const [step, setStep] = useState<SimStep>(null);
  const [answers, setAnswers] = useState<{
    relationship?: string; closeness?: number; comfort?: number; name?: string; category?: string | null; cold?: number; warm?: number;
  }>({});

  // Always the saved settings: reloaded whenever an experiment is saved, and on each start.
  const loadExperiments = useCallback(() => api.adminExperiments().then(setExperiments).catch(() => undefined), []);
  useEffect(() => {
    void loadExperiments();
    window.addEventListener(EXPERIMENTS_CHANGED, loadExperiments);
    return () => window.removeEventListener(EXPERIMENTS_CHANGED, loadExperiments);
  }, [loadExperiments]);
  const e = experiments.find((x) => x.id === expId) ?? experiments[0];
  const minDepth = e?.abc_min_depth ?? 3;
  const eligible = Boolean(e?.abc_enabled) && depth >= minDepth;
  const inviterFirst = inviter.trim() || 'the person who invited you';
  const key = scenarioKeyFor(e, answers.category ?? null);
  const scenario = e?.abc_scenarios.find((x) => x.key === key) ?? e?.abc_scenarios[0];
  const abcState: AbcState = {
    eligible: true, name, order, classification: scenario?.key, inviter_name: inviter.trim() || null,
    scenario: (scenario?.scenario ?? '').replace('{name}', name), cold: null, warm: null, completed: false,
  };
  const start = async () => { await loadExperiments(); setAnswers({}); setStep('landing'); };
  const afterRating = () => setStep('join');
  const asksRelationship = e?.ask_relationship_question !== false;

  return (
    <Panel
      title="Participant experience simulator"
      note="The real invitation screens for the chosen group: landing, relationship questions, the join screen (eligibility question, participant types, name, consent) and the ABC questions. Nothing is saved, so it never reaches the analytics."
    >
      <div className="preview-controls">
        <label>Group
          <select className="input" value={e?.id ?? ''} onChange={(ev) => setExpId(ev.target.value)} aria-label="Preview experiment">
            {experiments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label>Generation
          <input className="input" type="number" min={1} max={12} value={depth} onChange={(ev) => setDepth(Math.max(1, Number(ev.target.value) || 1))} aria-label="Preview generation" />
        </label>
        <label>Inviter’s first name
          <input className="input" value={inviter} maxLength={30} onChange={(ev) => setInviter(ev.target.value)} aria-label="Preview inviter name" />
        </label>
        <label>Name the inviter typed <span className="muted">(empty = seed link)</span>
          <input className="input" value={invitedName} maxLength={40} placeholder="e.g. Sam K." onChange={(ev) => setInvitedName(ev.target.value)} aria-label="Preview invited name" />
        </label>
        <label>Relationship question
          <select className="input" value={method} onChange={(ev) => setMethod(ev.target.value)} aria-label="Preview relationship question">
            {(Object.keys(METHODS) as MethodKey[]).map((m) => <option key={m} value={m}>{methodDef(m).adminName}</option>)}
          </select>
        </label>
        <label>ABC name
          <select className="input" value={name} onChange={(ev) => setName(ev.target.value as 'Jane' | 'John')} aria-label="Preview name">
            <option>Jane</option><option>John</option>
          </select>
        </label>
        <label>ABC question order
          <select className="input" value={order} onChange={(ev) => setOrder(ev.target.value as 'cold_first' | 'warm_first')} aria-label="Preview order">
            <option value="cold_first">Cold first</option><option value="warm_first">Warm first</option>
          </select>
        </label>
      </div>
      <p className="muted small" data-testid="preview-eligibility">
        Generation {depth} {eligible ? 'gets' : 'doesn’t get'} the ABC questions in {e?.name ?? 'this group'} (from generation {minDepth}
        {e && !e.abc_enabled ? ', currently switched off' : ''}). Generation 1 joined from a seed link.
        {e ? (e.ask_relationship_question === false
          ? ' “Where do you know them from?” is skipped.'
          : ' “Where do you know them from?” is asked (untick it in the group’s settings to skip it).') : ''}
        {e?.eligibility_enabled && e.eligibility_question ? ` Eligibility question: “${e.eligibility_question}”` : ' No eligibility question.'}
      </p>
      <Button onClick={start}>Start simulator</Button>

      {step && step !== 'summary' && step !== 'abc' && (
        <div className="preview-layer" role="dialog" aria-modal="true" aria-label="Simulator">
          <button type="button" className="chip preview-exit" onClick={() => setStep(null)}>Exit simulator</button>
          {step === 'landing' && (
            <Screen className="center landing">
              <LandingIntro senderName={inviter.trim() || null} experiment={e ? publicInfo(e) : null} onEnter={() => setStep(asksRelationship ? 'classify' : 'closeness')} />
            </Screen>
          )}
          {step === 'classify' && (
            <Screen className="question-screen">
              <p className="eyebrow fade-up">First, one question</p>
              <Classifier method={method} name={inviterFirst} onSelect={(v) => { setAnswers((a) => ({ ...a, relationship: v })); setStep('closeness'); }} />
            </Screen>
          )}
          {(step === 'closeness' || step === 'comfort') && (
            <Screen className="question-screen">
              <p className="eyebrow">{step === 'closeness' ? (asksRelationship ? 'One more' : 'Two quick questions') : 'Last one'}</p>
              {step === 'closeness' ? (
                <ClosenessMeter
                  name={inviterFirst}
                  onConfirm={(v) => { setAnswers((a) => ({ ...a, closeness: v })); if (method === 'comfort' && asksRelationship) afterRating(); else setStep('comfort'); }}
                />
              ) : (
                <ScaleQuestion
                  testId="comfort"
                  question={COMFORT_QUESTION(inviterFirst)}
            note={PRIVATE_NOTE(inviterFirst)}
                  low="Not at all"
                  high="Completely"
                  onSelect={(v) => { setAnswers((a) => ({ ...a, comfort: v })); afterRating(); }}
                />
              )}
            </Screen>
          )}
          {step === 'join' && e && (
            <Screen className="join-screen">
              <JoinForm
                preview
                experiment={publicInfo(e)}
                invitedName={invitedName.trim() || null}
                senderFirst={inviter.trim() || null}
                footer={COPY.joinFooter}
                onSubmit={(v) => { setAnswers((a) => ({ ...a, name: v.name, category: v.category })); setStep(eligible ? 'abc' : 'summary'); }}
              />
            </Screen>
          )}
        </div>
      )}
      {step === 'abc' && (
        <AbcFlow
          state={abcState}
          onClassify={async () => undefined}
          onAnswer={async (q, v) => { setAnswers((a) => ({ ...a, [q]: v })); }}
          onClose={() => setStep('summary')}
          onDone={() => setStep('summary')}
        />
      )}
      {step === 'summary' && (
        <div className="preview-summary" data-testid="preview-summary">
          <h3 className="abc-h">Simulator answers (not saved)</h3>
          <Table
            head={['Question', 'Answer']}
            rows={[
              ['Relationship question', answers.relationship ?? (asksRelationship ? '—' : 'not asked in this group')],
              ['Connection strength', answers.closeness ? `${answers.closeness} · ${CLOSENESS_LABELS[answers.closeness - 1]}` : '—'],
              ['Comfort asking for an introduction', answers.comfort ?? (method === 'comfort' && asksRelationship ? 'their assigned question' : '—')],
              ['Name', answers.name ?? '—'],
              ['Participant type', answers.category ?? '—'],
              ['Cold (message)', answers.cold ?? (eligible ? '—' : 'not shown at this generation')],
              ['Warm (introduction)', answers.warm ?? (eligible ? '—' : 'not shown at this generation')],
              ['Introduction advantage', answers.cold && answers.warm ? signed(answers.warm - answers.cold) : '—'],
            ]}
          />
          <button type="button" className="link" onClick={() => setStep(null)}>Close</button>
        </div>
      )}
    </Panel>
  );
}

const ratioPct = (r: Ratio) => (r.den > 0 ? `${Math.round((r.num / r.den) * 100)}%` : '—');
const ratioOf = (r: Ratio, what: string) => `${r.num} of ${r.den} ${what}`;

/**
 * Launch analytics (migration 018). Every rate shows what it is a share of. A link is counted once
 * per stage: generated → shared (Copy/Share tapped; not proof it was sent) → opened (a person
 * opened it; automated link-preview requests aren't recorded) → started (joined) → completed.
 * Test experiments are excluded.
 */
function LaunchPanel({ experimentId, refreshKey, waitlistTotal }: { experimentId: string | null; refreshKey: number; waitlistTotal: number | null }) {
  const [a, setA] = useState<AdminLaunchAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.adminLaunchAnalytics(experimentId)
      .then((r) => { if (alive) { setA(r); setError(null); } })
      .catch((e) => { if (alive) setError(adminErrorText(e)); });
    return () => { alive = false; };
  }, [experimentId, refreshKey]);

  if (error) {
    return (
      <Panel title="Launch analytics" note="Seed links, referrals, completion and waitlist conversion.">
        <p className="muted small">
          Not available yet. Run <code>supabase/migrations/018_launch_updates.sql</code> in the Supabase SQL editor, then refresh.
        </p>
      </Panel>
    );
  }
  if (!a) return <Panel title="Launch analytics"><p className="muted small">Loading…</p></Panel>;
  const o = a.overview;
  const kindRow = (k: AdminLaunchAnalytics['by_kind'][number]) => [
    REFERRAL_KIND_LABEL[k.kind] ?? k.kind,
    k.generated, k.shared, k.opened, k.started, k.completed,
    `${ratioPct(k.conversion)} (${ratioOf(k.conversion, 'generated')})`,
  ];
  const standard = a.by_kind.find((k) => k.kind === 'standard');
  const additional = a.by_kind.find((k) => k.kind === 'additional');
  return (
    <Panel
      title="Launch analytics"
      note={experimentId ? 'This experiment only.' : 'All experiments except test ones.'}
    >
      <div className="tiles" data-testid="launch-tiles">
        <Tile label="Seed links" value={o.seed_links} sub="personal + broadcast" />
        <Tile label="Unique participants" value={o.participants} sub="not deleted" />
        <Tile label="Experiment starts" value={o.started} sub="joined through any link" />
        <Tile label="Completed" value={o.completed} sub="finished the experiment" />
        <Tile label="Completion rate" value={ratioPct(o.completion_rate)} sub={ratioOf(o.completion_rate, 'who started')} />
        <Tile label="Waitlist signups" value={waitlistTotal ?? o.waitlist_from_experiment} sub={waitlistTotal != null ? 'unique emails, website + experiment' : 'from the experiment'} />
        <Tile label="Waitlist conversion" value={ratioPct(o.waitlist_conversion)} sub={ratioOf(o.waitlist_conversion, 'who completed')} />
      </div>
      {o.by_group.length > 0 && (
        <Table head={['Group', 'Participants', 'Completed']} rows={o.by_group.map((g) => [g.group, g.participants, `${g.completed} (${pct(g.completed, g.participants)})`])} />
      )}

      <h3 className="subhead">Referrals</h3>
      <Table
        head={['Type', 'Generated', 'Shared', 'Opened', 'Started', 'Completed', 'Conversion (completed ÷ generated)']}
        rows={a.by_kind.map(kindRow)}
      />
      <div className="tiles">
        <Tile label="Standard conversion" value={standard ? ratioPct(standard.conversion) : '—'} sub={standard ? ratioOf(standard.conversion, 'standard links generated') : 'no links yet'} />
        <Tile label="Additional conversion" value={additional ? ratioPct(additional.conversion) : '—'} sub={additional ? ratioOf(additional.conversion, 'additional links generated') : 'no links yet'} />
        <Tile label="Made additional invites" value={ratioPct(a.additional.completed_with_any)} sub={ratioOf(a.additional.completed_with_any, 'completed participants')} />
        <Tile label="Additional per participant" value={a.additional.per_completed.den ? (a.additional.per_completed.num / a.additional.per_completed.den).toFixed(2) : '—'} sub={ratioOf(a.additional.per_completed, 'completed participants')} />
        <Tile label="Referral depth" value={`max ${a.depth.max}`} sub={`average ${a.depth.avg ?? '—'} (seed joiners are 1)`} />
        <Tile label="Created → completed" value={fmtDuration(a.timing.median_created_to_completed_s)} sub={`median, ${a.timing.measured} measured`} />
        <Tile label="Invited more than once" value={a.overlap.people_invited_more_than_once} sub={`${a.overlap.extra_invitations_received} extra invitations kept as overlap`} />
      </div>
      <p className="muted small">
        Generated = link exists (revoked excluded). Shared = Copy/Share tapped, not proof it was sent. Opened = a person opened it
        (link-preview bots aren’t recorded). Started = someone joined through it. Completed = that person completed the experiment.
        Completion times only exist for people who finish after migration 018.
      </p>
    </Panel>
  );
}

/** Optional feedback (migration 018). Not linked to participants; only the text, group, week and any contact offered. */
function FeedbackPanel({ groups, refreshKey }: { groups: Experiment[]; refreshKey: number }) {
  const [exp, setExp] = useState<string>('');
  const [status, setStatus] = useState<'' | 'new' | 'reviewed'>('');
  const [list, setList] = useState<AdminFeedbackList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.adminFeedbackList(exp || null, status || null)
      .then((r) => { setList(r); setError(null); })
      .catch((e) => setError(adminErrorText(e)));
  }, [exp, status]);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (error) {
    return (
      <Panel title="Feedback">
        <p className="muted small">
          Not available yet. Run <code>supabase/migrations/018_launch_updates.sql</code> in the Supabase SQL editor, then refresh.
        </p>
      </Panel>
    );
  }
  const weekOf = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <Panel
      title="Feedback"
      note="Written feedback from the end of the experiment. It isn’t linked to a participant, invitation or rating, and only the week it was sent is kept. Don’t try to work out who wrote it."
    >
      {list && (
        <div className="tiles community-tiles">
          <Tile label="Total" value={list.counts.total} />
          <Tile label="Not reviewed" value={list.counts.new} />
          <Tile label="Offered contact" value={list.counts.with_contact} sub="optional email" />
        </div>
      )}
      <div className="experiment-form-row">
        <label>Group
          <select className="input" value={exp} onChange={(e) => setExp(e.target.value)} aria-label="Filter by experiment group">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label>Status
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as '' | 'new' | 'reviewed')} aria-label="Filter by status">
            <option value="">All</option>
            <option value="new">Not reviewed</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </label>
      </div>
      {list && list.items.length === 0 && <p className="muted small">No feedback yet.</p>}
      <ul className="feedback-list">
        {list?.items.map((f) => (
          <li key={f.id} className={`feedback-item ${f.status === 'reviewed' ? 'is-reviewed' : ''}`} data-testid="feedback-item">
            <p className="feedback-body">{f.body}</p>
            <p className="muted small">
              {f.experiment} · week of {weekOf(f.week)} ·{' '}
              {f.contact_ok ? <>open to discussing: <span className="mono">{f.contact_email}</span></> : 'anonymous'}
            </p>
            <button className="chip" onClick={async () => { await api.adminFeedbackReview(f.id, f.status !== 'reviewed'); load(); }}>
              {f.status === 'reviewed' ? 'Mark as not reviewed' : 'Mark as reviewed'}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** One waitlist: the Pipeline website and the end of the experiment together, de-duplicated by email. */
function WaitlistPanel({ stats: w }: { stats: AdminWaitlistOverview | null }) {
  if (!w) {
    return (
      <Panel title="Waitlist" note="Combined signups from pipeline-networking.com and the end of the experiment.">
        <p className="muted small">
          Not available yet. Run <code>supabase/migrations/017_waitlist_overview.sql</code> in the Supabase SQL editor,
          then refresh.
        </p>
      </Panel>
    );
  }
  const label = (s: string) => {
    if (s === 'experiment') return 'End of the experiment';
    const m = /^landing-(hero|footer)(?::(.+))?$/.exec(s);
    if (!m) return s;
    return `Website · ${m[1] === 'hero' ? 'top of page' : 'bottom of page'}${m[2] ? ` · from “${m[2]}”` : ''}`;
  };
  return (
    <Panel
      title="Waitlist"
      note="Pipeline website and end-of-experiment signups together, one row per email. Visible to administrators only."
    >
      <div className="tiles community-tiles">
        <Tile label="On the waitlist" value={w.unique_total} sub="unique emails" />
        <Tile label="Website" value={w.landing_total} sub="pipeline-networking.com" />
        <Tile label="From the experiment" value={w.experiment_total} sub={`${w.on_both} on both lists`} />
        <Tile label="Last 7 days" value={w.last_7_days} sub="new signups" />
      </div>
      <Table head={['Source', 'Signups']} rows={w.by_source.map((s) => [label(s.source), s.count])} />
      <h3 className="subhead">Recent signups</h3>
      <Table
        head={['Email', 'Source', 'Experiment', 'Signed up', 'Consent']}
        rows={w.recent.map((r) => [
          r.email, label(r.source), r.experiment ?? '—', new Date(r.created_at).toLocaleDateString(),
          r.consent ? 'Agreed to Pipeline updates' : '—',
        ])}
      />
      <p className="muted small">
        Consent: everyone listed agreed to Pipeline updates by email when they signed up (the exact wording is stored with each signup).
        Experiment participants appear only if they chose “Join Early Access”, and are never added automatically.
      </p>
    </Panel>
  );
}

/** Optional early-access signups (end of the invitation experiment). Emails only via CSV. */
function CommunityPanel({ stats: c }: { stats: AdminCommunityStats }) {
  return (
    <Panel
      title="Early access"
      note="Optional email signup at the end of the invitation experiment. Counts are active signups. research_pool.csv lists only people who agreed to be contacted about future experiments, with their email and experiment (no relationship data)."
    >
      <div className="tiles community-tiles">
        <Tile label="Signups" value={c.total} sub={`${pct(c.total, c.participants)} of participants`} />
        <Tile label="Future experiments" value={c.research_invites} sub={`${pct(c.research_invites, c.total)} of signups`} />
        <Tile label="Of those who finished" value={pct(c.total, c.eligible)} sub={`${c.total} of ${c.eligible} reached the end`} />
        <Tile label="Not now" value={c.dismissed} sub={`${c.unsubscribed} unsubscribed`} />
      </div>
      <Table
        head={['Experiment', 'Participants', 'Signups', 'Signed up', 'Future experiments']}
        rows={(c.by_experiment ?? []).map((e) => [e.name, e.participants, e.signups, pct(e.signups, e.participants), e.research_invites])}
      />
      <div className="export-row">
        <ExportButton kind="research_pool" />
        <ExportButton kind="community" />
      </div>
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

/**
 * Experiment D alongside A–C on comparable measures. Strength is on a common
 * 0–100 scale (A: weak 0 / acquaintance 50 / close 100; C: (n−1)/4; D: the
 * percentage; B has none). Lower isn't automatically "more accurate": compare
 * distributions, timing, completion and inviter–recipient agreement together.
 */
function MethodStatsPanel({ stats }: { stats: AdminMethodStats }) {
  const rate = (done: number, shown: number) => (shown > 0 ? `${done}/${shown} · ${pct(done, shown)}` : '—');
  const abandon = (done: number, shown: number) => (shown > 0 ? pct(Math.max(shown - done, 0), shown) : '—');
  const bands = stats.circular_bands;
  const maxBand = Math.max(1, ...bands.map((b) => Math.max(b.inbound, b.outbound)));
  const bins = stats.circular_bins;
  const maxBin = Math.max(1, ...bins.map((b) => b.n));
  return (
    <Panel
      title="Strength ratings by method"
      note="Strength on a common 0–100 scale (B has none). Completion = answered ÷ shown; abandonment = shown but not answered. Lower ratings aren't automatically more accurate."
    >
      <Table
        head={['Method', 'Avg strength in / out', 'Median time in / out', 'Completed (inbound)', 'Completed (outbound)', 'Abandoned in / out']}
        rows={stats.methods.map((m) => [
          <MethodName key={m.method} method={m.method} />,
          `${m.in_avg_strength ?? '—'} / ${m.out_avg_strength ?? '—'}`,
          `${secs(m.in_median_ms)} / ${secs(m.out_median_ms)}`,
          rate(m.in_completed, m.in_shown),
          rate(m.out_completed, m.out_shown),
          `${abandon(m.in_completed, m.in_shown)} / ${abandon(m.out_completed, m.out_shown)}`,
        ])}
      />
      <div className="dist-grid">
        <div className="dist">
          <MethodName method="circular" />
          <div className="dist-legend"><span className="sw in" />Inbound <span className="sw out" />Outbound</div>
          {bands.map((b) => (
            <div className="dist-row" key={b.label}>
              <span className="dist-label">{b.label}</span>
              <div className="dist-bars">
                <div className="bar-track thin" title={`Inbound ${b.label}: ${b.inbound}`}><div className="bar in" style={{ width: `${(b.inbound / maxBand) * 100}%` }} /></div>
                <div className="bar-track thin" title={`Outbound ${b.label}: ${b.outbound}`}><div className="bar out" style={{ width: `${(b.outbound / maxBand) * 100}%` }} /></div>
              </div>
              <span className="dist-n">{b.inbound} · {b.outbound}</span>
            </div>
          ))}
        </div>
        <div className="dist">
          <span className="method-name">D · ratings in 10-point bins</span>
          {Array.from({ length: 10 }, (_, i) => i * 10).map((bin) => {
            const n = bins.find((b) => b.bin === bin)?.n ?? 0;
            return (
              <div className="dist-row" key={bin}>
                <span className="dist-label">{bin}–{bin === 90 ? 100 : bin + 9}%</span>
                <div className="bar-track thin" title={`${bin}–${bin + 9}%: ${n}`}><div className="bar in" style={{ width: `${(n / maxBin) * 100}%` }} /></div>
                <span className="dist-n">{n}</span>
              </div>
            );
          })}
        </div>
      </div>
      <Table
        head={['Inviter method', 'Recipient method', 'Pairs', 'Mean gap (0–100)', 'Inviter − recipient']}
        rows={stats.agreement.map((a) => [
          <MethodName key="s" method={a.sender_method} />,
          <MethodName key="r" method={a.recipient_method} />,
          a.pairs,
          a.mean_abs_gap ?? '—',
          a.mean_sender_minus_recipient ?? '—',
        ])}
      />
    </Panel>
  );
}

/**
 * "Invitation settings": how this experiment looks and reads when its links
 * are shared, with a live preview. Saved with the rest of the form.
 */
function InvitationSettings({ d, set }: {
  d: ExperimentDraft;
  set: <K extends keyof ExperimentDraft>(k: K, v: ExperimentDraft[K]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const slugIssue = slugProblem(d.slug);
  const sponsorship = !d.affiliation_authorized && suggestsSponsorship(d.public_title, d.preview_description, d.invite_message, d.forward_message);
  const base = appUrl('/').replace(/^https?:\/\//, '').replace(/\/$/, '');

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      set('preview_image_url', await uploadPreviewImage(file, d.id));
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <fieldset className="experiment-onboarding invitation-settings">
      <legend>Invitation settings</legend>
      <div className="invitation-settings-grid">
        <div className="invitation-settings-fields">
          <label>Experiment title <span className="muted">(link previews)</span>
            <input className="input" value={d.public_title} maxLength={80} placeholder="Harvard Baseball Network Experiment"
              onChange={(e) => set('public_title', e.target.value)} aria-label="Experiment title" />
          </label>
          <label>URL slug
            <div className="slug-input">
              <span className="slug-prefix">{base}/</span>
              <input className="input" value={d.slug} maxLength={40} placeholder="harvard-baseball" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))} aria-label="URL slug" />
            </div>
          </label>
          {slugIssue
            ? <p className="error small" role="alert">{slugIssue}</p>
            : <p className="muted small">
                {d.slug ? <>Invitations become <span className="mono">{base}/{d.slug}/…</span>; each keeps its own unique code. Links already sent keep working.</> : 'Empty: links stay /join/…'}
                {!d.slug && d.name.trim() && slugify(d.name) && (
                  <> <button type="button" className="link inline" onClick={() => set('slug', slugify(d.name))}>Use “{slugify(d.name)}”</button></>
                )}
              </p>}
          <label>Link preview description
            <textarea className="input" rows={2} value={d.preview_description} maxLength={200} placeholder="How strong is the Harvard Baseball network? Help us find out."
              onChange={(e) => set('preview_description', e.target.value)} aria-label="Link preview description" />
          </label>
          <div className="preview-image-field">
            <span>Link preview image <span className="muted">(cropped to 1200×630; empty = a generated title card)</span></span>
            <div className="row-actions">
              <label className="chip file-chip">
                {uploading ? 'Uploading…' : d.preview_image_url ? 'Replace image' : 'Upload image'}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Upload preview image"
                  onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {d.preview_image_url && <button type="button" className="chip ghost" onClick={() => set('preview_image_url', '')}>Use generated image</button>}
            </div>
            <input className="input" value={d.preview_image_url} maxLength={600} placeholder="or an image address: https://…"
              onChange={(e) => set('preview_image_url', e.target.value.trim())} aria-label="Preview image address" />
            <ErrorText error={uploadError} />
          </div>
          <label>Initial invitation message <span className="muted">(sent with seed links)</span>
            <textarea className="input" rows={3} value={d.invite_message} maxLength={500}
              placeholder="Current Harvard Baseball players are studying the strength of our baseball network. Take this short survey to help us understand how connected our community really is."
              onChange={(e) => set('invite_message', e.target.value)} aria-label="Initial invitation message" />
          </label>
          <label>Participant forwarding message <span className="muted">(sent with participants’ own links)</span>
            <textarea className="input" rows={3} value={d.forward_message} maxLength={500}
              placeholder="I’m taking part in a short experiment about the Harvard Baseball network. Add your connection to help us map how our community is connected."
              onChange={(e) => set('forward_message', e.target.value)} aria-label="Participant forwarding message" />
          </label>
          <label className="preview-check">
            <input type="checkbox" checked={d.affiliation_authorized} onChange={(e) => set('affiliation_authorized', e.target.checked)} aria-label="Officially authorized" />
            Officially authorized <span className="muted">(only if the organization named has approved this experiment)</span>
          </label>
          {sponsorship && (
            <p className="error small" role="alert" data-testid="sponsorship-warning">
              This wording suggests official sponsorship or endorsement (e.g. “official”, “sponsored by”, “on behalf of”). Rephrase it unless the organization has authorized the experiment.
            </p>
          )}
        </div>
        <InvitationPreview look={{
          slug: slugIssue ? '' : d.slug,
          title: d.public_title,
          description: d.preview_description,
          imageUrl: d.preview_image_url,
          inviteMessage: d.invite_message,
          forwardMessage: d.forward_message,
        }} />
      </div>
    </fieldset>
  );
}
