import { useState } from 'react';
import { shareText } from '../lib/api';
import { appUrl } from '../lib/router';
import { COPY } from '../config/experiment';
import { copyText } from './Invitations';

/** The generic preview (same text as api/_share.js), used when nothing is set. */
const DEFAULT_TITLE = 'You’ve been invited.';
const DEFAULT_DESCRIPTION = 'A short experiment about how people are connected.';
const SAMPLE_TOKEN = 'Xr4Lp9QwTz2bNc8VdK1sFa';

export interface InvitationLook {
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
  inviteMessage: string;
  forwardMessage: string;
}

/**
 * Admin preview of an invitation as people receive it: an iMessage-style
 * conversation with the link-preview card, and the full text that gets
 * shared. Updates as the settings are typed. Approximate: each app draws its
 * own card, but they all use this title, description and image.
 */
export function InvitationPreview({ look }: { look: InvitationLook }) {
  const [kind, setKind] = useState<'initial' | 'forward'>('initial');
  const [copied, setCopied] = useState(false);
  const url = appUrl(look.slug ? `/${look.slug}/${SAMPLE_TOKEN}` : `/join/${SAMPLE_TOKEN}`);
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  const message = (kind === 'initial' ? look.inviteMessage : look.forwardMessage).trim() || COPY.shareText;
  const text = shareText(message, url);
  const title = look.title.trim() || DEFAULT_TITLE;
  const description = look.description.trim() || DEFAULT_DESCRIPTION;

  return (
    <div className="invite-preview" data-testid="invitation-preview">
      <div className="segmented small" role="radiogroup" aria-label="Preview which message" style={{ ['--n' as string]: 2 }}>
        <button type="button" role="radio" aria-checked={kind === 'initial'} className={kind === 'initial' ? 'is-selected' : ''} onClick={() => setKind('initial')}>
          Initial invitation
        </button>
        <button type="button" role="radio" aria-checked={kind === 'forward'} className={kind === 'forward' ? 'is-selected' : ''} onClick={() => setKind('forward')}>
          Forwarded by a participant
        </button>
      </div>

      <div className="imsg" aria-label="Message preview">
        <div className="imsg-head">
          <span className="imsg-avatar" aria-hidden="true">{kind === 'initial' ? 'Y' : 'P'}</span>
          <span>{kind === 'initial' ? 'You' : 'A participant'}</span>
        </div>
        <div className="imsg-thread">
          <p className="imsg-bubble" data-testid="preview-message">{message}</p>
          <div className="imsg-link" data-testid="preview-card">
            {look.imageUrl.trim()
              ? <img className="og-image" src={look.imageUrl.trim()} alt="" />
              : <GeneratedCard title={title} description={look.description.trim()} />}
            <div className="imsg-link-text">
              <strong data-testid="preview-title">{title}</strong>
              <span className="imsg-desc" data-testid="preview-description">{description}</span>
              <span className="imsg-host">{host}</span>
            </div>
          </div>
          <p className="imsg-meta">Delivered</p>
        </div>
      </div>

      <div className="share-full">
        <div className="share-full-head">
          <span className="muted small">Full text that’s shared</span>
          <button type="button" className="chip" onClick={async () => { await copyText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>
            {copied ? 'Copied' : 'Copy text'}
          </button>
        </div>
        <pre data-testid="preview-text">{text}</pre>
        <p className="fine">The link shown is an example: everyone shares their own unique link.</p>
      </div>
    </div>
  );
}

/** Approximation of the generated preview image (api/og.js) when none is uploaded. */
function GeneratedCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="og-generated" aria-hidden="true">
      <svg className="og-net" viewBox="0 0 400 210" preserveAspectRatio="xMaxYMid slice">
        {[[250, 40, 300, 95], [300, 95, 360, 60], [300, 95, 330, 160], [330, 160, 385, 150], [250, 40, 215, 120], [215, 120, 300, 95], [360, 60, 385, 150], [215, 120, 270, 185]].map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
        {[[250, 40], [300, 95], [360, 60], [330, 160], [385, 150], [215, 120], [270, 185]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === 1 || i === 3 ? 4 : 2.6} className={i === 1 || i === 3 ? 'accent' : ''} />
        ))}
      </svg>
      <span className="og-site">The Experiment</span>
      <span className="og-title">{title}</span>
      {description && <span className="og-desc">{description}</span>}
    </div>
  );
}
