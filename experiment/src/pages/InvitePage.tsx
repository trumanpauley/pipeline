import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, type OpenResult } from '../lib/api';
import { navigate } from '../lib/router';
import { pending, pendingFromSession } from '../lib/session';
import { COPY } from '../config/experiment';
import { Classifier } from '../components/Classifier';
import { EmailCodeStep, isEmail, sendCode } from '../components/EmailAuth';
import { Button, Check, Constellation, ErrorText, Loading, Screen } from '../components/ui';

type Step = 'loading' | 'intro' | 'classify' | 'join' | 'code' | 'joining' | 'message';

export function InvitePage({ token, session }: { token: string; session: Session | null }) {
  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<OpenResult | null>(null);
  const [message, setMessage] = useState<{ title: string; body?: string; cta?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [research, setResearch] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [showData, setShowData] = useState(false);
  const [busy, setBusy] = useState(false);
  const accepting = useRef(false);

  const senderName = info?.sender_name || 'the person who invited you';
  const signedIn = Boolean(session);

  const show = (title: string, body?: string, cta?: string) => {
    setMessage({ title, body, cta });
    setStep('message');
  };

  const accept = useCallback(
    async (p: { name: string; research: boolean; marketing: boolean }) => {
      if (accepting.current) return;
      accepting.current = true;
      setStep('joining');
      try {
        const r = await api.acceptInvitation(token, p.name, p.research, p.marketing);
        pending.clear();
        navigate(r.state === 'already_participant' ? '/?already=1' : '/?welcome=1', true);
      } catch (e) {
        accepting.current = false;
        setError((e as Error).message);
        setStep('join');
      }
    },
    [token],
  );

  // Initial load (and re-run when the session appears after email verification).
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
          setMarketing(p.marketing);
        }
        return setStep(r.answered ? 'join' : 'intro');
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
      void accept({ name: 'x', research: true, marketing: false });
    }
  }, [step, info, session, accept]);

  const onClassified = async (value: string, ms: number) => {
    try {
      await api.answerInvitation(token, value, ms);
    } catch (e) {
      setError((e as Error).message);
    }
    if (session && info?.already_participant) return setStep('joining');
    setStep('join');
  };

  const submitJoin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    if (!n) return setError('Please enter your first name.');
    if (!research) return setError('Please agree to take part in the research to continue.');
    const p = { token, name: n, research, marketing };
    pending.set(p);
    if (signedIn) return void accept(p);
    if (!isEmail(email)) return setError('Enter a valid email.');
    setBusy(true);
    try {
      await sendCode(email, {
        invite_token: token,
        display_name: n,
        research_consent: true,
        marketing_consent: marketing,
      });
      setStep('code');
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
        </div>
      </Screen>
    );
  }

  if (step === 'intro') {
    return (
      <Screen className="center landing">
        <Constellation />
        <div className="stack text-center">
          <h1 className="display fade-up" style={{ animationDelay: '.5s' }}>{COPY.landingTitle}</h1>
          <p className="muted fade-up" style={{ animationDelay: '.8s' }}>{COPY.landingBody}</p>
        </div>
        <div className="landing-actions fade-up" style={{ animationDelay: '1.1s' }}>
          <Button onClick={() => setStep('classify')}>{COPY.landingCta}</Button>
          <p className="fine">{COPY.landingMeta} · Voluntary</p>
        </div>
      </Screen>
    );
  }

  if (step === 'classify' && info?.method) {
    return (
      <Screen className="center">
        <p className="eyebrow fade-up">First, one question</p>
        <Classifier method={info.method} name={senderName} onSelect={onClassified} />
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen className="center">
        <EmailCodeStep email={email.trim().toLowerCase()} onBack={() => setStep('join')} />
      </Screen>
    );
  }

  // join
  return (
    <Screen className="center">
      <form className="stack fade-up" onSubmit={submitJoin}>
        <p className="eyebrow">Thanks. Now it’s your turn.</p>
        <h1 className="title">Invite two people. Find out what this is.</h1>
        <input
          className="input"
          placeholder="First name"
          autoComplete="given-name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          aria-label="First name"
        />
        {signedIn ? (
          <p className="muted small">Signed in as {session?.user.email}</p>
        ) : (
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
          />
        )}
        <div className="consents">
          <Check checked={research} onChange={setResearch}>
            I agree to take part in this research.{' '}
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
          <Check checked={marketing} onChange={setMarketing}>
            Email me about Pipeline. Optional.
          </Check>
        </div>
        <ErrorText error={error} />
        <Button type="submit" busy={busy}>
          {signedIn ? 'Join' : 'Continue'}
        </Button>
        <p className="fine text-center">Your name is shown only to people you invite.</p>
      </form>
    </Screen>
  );
}
