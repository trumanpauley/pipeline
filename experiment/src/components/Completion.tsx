import { useState, type FormEvent } from 'react';
import { api, type ExperimentInfo, type MyAccount, type MyState } from '../lib/api';
import { LANDING_LINK } from '../config/experiment';
import { isEmail } from './EmailAuth';
import { InviteSheet } from './Invitations';
import { Button, Check, ErrorText } from './ui';

const RESEARCH_TEXT = 'I’m interested in participating in future Pipeline experiments.';
const PRIVACY =
  'We’ll only use your email for Pipeline early access and, if you tick the box, invitations to future experiments. It’s never shown to anyone. No account is created, and you can unsubscribe anytime from “Your data”.';
const FEEDBACK_PRIVACY =
  'We don’t attach your name or participant ID to feedback. We keep only the text, which group it came from, and the week it was sent. If you add an email it’s only used to follow up on this feedback, and doesn’t join you to Pipeline updates.';

/** The thank-you line: the admin's own message, else one that names the community. */
export const thankYou = (exp?: ExperimentInfo | null) =>
  exp?.completion_message?.trim() ||
  (exp?.community_name?.trim()
    ? `Thank you for helping us better understand the ${exp.community_name.trim()} network.`
    : 'Thank you for helping us better understand how people are connected.');

/**
 * Shown when a participant has finished the experiment (after the second
 * invitation, or after the "answer one question instead" skip), and reachable
 * later from the home screen. This is where community-first wording hands over to Pipeline.
 *
 *  - It says plainly that the experiment is complete: everything else is optional.
 *  - "Explore Pipeline" links to the public site with a non-identifying
 *    ?source=experiment tag. No name, link token or experiment id is ever in the URL.
 *  - "Invite someone else" (when the experiment allows it) reuses the invitation sheet to make one
 *    individual link at a time. Extra invitations never change completion status.
 *  - "Help us improve" sends optional feedback that isn't linked to the participant.
 *  - Early access is optional and never pre-selected. Joining goes through the same server function
 *    as before (join_community). Someone who already opted in to updates isn't asked again.
 */
