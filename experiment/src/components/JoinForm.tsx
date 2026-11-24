import { useEffect, useState, type FormEvent } from 'react';
import type { ExperimentInfo } from '../lib/api';
import { NAME_FORMAT_HELP, NAME_REJECTED, formatName, nameAcceptable } from '../lib/names';
import { COPY } from '../config/experiment';
import { TypedHint } from './TypedHint';
import { Button, Check, ErrorText } from './ui';

export type JoinMode = 'confirm' | 'correct' | 'enter';
export type Eligibility = '' | 'yes' | 'no';

/** Everything the form remembers (the invitation page saves it so a refresh keeps it). */
export interface JoinFormState {
  mode: JoinMode;
  name: string;
  research: boolean;
  category: string;
  eligibility: Eligibility;
}

export interface JoinSubmit {
  name: string;
  research: boolean;
  category: string | null;
  /** null when the experiment doesn't screen. */
  eligible: boolean | null;
}

/**
 * The join screen: "And you are?" (or "Are you Sam K.?"), the community's optional
 * membership question, the participant type, first name + last initial, and
 * research consent. Used by the invitation page and, unchanged, by the admin
 * simulator (which passes `preview` so nothing is checked against the server).
 */
export function JoinForm({
  experiment,
  invitedName,
  initial,
  onChange,
  onSubmit,
  onWrongRecipient,
  busy = false,
  error,
  footer,
  preview = false,
}: {
  experiment?: ExperimentInfo | null;
  /** The name the inviter gave (seed links: none). */
  invitedName: string | null;
  /** Who sent the invitation (kept for callers; not shown on this screen). */
  senderFirst?: string | null;
  initial?: Partial<JoinFormState>;
  onChange?: (s: JoinFormState) => void;
  onSubmit: (v: JoinSubmit) => void | Promise<void>;
  onWrongRecipient?: () => void;
  busy?: boolean;
  /** An error from the page (e.g. the server refused). */
  error?: string | null;
  footer?: string;
  preview?: boolean;
}) {
  const [joinMode, setJoinMode] = useState<JoinMode>(initial?.mode ?? 'confirm');
  const [name, setName] = useState(initial?.name ?? '');
  const [research, setResearch] = useState(Boolean(initial?.research));
  const [category, setCategory] = useState(initial?.category ?? '');
  const [eligibility, setEligibility] = useState<Eligibility>(initial?.eligibility ?? '');
  const [showAbout, setShowAbout] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // The typed name instruction starts on the first tap in the field, or after 3s.
  const [nameFocused, setNameFocused] = useState(false);
  const [hintTimeUp, setHintTimeUp] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setHintTimeUp(true), 3000);
    return () => window.clearTimeout(t);
  }, []);

  // Links from before "First L." names may carry a first name only: the
  // recipient then adds their initial (the name field starts filled in).
  const invitedComplete = invitedName ? formatName(invitedName) : null;
  const mode: JoinMode = invitedName ? (invitedComplete ? joinMode : 'correct') : 'enter';
  useEffect(() => {
    if (invitedName && !invitedComplete && !name) setName(`${invitedName} `);
  }, [invitedName, invitedComplete, name]);

  useEffect(() => {
    onChange?.({ mode: joinMode, name, research, category, eligibility });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinMode, name, research, category, eligibility]);

  const categories = experiment?.categories ?? [];
  const screening = experiment?.eligibility ?? null;
  // With a membership question, the rest appears once it's answered "yes".
  const eligibleSoFar = !screening || eligibility === 'yes';
  const ineligible = Boolean(screening) && eligibility === 'no';
  const ready = eligibleSoFar && research && (categories.length === 0 || Boolean(category))
    && (mode === 'confirm' || Boolean(name.trim()));
  const shownError = localError ?? error ?? null;
  const setErr = (e: string | null) => setLocalError(e);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (screening && eligibility !== 'yes') return setErr('Please answer the question above.');
    const n = formatName(mode === 'confirm' ? invitedName ?? '' : name);
    if (!n) return setErr(NAME_FORMAT_HELP);
    if (categories.length && !category) return setErr('Choose the option that describes you.');
    if (!research) return setErr('Please agree to take part in the research to continue.');
    if (!preview) {
      // Check the name before creating anything; the server checks it again on join.
      setChecking(true);
      const ok = await nameAcceptable(n);
      setChecking(false);
      if (!ok) return setErr(NAME_REJECTED);
    }
    if (mode !== 'confirm') setName(n);
    await onSubmit({ name: n, research, category: categories.length ? category : null, eligible: screening ? true : null });
  };

  return (
    <form className="join-form" onSubmit={submit} data-mode={mode} data-eligibility={eligibility || 'unanswered'}>
      <header className="join-intro">
        <h1 className="join-title">{mode === 'enter' ? COPY.joinSeedTitle : COPY.joinConfirmTitle(invitedName!)}</h1>
        {/* Just the title: the invitation itself already said who it's from and what it's about. */}
      </header>

      <div className="join-fields">
        {screening && (
          <div className="join-question">
            <p className="join-q-label" id="eligibility-q">{screening.question}</p>
            <Segmented
              label={screening.question}
              labelledBy="eligibility-q"
              options={[
                { value: 'yes', label: screening.eligible_label },
                { value: 'no', label: screening.ineligible_label },
              ]}
              value={eligibility}
              onChange={(v) => { setEligibility(v as Eligibility); setErr(null); }}
            />
          </div>
        )}

        {ineligible ? (
          <p className="join-ineligible fade-up" role="status">{screening!.ineligible_message}</p>
        ) : (
          eligibleSoFar && (
            <>
              {categories.length > 0 && (
                <div className={`join-question ${screening ? 'fade-up' : ''}`}>
                  {screening && <p className="join-q-label" id="category-q">{COPY.categoryQuestion}</p>}
                  <Segmented
                    label={COPY.categoryQuestion}
                    labelledBy={screening ? 'category-q' : undefined}
                    options={categories.map((c) => ({ value: c, label: c }))}
                    value={category}
                    onChange={(v) => { setCategory(v); setErr(null); }}
                  />
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
                    onChange={(e) => { setName(e.target.value); setErr(null); }}
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
                    onClick={(e) => { e.preventDefault(); setShowAbout(true); }}
                  >
                    Details
                  </button>
                </Check>
                <AboutDisclosure open={showAbout} onToggle={setShowAbout} />
              </div>

              <ErrorText error={shownError} />

              <div className="join-actions">
                {mode === 'confirm' ? (
                  <>
                    <Button type="submit" busy={busy || checking} disabled={!ready}>{COPY.joinConfirmYes}</Button>
                    <Button variant="secondary" onClick={() => { setJoinMode('correct'); setName(''); setErr(null); }}>
                      {COPY.joinConfirmNo}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="submit" busy={busy || checking} disabled={!ready}>Continue</Button>
                    {mode === 'correct' && (
                      <div className="row-links fade-up">
                        {invitedComplete && (
                          <button type="button" className="link" onClick={() => { setJoinMode('confirm'); setErr(null); }}>
                            I’m {invitedName}
                          </button>
                        )}
                        {onWrongRecipient && (
                          <button type="button" className="link" onClick={onWrongRecipient}>{COPY.joinWrongPerson}</button>
                        )}
                      </div>
                    )}
                  </>
                )}
                {footer && <p className="fine text-center join-footer">{footer}</p>}
              </div>
            </>
          )
        )}
      </div>
    </form>
  );
}

/**
 * Two (or a few) clear choices with visible edges, none chosen at first. The
 * chosen one turns white with dark text.
 */
function Segmented({
  label,
  labelledBy,
  options,
  value,
  onChange,
}: {
  label: string;
  labelledBy?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      style={{ ['--n' as string]: options.length }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-selected' : ''}
          onClick={() => onChange(o.value)}
        >
          {/* allow a line break after "/" ("alumnus/alumna") on narrow screens */}
          {o.label.split('/').map((part, i, all) => (
            <span key={i}>{part}{i < all.length - 1 && <>/<wbr /></>}</span>
          ))}
        </button>
      ))}
    </div>
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
