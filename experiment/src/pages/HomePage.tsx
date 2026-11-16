import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, inviteUrl, type MyInvitation, type MyState } from '../lib/api';
import { navigate } from '../lib/router';
import { pending } from '../lib/session';
import { supabase } from '../lib/supabase';
import { COPY } from '../config/experiment';
import { Classifier } from '../components/Classifier';
import { SignIn } from '../components/EmailAuth';
import { RevealOverlay } from '../components/Reveal';
import { Tree, type TreeNode } from '../components/Tree';
import { Button, Check, Constellation, ErrorText, Loading, Screen, Sheet } from '../components/ui';

export function HomePage({ session }: { session: Session | null }) {
  if (!session) return <SignedOut />;
  return <Home session={session} />;
}

function SignedOut() {
  const p = pending.get();
  const deleted = new URLSearchParams(window.location.search).has('deleted');
  return (
    <Screen className="center landing">
      <Constellation small />
      {deleted && <div className="toast fade-up">Your data has been deleted.</div>}
      <SignIn
        heading="The Pipeline Experiment"
        sub="Invitation only. Already part of it? Sign in with your email."
      />
      {p?.token && (
        <button className="link" onClick={() => navigate(`/i/${p.token}`)}>
          Continue your invitation
        </button>
      )}
      <DemoLinks />
    </Screen>
  );
}

/** Only rendered by the local demo (test/demo.mjs); real builds never set VITE_DEMO. */
export function DemoLinks() {
  const [busy, setBusy] = useState(false);
  if (!import.meta.env.VITE_DEMO) return null;
  const freshInvite = async () => {
    setBusy(true);
    pending.clear();
    await supabase.auth.signOut();
    const { token } = await (await fetch('/__test/new-invite', { method: 'POST' })).json();
    navigate(`/i/${token}`);
    setBusy(false);
  };
  return (
    <div className="demo-box">
      <p className="fine">Demo mode · every email code is 123456 · admin: admin@demo.dev</p>
      <div className="demo-links">
        <button className="chip" onClick={freshInvite} disabled={busy}>Fresh invite as a new visitor</button>
        <button className="chip" onClick={() => navigate('/admin')}>Admin</button>
        <button className="chip" onClick={async () => { await supabase.auth.signOut(); navigate('/'); }}>Sign out</button>
      </div>
    </div>
  );
}

