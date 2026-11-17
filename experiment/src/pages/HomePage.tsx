import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, type MyAccount, type MyState } from '../lib/api';
import { currentQuery, navigate } from '../lib/router';
import { demoNewInvite, demoReset, isLocalDemo } from '../lib/demo';
import { pending } from '../lib/session';
import { supabase } from '../lib/supabase';
import { BRAND, COPY } from '../config/experiment';
import { InviteSheet, InviteSlots } from '../components/Invitations';
import { SignIn } from '../components/EmailAuth';
import { RevealOverlay } from '../components/Reveal';
import { Tree, type TreeNode } from '../components/Tree';
import { WaitlistOverlay } from '../components/Waitlist';
import { SaveNetworkOverlay } from '../components/SaveNetwork';
import { formatPhone, phoneEnabled } from '../lib/phone';
import { resetDeviceId } from '../lib/device';
import { useLiveInvitations } from '../lib/live';
import { Button, Constellation, ErrorText, Loading, Screen, Sheet } from '../components/ui';

export function HomePage({ session }: { session: Session | null }) {
  if (!session) return <SignedOut />;
  return <Home session={session} />;
}

function SignedOut() {
  const p = pending.get();
  const deleted = currentQuery().has('deleted');
  useEffect(() => {
    document.title = BRAND.hidden;
  }, []);
  return (
    <Screen className="center landing">
      <Constellation small />
      {deleted && <div className="toast fade-up">Your data has been deleted.</div>}
      <SignIn
        heading={BRAND.hidden}
        sub="Invitation only. Saved your network to an email? Sign in to open it here."
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
    resetDeviceId(); // a "new person" in the demo gets a new browser identity too
    await supabase.auth.signOut();
    const token = await demoNewInvite();
    navigate(`/i/${token}`);
    setBusy(false);
  };
  return (
    <div className="demo-box">
      <p className="fine">Demo mode · every email and text code is 123456 · admin: admin@demo.dev</p>
      <div className="demo-links">
        <button className="chip" onClick={freshInvite} disabled={busy}>Fresh invite as a new visitor</button>
        <button className="chip" onClick={() => navigate('/admin')}>Admin</button>
        <button className="chip" onClick={async () => { await supabase.auth.signOut(); navigate('/'); }}>Sign out</button>
        {isLocalDemo && <button className="chip ghost" onClick={demoReset}>Reset demo</button>}
      </div>
    </div>
  );
}

