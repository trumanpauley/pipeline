import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, type OpenResult } from '../lib/api';
import { navigate } from '../lib/router';
import { pending, pendingFromSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { deviceId } from '../lib/device';
import { captchaToken } from '../lib/captcha';
import { NAME_REJECTED, nameAcceptable } from '../lib/names';
import { BRAND, COPY } from '../config/experiment';
import { Classifier } from '../components/Classifier';
import { LandingIntro } from '../components/LandingIntro';
import { DemoLinks } from './HomePage';
import { Button, Check, Constellation, ErrorText, Loading, Screen } from '../components/ui';

type Step = 'loading' | 'intro' | 'classify' | 'join' | 'joining' | 'message';
type JoinMode = 'confirm' | 'correct' | 'enter';

/**
 * Onboarding progress for one invitation, kept on this device so a refresh
 * returns to the same step (answered question, name choice, consent).
 */
interface Progress { answered?: boolean; mode?: JoinMode; name?: string; research?: boolean }
const progressKey = (token: string) => `px.join.${token}`;
const progress = {
  get(token: string): Progress {
    try { return JSON.parse(localStorage.getItem(progressKey(token)) || '{}'); } catch { return {}; }
  },
  set(token: string, p: Progress) {
    try { localStorage.setItem(progressKey(token), JSON.stringify({ ...progress.get(token), ...p })); } catch { /* ignore */ }
  },
  clear(token: string) {
    try { localStorage.removeItem(progressKey(token)); } catch { /* ignore */ }
  },
};

export function InvitePage({ token, session }: { token: string; session: Session | null }) {
  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<OpenResult | null>(null);
  const [message, setMessage] = useState<{ title: string; body?: string; cta?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [research, setResearch] = useState(false);
  const [joinMode, setJoinMode] = useState<JoinMode>('confirm');
  const [showData, setShowData] = useState(false);
  const [busy, setBusy] = useState(false);
  const accepting = useRef(false);

  const senderName = info?.sender_name || 'the person who invited you';

  // Invitees haven't unlocked anything: never show the company name here.
  useEffect(() => {
    document.title = BRAND.hidden;
  }, []);
  const signedIn = Boolean(session);

  const show = (title: string, body?: string, cta?: string) => {
    setMessage({ title, body, cta });
    setStep('message');
  };

  const accept = useCallback(
    async (p: { name: string; research: boolean }) => {
      if (accepting.current) return;
      accepting.current = true;
      setStep('joining');
      try {
        const r = await api.acceptInvitation(token, p.name, p.research, deviceId());
        pending.clear();
        progress.clear(token);
        navigate(r.state === 'already_participant' ? '/?already=1' : '/?welcome=1', true);
      } catch (e) {
        accepting.current = false;
        setError((e as Error).message);
        setStep('join');
      }
    },
    [token],
  );

  // Initial load (and re-run when the session changes).
  useEffect(() => {
    let alive = true;
    (async () => {
      let r: OpenResult;
      try {
        r = await api.openInvitation(token);
      } catch (e) {
        if (alive) show('Something went wrong.', (e as Error).message);
        return;
      }
      if (!alive) return;
      setInfo(r);
      if (r.state === 'rate_limited') return show('Give it a moment.', 'Too many visits from this network. Try again shortly.');
      if (r.state === 'invalid') return show('This link isn’t active.', 'Ask the person who sent it for a new one.');
      if (r.state === 'used')
        return show('This invitation has already been used.', 'Each link works once. Ask for a new one, or sign in if it was yours.', 'Sign in');
      if (r.state === 'own') return show('This is your invitation.', 'Send it to someone else — it works once.', 'Back to the experiment');
      if (r.state === 'joined') return navigate('/', true);

      if (session) {
        if (r.already_participant) return setStep(r.answered ? 'joining' : 'intro');
        const p = pendingFromSession(session, token);
        if (p && r.answered) return void accept(p);
        if (p) {
          setName(p.name);
          setResearch(p.research);
        }
        if (r.answered && progress.get(token).answered) restoreProgress();
        return setStep(r.answered && progress.get(token).answered ? 'join' : 'intro');
      }
      // Refresh mid-onboarding: go back to where this device left off. (The
      // invitation-level "answered" flag alone isn't enough: a forwarded copy
      // of the link may have been answered by someone else.)
      if (r.answered && progress.get(token).answered) {
        restoreProgress();
        return setStep('join');
      }
      setStep((s) => (s === 'loading' ? 'intro' : s));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, session?.user?.id]);

  // An existing participant who answered: record as a duplicate, no new node.
  useEffect(() => {
    if (step === 'joining' && info?.already_participant && session && !accepting.current) {
      void accept({ name: 'x', research: true });
    }
  }, [step, info, session, accept]);

  function restoreProgress() {
    const saved = progress.get(token);
    if (saved.mode) setJoinMode(saved.mode);
    if (saved.name) setName(saved.name);
    if (saved.research) setResearch(true);
  }

  // Remember the name choice and consent as they change (survives a refresh).
  useEffect(() => {
    if (step === 'join') progress.set(token, { mode: joinMode, name, research });
  }, [step, joinMode, name, research, token]);

  const onClassified = async (value: string, ms: number) => {
    try {
      await api.answerInvitation(token, value, ms);
      progress.set(token, { answered: true });
    } catch (e) {
      setError((e as Error).message);
    }
    if (session && info?.already_participant) return setStep('joining');
    setStep('join');
  };

  const invitedName = info?.invited_name ?? null;
  const mode: JoinMode = invitedName ? joinMode : 'enter';

  // "This invite wasn't meant for me": record it, don't accept, leave the link
  // open for the person it was meant for.
  const wrongRecipient = async () => {
    await api.reportWrongRecipient(token).catch(() => undefined);
    progress.clear(token);
    pending.clear();
    show(
      `This invitation is for ${invitedName}.`,
      `Ask ${info?.sender_name ?? 'the person who sent it'} for an invitation of your own.`,
    );
  };

  const submitJoin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Confirming uses the inviter's suggestion; otherwise the name they typed.
    const n = (mode === 'confirm' ? invitedName ?? '' : name).trim();
    if (!n) return setError('Please enter your first name.');
    if (!research) return setError('Please agree to take part in the research to continue.');
    // Check the name before creating anything; the server checks it again on join.
    setBusy(true);
    const nameOk = await nameAcceptable(n);
    setBusy(false);
    if (!nameOk) return setError(NAME_REJECTED);
    const p = { token, name: n, research, marketing: false };
    pending.set(p);
    if (signedIn) return void accept(p);
    // No account needed: an anonymous Supabase identity is created silently and
    // kept in this browser, so the participant can come back without signing in.
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.signInAnonymously({
        options: {
          captchaToken: await captchaToken(),
          data: { display_name: n, research_consent: true, invite_token: token },
        },
      });
      if (authError) throw new Error('We couldn’t start your session. Please try again.');
      await accept(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'loading' || step === 'joining') return <Loading />;

  if (step === 'message' && message) {
    return (
      <Screen className="center">
        <div className="stack fade-up text-center">
          <Constellation small />
          <h1 className="title">{message.title}</h1>
          {message.body && <p className="muted">{message.body}</p>}
          {message.cta && <Button onClick={() => navigate('/')}>{message.cta}</Button>}
          <DemoLinks />
        </div>
      </Screen>
    );
  }

  if (step === 'intro') {
    return (
      <Screen className="center landing">
        <LandingIntro senderName={info?.sender_name ?? null} onEnter={() => setStep('classify')} />
      </Screen>
    );
  }

  if (step === 'classify' && info?.method) {
    return (
      <Screen className="center">
        <p className="eyebrow fade-up">First, one question</p>
        <Classifier method={info.method} name={senderName} onSelect={onClassified} track={{ direction: 'inbound', token }} />
      </Screen>
    );
  }

  // join: confirm the invited name, correct it, or (seed links) enter one
  const senderFirst = info?.sender_name ?? null;
  return (
    <Screen className="center">
      <form className="stack join-form" onSubmit={submitJoin} data-mode={mode}>
        <header className="join-intro">
          <p className="stealth">
            <span className="stealth-dot" aria-hidden="true" />
            {COPY.joinEyebrow}
          </p>
          <h1 className="join-title">
            {mode === 'enter' ? COPY.joinSeedTitle : COPY.joinConfirmTitle(invitedName!)}
          </h1>
          <p className="muted join-body">
            {mode === 'enter' ? COPY.joinBody : COPY.joinConfirmBody(senderFirst)}
          </p>
        </header>
        <div className="join-fields stack">
          {mode !== 'confirm' && (
            <input
              key={mode}
              className={`input ${mode === 'correct' ? 'fade-up' : ''}`}
              placeholder={mode === 'correct' ? 'Your first name' : 'First name'}
              autoComplete="given-name"
              autoFocus={mode === 'correct'}
              value={name}
              maxLength={40}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              aria-label={mode === 'correct' ? 'Your first name' : 'First name'}
            />
          )}
          {session?.user.email && <p className="muted small">Signed in as {session.user.email}</p>}
          <div className="consents">
            <Check checked={research} onChange={setResearch}>
              {COPY.joinConsent}{' '}
              <button type="button" className="link inline" onClick={() => setShowData((v) => !v)}>
                How data is used
              </button>
            </Check>
            {showData && (
              <ul className="data-notes fade-up">
                {COPY.research.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
          <ErrorText error={error} />
          {mode === 'confirm' ? (
            <>
              {/* Enabled once the research consent is ticked. */}
              <Button type="submit" busy={busy} disabled={!research}>{COPY.joinConfirmYes}</Button>
              <Button variant="secondary" onClick={() => { setJoinMode('correct'); setName(''); setError(null); }}>
                {COPY.joinConfirmNo}
              </Button>
            </>
          ) : (
            <>
              {/* Enabled once there's a first name and the research consent is ticked. */}
              <Button type="submit" busy={busy} disabled={!name.trim() || !research}>Continue</Button>
              {mode === 'correct' && (
                <div className="row-links fade-up">
                  <button type="button" className="link" onClick={() => { setJoinMode('confirm'); setError(null); }}>
                    I’m {invitedName}
                  </button>
                  <button type="button" className="link" onClick={wrongRecipient}>{COPY.joinWrongPerson}</button>
                </div>
              )}
            </>
          )}
          <p className="fine text-center">{COPY.joinFooter}</p>
        </div>
      </form>
    </Screen>
  );
}