function Home({ session }: { session: Session }) {
  const [state, setState] = useState<MyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'invite' | 'feedback' | 'privacy'>(null);
  const [reveal, setReveal] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('already')) return 'You were already part of the experiment. Thanks for answering.';
    return null;
  });

  const load = useCallback(async () => {
    try {
      const s = await api.getMyState();
      setState(s);
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
    if (window.location.search) window.history.replaceState(null, '', '/');
  }, [load]);

  // Signed in but not yet joined, with an invitation in progress: resume it.
  const pendingToken = state && !state.participant ? pending.get()?.token : undefined;
  useEffect(() => {
    if (pendingToken) navigate(`/i/${pendingToken}`, true);
  }, [pendingToken]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Reload after an action; play any newly unlocked reveals.
  const refresh = async () => {
    const before = state?.participant?.reveal_level ?? 0;
    const s = await load();
    const after = s?.participant?.reveal_level ?? 0;
    if (after > before) setReveal(before + 1);
  };

  if (error) {
    return (
      <Screen className="center">
        <ErrorText error={error} />
        <Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button>
      </Screen>
    );
  }
  if (!state) return <Loading />;

  const p = state.participant;
  if (!p) {
    if (pendingToken) return <Loading />;
    return (
      <Screen className="center">
        <div className="stack text-center fade-up">
          <Constellation small />
          <h1 className="title">Invitation only.</h1>
          <p className="muted">
            {session.user.email} hasn’t joined yet. Open the invitation link someone sent you.
          </p>
          {state.is_admin && <Button onClick={() => navigate('/admin')}>Admin dashboard</Button>}
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
          <DemoLinks />
        </div>
      </Screen>
    );
  }

  const invites = state.invitations ?? [];
  const max = state.max_invites ?? 2;
  const reveals = state.reveals ?? [];
  const level = p.reveal_level;
  const slots: (MyInvitation | null)[] = Array.from({ length: max }, (_, i) => invites[i] ?? null);
  const nextSlot = slots.findIndex((s) => s === null);
  const joined = (state.branch?.length ?? 1) - 1;

  return (
    <main className="home">
      <header className="home-header">
        <span className={`wordmark ${level >= 1 ? 'is-revealed' : ''}`}>
          {level >= 1 ? 'Pipeline' : 'The Pipeline Experiment'}
        </span>
        <button className="icon-btn" onClick={() => setSheet('privacy')} aria-label="Your data">
          <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </header>

      {notice && <div className="toast fade-up">{notice}</div>}

      <section className="hero">
        <div className="progress" aria-label={`${level} of 2 revealed`}>
          {[0, 1].map((i) => <i key={i} className={i < level ? 'on' : ''} />)}
        </div>
        {level === 0 && (
          <>
            <h1 className="display small">Two invitations.<br />Two answers.</h1>
            <p className="muted">Each person you invite reveals something.</p>
          </>
        )}
        {level >= 1 && <h1 className="display small reveal-static">{reveals[0]?.title}</h1>}
        {level === 1 && <p className="muted">One more invitation reveals what we’re building.</p>}
        {level >= 2 && <p className="mission reveal-static">{reveals[1]?.title}</p>}
      </section>

      <section className="slots">
        {slots.map((inv, i) =>
          inv ? (
            <InviteRow key={inv.id} inv={inv} index={i} onChanged={refresh} />
          ) : (
            <button key={`empty-${i}`} className="slot slot-empty" onClick={() => setSheet('invite')} disabled={i !== nextSlot}>
              <span className="slot-num">{i + 1}</span>
              <span className="slot-main">Invite someone</span>
              <span className="slot-plus" aria-hidden="true">+</span>
            </button>
          ),
        )}
        {level < 2 && (
          <button className="link center-link" onClick={() => setSheet('feedback')}>
            Rather not invite anyone? Answer one question instead.
          </button>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Your branch</h2>
          <span className="muted small">{joined} joined through you</span>
        </div>
        <BranchTree state={state} />
        <div className="stats">
          <div><strong>{state.network?.participants ?? 0}</strong><span>in the experiment</span></div>
          <div><strong>{state.network?.generations ?? 0}</strong><span>generations deep</span></div>
          <div><strong>{p.depth}</strong><span>your generation</span></div>
        </div>
      </section>

      {state.is_admin && (
        <button className="link center-link" onClick={() => navigate('/admin')}>Admin dashboard</button>
      )}
      <DemoLinks />

      {sheet === 'invite' && (
        <InviteSheet
          method={p.method}
          onClose={() => {
            setSheet(null);
            void refresh();
          }}
        />
      )}
      {sheet === 'feedback' && (
        <FeedbackSheet
          question={state.feedback_question ?? ''}
          onClose={(done) => {
            setSheet(null);
            if (done) void refresh();
          }}
        />
      )}
      {sheet === 'privacy' && (
        <PrivacySheet state={state} onClose={() => setSheet(null)} onChanged={load} />
      )}
      {reveal !== null && reveals[reveal - 1] && (
        <RevealOverlay
          step={reveal}
          title={reveals[reveal - 1].title}
          onDone={() => setReveal(reveal < level ? reveal + 1 : null)}
        />
      )}
    </main>
  );
}

const STATUS: Record<string, { label: string; tone: string }> = {
  created: { label: 'Link ready', tone: 'idle' },
  opened: { label: 'Opened', tone: 'warm' },
  accepted: { label: 'Joined', tone: 'done' },
};

function InviteRow({ inv, index, onChanged }: { inv: MyInvitation; index: number; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(inv.token);
  const st = STATUS[inv.status] ?? STATUS.created;
  const copy = async () => {
    await copyText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const remove = async () => {
    if (!window.confirm('Remove this link? It will stop working and frees the slot.')) return;
    await api.revokeInvitation(inv.id);
    onChanged();
  };
  return (
    <div className={`slot slot-${inv.status}`}>
      <span className="slot-num">{index + 1}</span>
      <div className="slot-main">
        <span>{inv.recipient_label || 'Invitation'}</span>
        <span className={`pill tone-${st.tone}`}><i />{st.label}</span>
      </div>
      {inv.status !== 'accepted' && (
        <div className="slot-actions">
          <button className="chip" onClick={() => share(url)}>Share</button>
          <button className="chip" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button className="chip ghost" onClick={remove} aria-label="Remove link">×</button>
        </div>
      )}
    </div>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

async function share(url: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text: COPY.shareText, url });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await copyText(url);
  return 'copied';
}

function InviteSheet({ method, onClose }: { method: string; onClose: () => void }) {
  const [step, setStep] = useState<'who' | 'classify' | 'ready'>('who');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async (value: string, ms: number) => {
    try {
      const r = await api.createInvitation(value, label.trim() || null, ms);
      setUrl(inviteUrl(r.token));
      setStep('ready');
    } catch (e) {
      setError((e as Error).message);
      setStep('who');
    }
  };

  return (
    <Sheet onClose={onClose}>
      {step === 'who' && (
        <form className="stack fade-up" onSubmit={(e) => { e.preventDefault(); setStep('classify'); }}>
          <p className="eyebrow">New invitation</p>
          <h2 className="title">Who are you inviting?</h2>
          <input
            className="input"
            placeholder="First name or nickname"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
            aria-label="Who are you inviting"
          />
          <p className="fine">Only you see this. It helps you keep track of your links.</p>
          <ErrorText error={error} />
          <Button type="submit">Continue</Button>
        </form>
      )}
      {step === 'classify' && (
        <Classifier method={method} name={label.trim() || 'them'} onSelect={create} />
      )}
      {step === 'ready' && (
        <div className="stack fade-up text-center">
          <div className="ready-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          <h2 className="title">Your link is ready.</h2>
          <p className="muted">It works once, for one person.</p>
          <code className="url">{url.replace(/^https?:\/\//, '')}</code>
          <Button onClick={async () => { const r = await share(url); if (r === 'copied') setCopied(true); }}>
            {copied ? 'Link copied' : 'Share invitation'}
          </Button>
          <Button variant="secondary" onClick={async () => { await copyText(url); setCopied(true); }}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <button className="link" onClick={onClose}>Done</button>
        </div>
      )}
    </Sheet>
  );
}

function FeedbackSheet({ question, onClose }: { question: string; onClose: (done: boolean) => void }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.submitFeedback(answer);
      onClose(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet onClose={() => onClose(false)}>
      <form className="stack fade-up" onSubmit={submit}>
        <p className="eyebrow">One question</p>
        <h2 className="title">{question}</h2>
        <textarea
          className="input textarea"
          rows={4}
          maxLength={1000}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="A sentence is plenty."
          autoFocus
          aria-label="Your answer"
        />
        <ErrorText error={error} />
        <Button type="submit" busy={busy} disabled={!answer.trim()}>Submit and reveal</Button>
      </form>
    </Sheet>
  );
}

function PrivacySheet({ state, onClose, onChanged }: { state: MyState; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const p = state.participant!;
  const [marketing, setMarketing] = useState(p.marketing_consent);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = async (v: boolean) => {
    setMarketing(v);
    await api.setMarketingConsent(v);
    await onChanged();
  };
  const del = async () => {
    setBusy(true);
    await api.deleteMyData();
    pending.clear();
    await supabase.auth.signOut();
    navigate('/?deleted=1', true);
  };

  return (
    <Sheet onClose={onClose}>
      <div className="stack fade-up">
        <p className="eyebrow">Your data</p>
        <h2 className="title">{p.display_name}</h2>
        <p className="muted small">{p.email}</p>
        <ul className="data-notes">
          {COPY.research.map((l) => <li key={l}>{l}</li>)}
        </ul>
        <Check checked={marketing} onChange={toggle}>Email me about Pipeline</Check>
        {!confirming ? (
          <>
            <Button variant="secondary" onClick={() => supabase.auth.signOut()}>Sign out</Button>
            <button className="link danger" onClick={() => setConfirming(true)}>Delete my data</button>
          </>
        ) : (
          <div className="stack confirm">
            <p className="muted small">
              This erases your name, email, and answers, and closes any unused links. People who joined
              through you stay in the experiment anonymously.
            </p>
            <Button onClick={del} busy={busy}>Delete permanently</Button>
            <button className="link" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function BranchTree({ state }: { state: MyState }) {
  const nodes = useMemo<TreeNode[]>(() => {
    const branch = state.branch ?? [];
    const out: TreeNode[] = branch.map((b) => ({
      id: String(b.k),
      parent: b.p === null ? null : String(b.p),
      kind: b.g === 0 ? 'self' : 'member',
      label: b.g === 0 ? 'You' : b.label,
    }));
    const root = branch.find((b) => b.g === 0);
    for (const inv of state.invitations ?? []) {
      if (inv.status === 'accepted' || !root) continue;
      out.push({ id: `pending-${inv.id}`, parent: String(root.k), kind: 'pending', label: inv.recipient_label });
    }
    return out;
  }, [state]);
  return <Tree nodes={nodes} height={320} />;
}