function Home({ session }: { session: Session }) {
  const [state, setState] = useState<MyState | null>(null);
  const [account, setAccount] = useState<MyAccount | null>(null);
  const [overlay, setOverlay] = useState<null | 'waitlist' | 'link' | 'phone'>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'invite' | 'feedback' | 'privacy'>(null);
  const [reveal, setReveal] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const q = currentQuery();
    if (q.get('already')) return 'You were already part of the experiment. Thanks for answering.';
    return null;
  });

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.getMyState(), api.getMyAccount()]);
      setState(s);
      setAccount(a);
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
    if ([...currentQuery().keys()].length) navigate('/', true);
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

  // Live statuses: when someone opens or accepts one of my invitations, the
  // card (and the network) update without a refresh.
  useLiveInvitations(state?.participant?.id, () => void load());

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
            {session.user.email ? `${session.user.email} hasn’t joined yet.` : 'You haven’t joined yet.'} Open the
            invitation link someone sent you.
          </p>
          {state.is_admin && <Button onClick={() => navigate('/admin')}>Admin dashboard</Button>}
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
          <DemoLinks />
        </div>
      </Screen>
    );
  }

  if (p.suspended) {
    return (
      <Screen className="center">
        <div className="stack text-center fade-up">
          <Constellation small />
          <h1 className="title">Your participation is paused.</h1>
          <p className="muted">Your invitation links are no longer active.</p>
          <button className="link center-link" onClick={() => setSheet('privacy')}>Your data</button>
        </div>
        {sheet === 'privacy' && (
          <PrivacySheet
            state={state}
            account={account}
            onClose={() => setSheet(null)}
            onLink={() => setSheet(null)}
            onWaitlist={() => setSheet(null)}
            onChanged={load}
          />
        )}
      </Screen>
    );
  }

  const invites = state.invitations ?? [];
  const max = state.max_invites ?? 2;
  const reveals = state.reveals ?? [];
  const level = p.reveal_level;
  const joined = (state.branch?.length ?? 1) - 1;
  const firstName = p.display_name?.trim().split(/\s+/)[0] ?? '';
  // The network appears once there's something in it: a link or a joined person.
  const showNetwork = invites.length > 0 || joined > 0;
  const brand = level >= 1 ? BRAND.revealed : BRAND.hidden;
  const networkSaved = Boolean(account?.linked_email || account?.linked_phone);
  // Saving the network uses a verified phone when SMS is enabled, otherwise email.
  const saveNetwork = () => setOverlay(phoneEnabled ? 'phone' : 'link');

  return (
    <main className="home">
      <header className="home-header">
        <Wordmark brand={brand} revealed={level >= 1} />
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
            <h1 className="display small">Now it’s your turn{firstName ? `, ${firstName}` : ''}.</h1>
            <p className="muted">Invite two people to discover what we’re building.</p>
          </>
        )}
        {level >= 1 && <h1 className="display small reveal-static">{reveals[0]?.title}</h1>}
        {level === 1 && <p className="muted">One more invitation reveals what we’re building.</p>}
        {level >= 2 && <p className="mission reveal-static">{reveals[1]?.title}</p>}
      </section>

      <InviteSlots
        invitations={invites}
        max={max}
        level={level}
        onInvite={() => setSheet('invite')}
        onChanged={refresh}
      />
      {level < 2 && (
        <button className="link center-link" onClick={() => setSheet('feedback')}>
          Rather not invite anyone? Answer one question instead.
        </button>
      )}

      {phoneEnabled && level >= 1 && account && !networkSaved && (
        <button className="early-card save-card fade-up" onClick={saveNetwork}>
          <div>
            <strong>Save your network</strong>
            <span>Verify your phone to use it on any device.</span>
          </div>
          <span className="arrow" aria-hidden="true">→</span>
        </button>
      )}

      {level >= 2 && !account?.waitlist_email && (
        <button className="early-card fade-up" onClick={() => setOverlay('waitlist')}>
          <div>
            <strong>Early access</strong>
            <span>Join the Pipeline waitlist.</span>
          </div>
          <span className="arrow" aria-hidden="true">→</span>
        </button>
      )}

      {showNetwork && (
      <section className="card network-card">
        <div className="card-head">
          <h2>Your network</h2>
          <span className="muted small">{joined === 0 ? 'No one has joined yet' : `${joined} joined through you`}</span>
        </div>
        <BranchTree state={state} />
        <div className="stats">
          <div><strong>{state.network?.participants ?? 0}</strong><span>in the experiment</span></div>
          <div><strong>{state.network?.generations ?? 0}</strong><span>generations deep</span></div>
          <div><strong>{p.depth}</strong><span>your generation</span></div>
        </div>
      </section>
      )}

      {state.is_admin && (
        <button className="link center-link" onClick={() => navigate('/admin')}>Admin dashboard</button>
      )}
      <DemoLinks />

      {sheet === 'invite' && (
        <InviteSheet
          method={p.method}
          first={invites.length === 0}
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
        <PrivacySheet
          state={state}
          account={account}
          onClose={() => setSheet(null)}
          onLink={() => { setSheet(null); saveNetwork(); }}
          onWaitlist={() => { setSheet(null); setOverlay('waitlist'); }}
          onChanged={load}
        />
      )}
      {reveal !== null && reveals[reveal - 1] && (
        <RevealOverlay
          step={reveal}
          title={reveals[reveal - 1].title}
          onDone={() => {
            if (reveal < level) return setReveal(reveal + 1);
            setReveal(null);
            // After the final reveal, invite them (once) to the early-access waitlist.
            if (reveal >= 2 && !account?.waitlist_email && !waitlistPrompted.get()) {
              waitlistPrompted.set();
              setOverlay('waitlist');
            }
          }}
        />
      )}
      {overlay === 'phone' && (
        <SaveNetworkOverlay
          onClose={(changed) => {
            setOverlay(null);
            if (changed) void load();
          }}
        />
      )}
      {(overlay === 'waitlist' || overlay === 'link') && (
        <WaitlistOverlay
          mode={overlay}
          account={account}
          onClose={(changed) => {
            setOverlay(null);
            if (changed) void load();
          }}
        />
      )}
    </main>
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

