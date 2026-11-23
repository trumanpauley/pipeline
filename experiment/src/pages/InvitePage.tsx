import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, type OpenResult } from '../lib/api';
import { navigate } from '../lib/router';
import { pending, pendingFromSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { deviceId } from '../lib/device';
import { captchaToken } from '../lib/captcha';
import { BRAND, COPY } from '../config/experiment';
import { Classifier } from '../components/Classifier';
import { COMFORT_QUESTION, ClosenessMeter, ScaleQuestion } from '../components/Relationship';
import { LandingIntro } from '../components/LandingIntro';
import { JoinForm, type Eligibility, type JoinFormState, type JoinMode, type JoinSubmit } from '../components/JoinForm';
import { DemoLinks } from './HomePage';
import { Button, Constellation, Loading, Screen } from '../components/ui';

type Step = 'loading' | 'intro' | 'classify' | 'closeness' | 'comfort' | 'join' | 'joining' | 'message';

/**
 * Onboarding progress for one invitation, kept on this device so a refresh
 * returns to the same step (answered question, name choice, consent).
 */
interface Progress { answered?: boolean; rated?: boolean; closeness?: number; mode?: JoinMode; name?: string; research?: boolean; category?: string; eligibility?: Eligibility }
/** Communities where everyone knows each other the same way skip "Where do you know them from?". */
const skipsQuestion = (r: OpenResult | null) => r?.experiment?.ask_relationship_question === false;

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

  // What the join form starts with (restored after a refresh, or from a sign-in).
  const [joinInitial, setJoinInitial] = useState<Partial<JoinFormState>>({});
  const [busy, setBusy] = useState(false);
  const accepting = useRef(false);
  // One open per visit (and per session change): React's dev mode runs effects
  // twice, which would otherwise log two opens.
  const opening = useRef<{ key: string; result: Promise<OpenResult> } | null>(null);

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
    async (p: { name: string; research: boolean; category?: string | null; eligible?: boolean | null }) => {
      if (accepting.current) return;
      accepting.current = true;
      setStep('joining');
      try {
        const r = await api.acceptInvitation(token, p.name, p.research, deviceId(), p.category, p.eligible);
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
        const key = `${token}:${session?.user?.id ?? ''}`;
        if (opening.current?.key !== key) opening.current = { key, result: api.openInvitation(token, deviceId()) };
        r = await opening.current.result;
      } catch (e) {
        if (alive) show('Something went wrong.', (e as Error).message);
        return;
      }
      if (!alive) return;
      setInfo(r);
      // Treated as a link preview / automated visitor: nothing personal is shown.
      if (r.state === 'preview') return show('You’ve been invited.', 'Open this link in your browser to begin.');
      if (r.state === 'rate_limited') return show('Give it a moment.', 'Too many visits from this network. Try again shortly.');
      if (r.state === 'invalid') return show('This link isn’t active.', 'Ask the person who sent it for a new one.');
      if (r.state === 'expired') return show('This invitation has expired.', 'Ask the person who sent it for a new one.');
      if (r.state === 'paused') return show('This experiment is paused.', 'Your invitation will work again when it reopens.');
      if (r.state === 'used')
        return show('This invitation has already been used.', 'Each link works once. Ask for a new one, or sign in if it was yours.', 'Sign in');
      if (r.state === 'own') return show('This is your invitation.', 'Send it to someone else — it works once.', 'Back to the experiment');
      if (r.state === 'joined') return navigate('/', true);
      // Anything unrecognised is treated as not valid: never start onboarding on it.
      if (r.state !== 'ok') return show('This link isn’t active.', 'Ask the person who sent it for a new one.');

      if (session) {
        if (r.already_participant) return setStep(r.answered ? 'joining' : 'intro');
        const p = pendingFromSession(session, token);
        if (p && (r.answered || skipsQuestion(r))) return void accept(p);
        if (p) setJoinInitial((j) => ({ ...j, name: p.name, research: p.research }));
        if ((r.answered || skipsQuestion(r)) && progress.get(token).answered) {
          restoreProgress();
          return setStep(afterAnswer());
        }
        return setStep('intro');
      }
      // Refresh mid-onboarding: go back to where this device left off. (The
      // invitation-level "answered" flag alone isn't enough: a forwarded copy
      // of the link may have been answered by someone else.)
      if ((r.answered || skipsQuestion(r)) && progress.get(token).answered) {
        restoreProgress();
        return setStep(afterAnswer());
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
    setJoinInitial({
      mode: saved.mode, name: saved.name, research: saved.research, category: saved.category, eligibility: saved.eligibility,
    });
  }

  const onClassified = async (value: string, ms: number) => {
    try {
      await api.answerInvitation(token, value, ms);
      progress.set(token, { answered: true });
    } catch (e) {
      setError((e as Error).message);
    }
    setStep('closeness');
  };

  /** Where to go once the relationship questions are done (or after a refresh). */
  function afterAnswer(): Step {
    if (!progress.get(token).rated) return 'closeness';
    return session && info?.already_participant ? 'joining' : 'join';
  }

  // Closeness (1–5), then comfort asking them for an introduction (1–5) unless
  // that was already their assigned question. Saved against this invitation.
  const [closeness, setCloseness] = useState<number | null>(null);
  const saveRating = async (c: number, comfort: number | null) => {
    try {
      await api.rateRelationship(token, c, comfort);
    } catch {
      /* never block joining on this; the server validates what it stores */
    }
    progress.set(token, { rated: true });
    setStep(session && info?.already_participant ? 'joining' : 'join');
  };
  const onCloseness = (c: number) => {
    setCloseness(c);
    progress.set(token, { closeness: c });
    // Comfort was already their assigned first question (unless that question is skipped here).
    if (info?.method === 'comfort' && !skipsQuestion(info)) return void saveRating(c, null);
    setStep('comfort');
  };

  const invitedName = info?.invited_name ?? null;

  // "This invite wasn't meant for me": record it, don't accept, leave the link
  // open for the person it was meant for.
  const wrongRecipient = async () => {
    await api.reportWrongRecipient(token).catch(() => undefined);
    progress.clear(token);
    pending.clear();
    show(
      `This invitation is for ${invitedName?.replace(/\.$/, '')}.`,
      `Ask ${info?.sender_name ?? 'the person who sent it'} for an invitation of your own.`,
    );
  };

  // The form has validated everything (name, group, eligibility, consent).
  const submitJoin = async (v: JoinSubmit) => {
    setError(null);
    const p = { token, name: v.name, research: v.research, marketing: false, category: v.category };
    pending.set(p);
    if (signedIn) return void accept({ ...p, eligible: v.eligible });
    // No account needed: an anonymous Supabase identity is created silently and
    // kept in this browser, so the participant can come back without signing in.
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.signInAnonymously({
        options: {
          captchaToken: await captchaToken(),
          data: { display_name: v.name, research_consent: true, invite_token: token },
        },
      });
      if (authError) throw new Error('We couldn’t start your session. Please try again.');
      await accept({ ...p, eligible: v.eligible });
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
        <LandingIntro
          senderName={info?.sender_name ?? null}
          onEnter={() => {
            if (!skipsQuestion(info)) return setStep('classify');
            progress.set(token, { answered: true });
            setStep('closeness');
          }}
        />
      </Screen>
    );
  }

  if (step === 'closeness') {
    return (
      <Screen className="question-screen">
        <p className="eyebrow fade-up">{skipsQuestion(info) ? 'Two quick questions' : 'One more'}</p>
        <div className="fade-up">
          <ClosenessMeter name={senderName} onConfirm={onCloseness} />
        </div>
      </Screen>
    );
  }

  if (step === 'comfort') {
    return (
      <Screen className="question-screen">
        <p className="eyebrow fade-up">Last one</p>
        <div className="fade-up">
          <ScaleQuestion
            testId="comfort"
            question={COMFORT_QUESTION(senderName)}
            low="Not at all"
            high="Completely"
            onSelect={(v) => void saveRating(closeness ?? progress.get(token).closeness ?? 0, v)}
          />
        </div>
      </Screen>
    );
  }

  if (step === 'classify' && info?.method) {
    return (
      <Screen className="question-screen">
        <p className="eyebrow fade-up">First, one question</p>
        <Classifier method={info.method} name={senderName} onSelect={onClassified} track={{ direction: 'inbound', token }} />
      </Screen>
    );
  }

  // join: the community's welcome, its membership question (if any), the
  // participant type, name and consent. Shared with the admin simulator.
  return (
    <Screen className="join-screen">
      <JoinForm
        experiment={info?.experiment}
        invitedName={invitedName}
        senderFirst={info?.sender_name ?? null}
        initial={joinInitial}
        onChange={(st) => { if (step === 'join') progress.set(token, st); }}
        onSubmit={submitJoin}
        onWrongRecipient={wrongRecipient}
        busy={busy}
        error={error}
        // Signed in already (e.g. joining a second experiment): say who, quietly. Otherwise nobody signs up.
        footer={session?.user.email ? `Signed in as ${session.user.email}` : COPY.joinFooter}
      />
    </Screen>
  );
}