export function CompletionOverlay({
  account,
  state,
  onClose,
  onSkip,
  onChanged,
}: {
  account: MyAccount | null;
  state: MyState | null;
  /** changed: a signup was saved. */
  onClose: (changed: boolean) => void;
  /** "Back to my network" without signing up (the server remembers, so this screen doesn't pop up again). */
  onSkip: () => void;
  /** Something the home screen shows has changed (extra invitations). */
  onChanged?: () => void;
}) {
  const exp = state?.experiment ?? null;
  const current = account?.community ?? null;
  const alreadyIn = Boolean(current?.subscribed && current.updates);
  const researchText = account?.community_consent_texts?.research_invites ?? RESEARCH_TEXT;
  const waitlistOn = exp?.enable_waitlist !== false;
  const feedbackOn = exp?.enable_feedback === true;
  const additional = state?.additional;
  const canInvite = Boolean(exp?.allow_additional_invites && additional?.allowed);

  const [email, setEmail] = useState(current?.email ?? '');
  const [research, setResearch] = useState(false);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const clean = email.trim().toLowerCase();

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEmail(clean)) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      await api.joinCommunity(clean, research, true);
      setJoined(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onList = alreadyIn || joined;

  return (
    <>
      <div className="waitlist-overlay completion" role="dialog" aria-modal="true" aria-label="Experiment complete">
        <div className="reveal-glow" aria-hidden="true" />
        <div className="waitlist-inner">
          <div className="stack">
            <img className="completion-logo fade-up" src="/logo.svg" alt="Pipeline" height={30} />
            <p className="complete-pill fade-up" style={{ animationDelay: '.15s' }} data-testid="completion-pill">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Experiment complete
            </p>
            <p className="completion-thanks fade-up" style={{ animationDelay: '.3s' }}>{thankYou(exp)}</p>

            <div className="completion-pipeline fade-up" style={{ animationDelay: '.45s' }}>
              <h1 className="display small">Your network already exists.<br />Find where it leads.</h1>
              <p className="muted">
                We’re building Pipeline to help people discover and navigate the networks they already belong to.
              </p>
            </div>

            <div className="stack fade-up" style={{ animationDelay: '.6s' }}>
              <a className="btn btn-primary" href={LANDING_LINK} rel="noopener">Explore Pipeline</a>

              {canInvite && (
                <div className="completion-invite">
                  <p className="fine text-center">Know someone else who should be part of this?</p>
                  <Button variant="secondary" onClick={() => setInviting(true)}>Invite someone else</Button>
                  {(additional?.created ?? 0) > 0 && (
                    <p className="fine text-center" data-testid="additional-count">
                      {additional!.created} invited{additional!.joined ? ` · ${additional!.joined} joined` : ''}
                    </p>
                  )}
                </div>
              )}

              {feedbackOn && <FeedbackSection />}

              {waitlistOn && (onList ? (
                <p className="fine text-center" data-testid="completion-on-list">
                  You’re on the early-access list{current?.email && !joined ? ` as ${current.email}` : ''}. We’ll be in touch.
                </p>
              ) : (
                <form className="stack completion-form" onSubmit={join} noValidate>
                  <p className="eyebrow">Early access · optional</p>
                  <input
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="Your email"
                    value={email}
                    maxLength={254}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    aria-label="Email address"
                  />
                  <div className="consents">
                    <Check checked={research} onChange={setResearch}>{researchText}</Check>
                  </div>
                  <ErrorText error={error} />
                  <Button type="submit" variant="secondary" busy={busy} disabled={!clean}>Join Early Access</Button>
                  <p className="fine text-center">{PRIVACY}</p>
                </form>
              ))}

              <button type="button" className="link center-link" onClick={() => (onList || !waitlistOn ? onClose(joined) : onSkip())}>
                Back to my network
              </button>
            </div>
          </div>
        </div>
      </div>
      {inviting && state?.participant && (
        <InviteSheet
          additional
          method={state.participant.method}
          first={false}
          instruction={exp?.invite_instruction ?? null}
          share={{ slug: exp?.slug, message: exp?.forward_message }}
          onClose={() => {
            // Back to this page; the count refreshes.
            setInviting(false);
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

/** "Help us improve": a quiet, expandable box. Optional; nothing about the participant is sent with it. */
function FeedbackSection() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [talk, setTalk] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!text.trim()) return;
    if (talk && !isEmail(email.trim())) return setError('Enter a valid email address, or untick the box.');
    setBusy(true);
    try {
      await api.submitExperimentFeedback(text, talk, talk ? email.trim().toLowerCase() : null);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <p className="fine text-center" role="status" data-testid="feedback-thanks">Thank you. Your feedback helps us improve.</p>;
  }
  return (
    <div className="completion-feedback">
      <button
        type="button"
        className="link center-link"
        aria-expanded={open}
        aria-controls="completion-feedback-form"
        onClick={() => setOpen((v) => !v)}
      >
        Help us improve
      </button>
      {open && (
        <form id="completion-feedback-form" className="stack fade-up" onSubmit={submit} noValidate>
          <label className="completion-feedback-label">
            What could we do better?
            <textarea
              className="input textarea"
              rows={4}
              maxLength={2000}
              value={text}
              placeholder="Anything confusing, frustrating, or worth changing?"
              onChange={(e) => setText(e.target.value)}
              aria-label="What could we do better?"
            />
          </label>
          <div className="consents">
            <Check checked={talk} onChange={setTalk}>I’m open to discussing my feedback.</Check>
          </div>
          {talk && (
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Your email"
              value={email}
              maxLength={254}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              aria-label="Email for feedback follow-up"
            />
          )}
          <ErrorText error={error} />
          <Button type="submit" variant="secondary" busy={busy} disabled={!text.trim()}>Send feedback</Button>
          <p className="fine text-center">{FEEDBACK_PRIVACY}</p>
        </form>
      )}
    </div>
  );
}