/**
 * Header name. "The Experiment" until the first unlock, then "Pipeline". The
 * change animates only when it happens in front of the participant; returning
 * participants simply see "Pipeline". The tab title follows the same rule.
 */
function Wordmark({ brand, revealed }: { brand: string; revealed: boolean }) {
  const startedRevealed = useRef(revealed);
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    document.title = brand;
    if (revealed && !startedRevealed.current) {
      startedRevealed.current = true;
      setAnimating(true);
    }
  }, [brand, revealed]);
  return (
    <span className={`wordmark ${revealed ? 'is-revealed' : ''} ${animating ? 'is-revealing' : ''}`} key={brand}>
      {brand}
    </span>
  );
}

const waitlistPrompted = {
  get: () => { try { return localStorage.getItem('px.waitlistPrompted') === '1'; } catch { return false; } },
  set: () => { try { localStorage.setItem('px.waitlistPrompted', '1'); } catch { /* ignore */ } },
};

function PrivacySheet({
  state,
  account,
  onClose,
  onLink,
  onWaitlist,
  onChanged,
}: {
  state: MyState;
  account: MyAccount | null;
  onClose: () => void;
  onLink: () => void;
  onWaitlist: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const p = state.participant!;
  const [confirming, setConfirming] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const anonymous = !account?.linked_email && !account?.linked_phone;
  const savedAs = account?.linked_phone ? formatPhone(account.linked_phone) : account?.linked_email;

  const leave = async () => {
    await api.leaveWaitlist();
    await onChanged();
  };
  const signOut = async () => {
    if (anonymous && !confirmSignOut) return setConfirmSignOut(true);
    await supabase.auth.signOut();
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
        <ul className="data-notes">
          {COPY.research.map((l) => <li key={l}>{l}</li>)}
        </ul>

        <div className="account-row">
          <div>
            <div>{anonymous ? 'Saved on this browser only' : 'Network saved'}</div>
            <div className="muted">
              {anonymous ? `Verify your ${phoneEnabled ? 'phone' : 'email'} to use it on any device.` : savedAs}
            </div>
          </div>
          {anonymous && <button className="chip" onClick={onLink}>Save</button>}
        </div>
        {p.reveal_level >= 1 && (
        <div className="account-row">
          <div>
            <div>Early-access waitlist</div>
            <div className="muted">{account?.waitlist_email ?? 'Not joined'}</div>
          </div>
          {account?.waitlist_email ? (
            <button className="chip ghost" onClick={leave}>Leave</button>
          ) : (
            <button className="chip" onClick={onWaitlist}>Join</button>
          )}
        </div>
        )}

        {!confirming ? (
          <>
            {confirmSignOut && (
              <p className="muted small">
                Your network is saved only on this browser. If you sign out without saving it first, you
                won’t be able to get back to it.
              </p>
            )}
            <Button variant="secondary" onClick={signOut}>{confirmSignOut ? 'Sign out anyway' : 'Sign out'}</Button>
            <button className="link danger" onClick={() => setConfirming(true)}>Delete my data</button>
          </>
        ) : (
          <div className="stack confirm">
            <p className="muted small">
              This erases your name, email, waitlist entry and answers, and closes any unused links.
              People who joined through you stay in the experiment anonymously.
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
