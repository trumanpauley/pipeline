import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, inviteUrl, type MyInvitation } from '../lib/api';
import { COPY } from '../config/experiment';
import { Classifier } from './Classifier';
import { Button, ErrorText, Sheet } from './ui';
import { NAME_REJECTED, nameAcceptable } from '../lib/names';

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

/**
 * Share (native sheet) or copy, and record the *intent* to share. The record is
 * written before the share sheet opens: tapping Share counts even if it's then
 * cancelled, and nothing here claims the link was actually received.
 */
async function shareOrCopy(inv: { id: string; url: string }, how: 'share' | 'copy') {
  const native = how === 'share' && typeof navigator.share === 'function';
  const marked = api.markShared(inv.id, native ? 'share' : 'copy').catch(() => null);
  if (native) {
    try {
      await navigator.share({ text: COPY.shareText, url: inv.url });
    } catch {
      /* cancelled — still counts as initiating a share */
    }
  } else {
    await copyText(inv.url);
  }
  await marked;
  return native ? 'shared' : 'copied';
}

// ---------- the two invitation cards ----------

const STATUS = (inv: MyInvitation) =>
  inv.status === 'accepted'
    ? { label: 'Joined', tone: 'done' }
    : inv.status === 'opened'
      ? { label: 'Opened', tone: 'warm' }
      : inv.shared_at
        ? { label: 'Shared', tone: 'idle' }
        : { label: 'Ready to share', tone: 'quiet' };

export function InviteSlots({
  invitations,
  max,
  level,
  onInvite,
  onChanged,
}: {
  invitations: MyInvitation[];
  max: number;
  level: number;
  onInvite: () => void;
  onChanged: () => void;
}) {
  const slots = Array.from({ length: max }, (_, i) => invitations[i] ?? null);
  const firstEmpty = slots.findIndex((s) => s === null);

  return (
    <section className="invite-slots" aria-label="Your invitations">
      {slots.map((inv, i) =>
        inv ? (
          <FilledSlot key={inv.id} inv={inv} index={i} level={level} onChanged={onChanged} />
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
}: {
  inv: MyInvitation;
  index: number;
  level: number;
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(inv.token);
  const st = STATUS(inv);
  const act = async (how: 'share' | 'copy') => {
    const r = await shareOrCopy({ id: inv.id, url }, how);
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
        <span className={`pill tone-${st.tone}`}><i />{st.label}</span>
      </span>
      {inv.status !== 'accepted' && (
        <div className="invite-actions">
          {awaitingShare && <p className="invite-hint">Share to unlock {UNLOCKS[index]?.toLowerCase()}</p>}
          <button className="chip" onClick={() => act('share')}>Share</button>
          <button className="chip" onClick={() => act('copy')}>{copied ? 'Copied' : 'Copy link'}</button>
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
  onClose,
}: {
  method: string;
  first: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'who' | 'classify' | 'ready'>('who');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const create = async (value: string, ms: number) => {
    try {
      const r = await api.createInvitation(value, name.trim(), ms);
      setInvite({ id: r.id, url: inviteUrl(r.token) });
      setStep('ready');
    } catch (e) {
      setError((e as Error).message);
      setStep('who');
    }
  };

  const act = async (how: 'share' | 'copy') => {
    if (!invite) return;
    const r = await shareOrCopy(invite, how);
    if (r === 'copied') setCopied(true);
    setShared(true);
  };

  const [checking, setChecking] = useState(false);
  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setChecking(true);
    const ok = await nameAcceptable(name);
    setChecking(false);
    if (!ok) return setError(NAME_REJECTED);
    setStep('classify');
  };

  return (
    <Sheet onClose={onClose}>
      {step === 'who' && (
        <form className="stack fade-up" onSubmit={submitName}>
          <h2 className="title">{first ? 'Who will you invite first?' : 'Who will you invite next?'}</h2>
          <p className="muted">Enter their first name.</p>
          <input
            className="input"
            placeholder="First name"
            value={name}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="words"
            onChange={(e) => { setName(e.target.value); setError(null); }}
            autoFocus
            aria-label="Their first name"
          />
          <p className="fine">Only you see this.</p>
          <ErrorText error={error} />
          <Button type="submit" busy={checking} disabled={!name.trim()}>Continue</Button>
        </form>
      )}
      {step === 'classify' && <Classifier method={method} name={name.trim()} onSelect={create} track={{ direction: 'outbound' }} />}
      {step === 'ready' && invite && (
        <div className="stack fade-up text-center">
          <div className="ready-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          <h2 className="title">{name.trim()}’s link is ready.</h2>
          <p className="muted">It works once, for one person.</p>
          <code className="url">{invite.url.replace(/^https?:\/\//, '')}</code>
          <Button onClick={() => act('share')}>{copied ? 'Link copied' : 'Share invitation'}</Button>
          <Button variant="secondary" onClick={() => act('copy')}>{copied ? 'Copied' : 'Copy link'}</Button>
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
