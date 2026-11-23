import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, type OpenResult } from '../lib/api';
import { navigate } from '../lib/router';
import { pending, pendingFromSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { deviceId } from '../lib/device';
import { captchaToken } from '../lib/captcha';
import { NAME_FORMAT_HELP, NAME_REJECTED, formatName, nameAcceptable } from '../lib/names';
import { BRAND, COPY } from '../config/experiment';
import { Classifier } from '../components/Classifier';
import { COMFORT_QUESTION, ClosenessMeter, ScaleQuestion } from '../components/Relationship';
import { LandingIntro } from '../components/LandingIntro';
import { TypedHint } from '../components/TypedHint';
import { DemoLinks } from './HomePage';
import { Button, Check, Constellation, ErrorText, Loading, Screen } from '../components/ui';

type Step = 'loading' | 'intro' | 'classify' | 'closeness' | 'comfort' | 'join' | 'joining' | 'message';
type JoinMode = 'confirm' | 'correct' | 'enter';

/**
 * Onboarding progress for one invitation, kept on this device so a refresh
 * returns to the same step (answered question, name choice, consent).
 */
interface Progress { answered?: boolean; rated?: boolean; closeness?: number; mode?: JoinMode; name?: string; research?: boolean; category?: string }
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
  const [category, setCategory] = useState('');
  // The typed instruction starts the first time the name field is focused, or
  // on its own after a few seconds on the name screen, whichever comes first.
  const [nameFocused, setNameFocused] = useState(false);
  const [hintTimeUp, setHintTimeUp] = useState(false);
  useEffect(() => {
    if (step !== 'join' || hintTimeUp) return;
    const t = window.setTimeout(() => setHintTimeUp(true), 3000);
    return () => window.clearTimeout(t);
  }, [step, hintTimeUp]);
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
    async (p: { name: string; research: boolean; category?: string | null }) => {
      if (accepting.current) return;
      accepting.current = true;
      setStep('joining');
      try {
        const r = await api.acceptInvitation(token, p.name, p.research, deviceId(), p.category);
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
        if (p && r.answered) return void accept(p);
        if (p) {
          setName(p.name);
          setResearch(p.research);
        }
        if (r.answered && progress.get(token).answered) {
          restoreProgress();
          return setStep(afterAnswer());
        }
        return setStep('intro');
      }
      // Refresh mid-onboarding: go back to where this device left off. (The
      // invitation-level "answered" flag alone isn't enough: a forwarded copy
      // of the link may have been answered by someone else.)
      if (r.answered && progress.get(token).answered) {
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
    if (saved.mode) setJoinMode(saved.mode);
    if (saved.name) setName(saved.name);
    if (saved.research) setResearch(true);
    if (saved.category) setCategory(saved.category);
  }

  // Remember the name choice and consent as they change (survives a refresh).
  useEffect(() => {
    if (step === 'join') progress.set(token, { mode: joinMode, name, research, category });
  }, [step, joinMode, name, research, category, token]);

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
    if (info?.method === 'comfort') return void saveRating(c, null);
    setStep('comfort');
  };

  const invitedName = info?.invited_name ?? null;
  // Links from before "First L." names may carry a first name only: the
  // recipient then adds their initial (the name field starts filled in).
  const invitedComplete = invitedName ? formatName(invitedName) : null;
  const mode: JoinMode = invitedName ? (invitedComplete ? joinMode : 'correct') : 'enter';
  const categories = info?.experiment?.categories ?? [];
  useEffect(() => {
    if (step === 'join' && invitedName && !invitedComplete && !name) setName(`${invitedName} `);
  }, [step, invitedName, invitedComplete, name]);

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

  const submitJoin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Confirming uses the inviter's suggestion; otherwise the name they typed.
    const n = formatName(mode === 'confirm' ? invitedName ?? '' : name);
    if (!n) return setError(NAME_FORMAT_HELP);
    if (categories.length && !category) return setError('Choose the option that describes you.');
    if (!research) return setError('Please agree to take part in the research to continue.');
    // Check the name before creating anything; the server checks it again on join.
    setBusy(true);
    const nameOk = await nameAcceptable(n);
    setBusy(false);
    if (!nameOk) return setError(NAME_REJECTED);
    if (mode !== 'confirm') setName(n);
    const p = { token, name: n, research, marketing: false, category: categories.length ? category : null };
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

  if (step === 'closeness') {
    return (
      <Screen className="question-screen">
        <p className="eyebrow fade-up">One more</p>
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

  // join: confirm the invited name, correct it, or (seed links) enter one
  const senderFirst = info?.sender_name ?? null;
  const ready = research && (categories.length === 0 || Boolean(category)) && (mode === 'confirm' || Boolean(name.trim()));
  return (
    <Screen className="join-screen">
      <form className="join-form" onSubmit={submitJoin} data-mode={mode}>
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

        <div className="join-fields">
          {categories.length > 0 && (
            <div
              className="segmented"
              role="radiogroup"
              aria-label={COPY.categoryQuestion}
              style={{ ['--n' as string]: categories.length }}
            >
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={category === c}
                  className={category === c ? 'is-selected' : ''}
                  onClick={() => { setCategory(c); setError(null); }}
                >
                  {/* allow a line break after "/" ("alumnus/alumna") on narrow screens */}
                  {c.split('/').map((part, i, all) => (
                    <span key={i}>{part}{i < all.length - 1 && <>/<wbr /></>}</span>
                  ))}
                </button>
              ))}
            </div>
          )}

          {mode !== 'confirm' && (
            <div className="name-field">
              <TypedHint id="name-hint" text={COPY.nameInstruction} start={nameFocused || hintTimeUp} />
              <input
                key={mode}
                className={`input ${mode === 'correct' ? 'fade-up' : ''}`}
                placeholder={COPY.namePlaceholder}
                autoComplete="name"
                autoCapitalize="words"
                autoFocus={mode === 'correct'}
                enterKeyHint="go"
                value={name}
                maxLength={40}
                onFocus={() => setNameFocused(true)}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                aria-label="First name and last initial"
                aria-describedby="name-hint"
              />
            </div>
          )}

          <div className="join-consent consents">
            <Check checked={research} onChange={setResearch}>
              <span className="consent-text">{COPY.joinConsent}</span>{' '}
              <button
                type="button"
                className="link inline"
                aria-controls="join-about"
                onClick={(e) => { e.preventDefault(); setShowData(true); }}
              >
                Details
              </button>
            </Check>
            <AboutDisclosure open={showData} onToggle={setShowData} />
          </div>

          <ErrorText error={error} />

          <div className="join-actions">
            {mode === 'confirm' ? (
              <>
                {/* Enabled once the research consent is ticked (and the group chosen, if asked). */}
                <Button type="submit" busy={busy} disabled={!ready}>{COPY.joinConfirmYes}</Button>
                <Button variant="secondary" onClick={() => { setJoinMode('correct'); setName(''); setError(null); }}>
                  {COPY.joinConfirmNo}
                </Button>
              </>
            ) : (
              <>
                {/* Enabled once there's a name (and group, if asked) and the research consent is ticked. */}
                <Button type="submit" busy={busy} disabled={!ready}>Continue</Button>
                {mode === 'correct' && (
                  <div className="row-links fade-up">
                    {invitedComplete && (
                      <button type="button" className="link" onClick={() => { setJoinMode('confirm'); setError(null); }}>
                        I’m {invitedName}
                      </button>
                    )}
                    <button type="button" className="link" onClick={wrongRecipient}>{COPY.joinWrongPerson}</button>
                  </div>
                )}
              </>
            )}
            {/* Signed in already (e.g. joining a second experiment): say who, quietly. Otherwise nobody signs up. */}
            <p className="fine text-center join-footer">
              {session?.user.email ? `Signed in as ${session.user.email}` : COPY.joinFooter}
            </p>
          </div>
        </div>
      </form>
    </Screen>
  );
}

/**
 * The full research and privacy disclosure, collapsed by default. The consent
 * checkbox covers everything here, and its "Details" link opens it.
 */
function AboutDisclosure({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details
      id="join-about"
      className="about"
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        {COPY.aboutTitle}
        <svg className="about-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="about-body">
        {COPY.about.map((sec) => (
          <section key={sec.title}>
            <h2>{sec.title}</h2>
            <ul>
              {sec.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

