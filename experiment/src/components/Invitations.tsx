import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, inviteUrl, shareText, type MyInvitation } from '../lib/api';
import { COPY } from '../config/experiment';
import { Classifier } from './Classifier';
import { Button, ErrorText, Sheet } from './ui';
import { NAME_REJECTED, formatName, nameAcceptable } from '../lib/names';

// What each invitation unlocks, in order.
const UNLOCKS = ['Our name', 'Our mission'];

// ---------- sharing ----------

export async function copyText(text: string) {
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

/** How this experiment's invitations are shared: its link name and the participant's message. */
export interface ShareSettings {
  slug?: string | null;
  /** The experiment's forwarding message (empty = the generic line). */
  message?: string | null;
}
const messageFor = (share?: ShareSettings) => share?.message?.trim() || COPY.shareText;

/**
 * Share (native sheet: the person picks the app and sends it themselves) or
 * copy the message and link, and record the *intent* to share. The record is
 * written before the share sheet opens: tapping Share counts even if it's then
 * cancelled, and nothing here claims the link was actually received. Nothing
 * is ever sent automatically.
 */
async function shareOrCopy(inv: { id: string; url: string }, how: 'share' | 'copy', message: string) {
  const native = how === 'share' && typeof navigator.share === 'function';
  const marked = api.markShared(inv.id, native ? 'share' : 'copy').catch(() => null);
  if (native) {
    try {
      await navigator.share({ text: message, url: inv.url });
    } catch {
      /* cancelled — still counts as initiating a share */
    }
  } else {
    // Desktop and browsers without sharing: the whole message, ready to paste.
    await copyText(shareText(message, inv.url));
  }
  await marked;
  return native ? 'shared' : 'copied';
}

// ---------- the two invitation cards ----------

/**
 * Ready → Pending → Opened → Connected.
 *  Pending: the inviter tapped Share/Copy. A website can't confirm a text or
 *  iMessage was delivered, so this only means sharing was started.
 *  Opened: a person (not a link preview, not the sender) opened the link.
 *  Connected: they finished joining.
 */
export const STATUS = (inv: MyInvitation) =>
  inv.status === 'accepted'
    ? { key: 'connected', label: 'Connected', tone: 'done' }
    : inv.status === 'opened'
      ? { key: 'opened', label: 'Opened', tone: 'warm' }
      : inv.shared_at
        ? { key: 'pending', label: 'Pending', tone: 'idle' }
        : { key: 'ready', label: 'Ready', tone: 'quiet' };

export function InviteSlots({
  invitations,
  max,
  level,
  onInvite,
  onChanged,
  share,
}: {
  invitations: MyInvitation[];
  max: number;
  level: number;
  onInvite: () => void;
  onChanged: () => void;
  share?: ShareSettings;
}) {
  const slots = Array.from({ length: max }, (_, i) => invitations[i] ?? null);
  const firstEmpty = slots.findIndex((s) => s === null);

  return (
    <section className="invite-slots" aria-label="Your invitations">
      {slots.map((inv, i) =>
        inv ? (
          <FilledSlot key={inv.id} inv={inv} index={i} level={level} onChanged={onChanged} share={share} />
        ) : (
          <EmptySlot
            key={`slot-${i}`}
            index={i}
            // A later invitation unlocks once the previous one has been shared
            // (which is also what unlocks the previous reveal).
            unlocked={i === 0 || level >= i}
            actionable={i === firstEmpty}
            onInvite={onInvite}
          />
        ),
      )}
    </section>
  );
}

function EmptySlot({
  index,
  unlocked,
  actionable,
  onInvite,
}: {
  index: number;
  unlocked: boolean;
  actionable: boolean;
  onInvite: () => void;
}) {
  // Play the unlock shimmer only when this card changes from locked to open.
  const wasLocked = useRef(!unlocked);
  const [justUnlocked, setJustUnlocked] = useState(false);
  useEffect(() => {
    if (unlocked && wasLocked.current) {
      setJustUnlocked(true);
      const t = window.setTimeout(() => setJustUnlocked(false), 1400);
      wasLocked.current = false;
      return () => window.clearTimeout(t);
    }
    if (!unlocked) wasLocked.current = true;
  }, [unlocked]);

  const open = unlocked && actionable;
  const title = open || index === 0 ? 'Invite someone' : index === 1 ? 'Second invitation' : 'Another invitation';
  return (
    <button
      type="button"
      className={`invite-card ${open ? 'is-open' : 'is-locked'} ${justUnlocked ? 'just-unlocked' : ''}`}
      onClick={open ? onInvite : undefined}
      disabled={!open}
      aria-label={`${title}. Unlock ${index + 1}: ${UNLOCKS[index] ?? ''}${open ? '' : ' (locked)'}`}
    >
      <span className="invite-glyph" aria-hidden="true">
        {open ? (
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16"><rect x="5.5" y="10.5" width="13" height="9" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        )}
      </span>
      <span className="invite-text">
        <strong>{title}</strong>
        <small>Unlock {index + 1} — {UNLOCKS[index] ?? 'More'}</small>
      </span>
    </button>
  );
}

function FilledSlot({
  inv,
  index,
  level,
  onChanged,
  share,
}: {
  inv: MyInvitation;
  index: number;
  level: number;
  onChanged: () => void;
  share?: ShareSettings;
}) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(inv.token, share?.slug);
  const st = STATUS(inv);
  // A soft pulse on the status dot when it changes while the card is on screen.
  const lastStatus = useRef(st.key);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (lastStatus.current === st.key) return;
    lastStatus.current = st.key;
    setChanged(true);
    const t = window.setTimeout(() => setChanged(false), 1600);
    return () => window.clearTimeout(t);
  }, [st.key]);
  const act = async (how: 'share' | 'copy') => {
    const r = await shareOrCopy({ id: inv.id, url }, how, messageFor(share));
    if (r === 'copied') {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
    onChanged();
  };
  const remove = async () => {
    if (!window.confirm('Remove this link? It will stop working and frees the slot.')) return;
    await api.revokeInvitation(inv.id);
    onChanged();
  };
  const awaitingShare = !inv.shared_at && inv.status === 'created' && level <= index;
  return (
    <div className={`invite-card is-filled status-${inv.status} ${inv.shared_at ? 'is-shared' : ''}`}>
      <span className="invite-glyph is-avatar" aria-hidden="true">
        {(inv.recipient_label || '?').trim().charAt(0).toUpperCase()}
      </span>
      <span className="invite-text">
        <strong>{inv.recipient_label || 'Invitation'}</strong>
        <span className={`pill tone-${st.tone} ${changed ? 'is-changed' : ''}`} data-status={st.key} aria-live="polite"><i />{st.label}</span>
      </span>
      {inv.status !== 'accepted' && (
        <div className="invite-actions">
          {awaitingShare && <p className="invite-hint">Share to unlock {UNLOCKS[index]?.toLowerCase()}</p>}
          <button className="chip" onClick={() => act('share')}>Share</button>
          <button className="chip" onClick={() => act('copy')} aria-label={`Copy the message and link for ${inv.recipient_label || 'this invitation'}`}>{copied ? 'Copied' : 'Copy'}</button>
          <button className="chip ghost" onClick={remove} aria-label={`Remove ${inv.recipient_label || 'this'} link`}>×</button>
        </div>
      )}
    </div>
  );
}

// ---------- invite flow ----------

export function InviteSheet({
  method,
  first,
  instruction,
  askRelationship = true,
  additional = false,
  share,
  onClose,
}: {
  /**
   * A voluntary extra invitation after completing the experiment: always asks the 0–100
   * "how well do you know them" slider, never counts toward the two standard invitations.
   */
  additional?: boolean;
  share?: ShareSettings;
  method: string;
  first: boolean;
  /** false: the experiment skips "Where do you know them from?"; the link is made right after the name. */
  askRelationship?: boolean;
  /** The experiment's invitation instruction, e.g. "Invite two Harvard students or alumni." */
  instruction?: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'who' | 'classify' | 'ready'>('who');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const create = async (value: string | null, ms: number, label = name.trim()) => {
    try {
      if (additional) {
        const x = await api.createAdditionalInvitation(value ?? '', label);
        if (x.error || !x.id || !x.token) {
          setError(x.error === 'invalid_name_format' ? 'Enter their first name and last initial, like “Sarah M.”' : NAME_REJECTED);
          setStep('who');
          return;
        }
        setInvite({ id: x.id, url: inviteUrl(x.token, share?.slug) });
        setStep('ready');
        return;
      }
      const r = await api.createInvitation(value, label, ms);
      setInvite({ id: r.id, url: inviteUrl(r.token, share?.slug) });
      setStep('ready');
    } catch (e) {
      setError((e as Error).message);
      setStep('who');
    }
  };

  const act = async (how: 'share' | 'copy') => {
    if (!invite) return;
    const r = await shareOrCopy(invite, how, messageFor(share));
    if (r === 'copied') setCopied(true);
    setShared(true);
  };

  const [checking, setChecking] = useState(false);
  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const formatted = formatName(name);
    if (!formatted) return setError('Enter their first name and last initial, like “Sarah M.”');
    setName(formatted);
    setChecking(true);
    const ok = await nameAcceptable(formatted);
    setChecking(false);
    if (!ok) return setError(NAME_REJECTED);
    if (!askRelationship && !additional) {
      setChecking(true);
      await create(null, 0, formatted);
      setChecking(false);
      return;
    }
    setStep('classify');
  };

  return (
    <Sheet onClose={onClose}>
      {step === 'who' && (
        <form className="stack fade-up" onSubmit={submitName}>
          <h2 className="title">{additional ? 'Who else should be part of this?' : first ? 'Who will you invite first?' : 'Who will you invite next?'}</h2>
          {instruction && <p className="invite-instruction">{instruction}</p>}
          <p className="muted">Enter their first name and last initial.</p>
          <input
            className="input"
            placeholder="e.g. Sarah M."
            value={name}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="words"
            onChange={(e) => { setName(e.target.value); setError(null); }}
            autoFocus
            aria-label="Their first name and last initial"
          />
          <p className="fine">They’ll see it on their invitation, to confirm it’s them.</p>
          <ErrorText error={error} />
          <Button type="submit" busy={checking} disabled={!name.trim()}>Continue</Button>
        </form>
      )}
      {/* The question uses their first name ("How well do you know Sarah?"). */}
      {step === 'classify' && (
        <Classifier
          method={additional ? 'circular' : method}
          name={name.trim().replace(/ \S\.$/u, '')}
          onSelect={create}
          // Extra invitations stay out of the standardised classification telemetry.
          track={additional ? undefined : { direction: 'outbound' }}
        />
      )}
      {step === 'ready' && invite && (
        <div className="stack fade-up text-center">
          <div className="ready-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          <h2 className="title">{name.trim()}’s link is ready.</h2>
          <p className="muted">It works once, for one person.</p>
          <div className="share-message" aria-label="Your invitation message">
            <p>{messageFor(share)}</p>
            <code className="url">{invite.url.replace(/^https?:\/\//, '')}</code>
          </div>
          <Button onClick={() => act('share')}>{copied ? 'Message copied' : 'Share invitation'}</Button>
          <Button variant="secondary" onClick={() => act('copy')}>{copied ? 'Copied' : 'Copy message'}</Button>
          {shared ? (
            <Button variant="ghost" onClick={onClose}>Continue</Button>
          ) : (
            <button className="link" onClick={onClose}>Later</button>
          )}
        </div>
      )}
    </Sheet>
  );
}
