import { useCallback, useEffect, useState } from 'react';
import { api, type AdminNames } from '../lib/api';

type Tab = 'people' | 'invitees' | 'log';

const STATUS_TONE: Record<string, string> = { ok: 'done', pending: 'warm', flagged: 'warm', hidden: 'quiet' };
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Admin: review participant and invitee names, act on them, see the log. */
export function ModerationPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<AdminNames | null>(null);
  const [tab, setTab] = useState<Tab>('people');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.adminNames());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (target: 'participant' | 'invitation', id: string, action: string) => {
    let value: string | undefined;
    let reason: string | undefined;
    if (action === 'replace') {
      const v = window.prompt('Replacement name');
      if (!v) return;
      value = v;
    }
    if (action === 'suspend') {
      if (!window.confirm('Suspend this participant? Their unused invitation links will stop working.')) return;
      reason = window.prompt('Reason (optional, kept in the log)') ?? undefined;
    }
    setBusy(`${id}:${action}`);
    setError(null);
    try {
      await api.adminModerate(target, id, action, value, reason);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <p className="muted small">{error ?? 'Loading names…'}</p>;

  const needsReview = (s: string) => s !== 'ok';
  const people = data.participants.filter((p) => !reviewOnly || needsReview(p.name_status) || p.suspended_at);
  const invitees = data.labels.filter((l) => !reviewOnly || needsReview(l.label_status));
  const flaggedPeople = data.participants.filter((p) => needsReview(p.name_status)).length;
  const flaggedInvitees = data.labels.filter((l) => needsReview(l.label_status)).length;

  const btn = (target: 'participant' | 'invitation', id: string, action: string, label: string, ghost = false) => (
    <button
      key={action}
      className={`chip ${ghost ? 'ghost' : ''}`}
      disabled={busy !== null}
      onClick={() => act(target, id, action)}
    >
      {busy === `${id}:${action}` ? '…' : label}
    </button>
  );

  return (
    <div className="moderation">
      <div className="moderation-bar">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'people'} className={`chip ${tab === 'people' ? 'is-active' : ''}`} onClick={() => setTab('people')}>
            People{flaggedPeople ? ` · ${flaggedPeople} to review` : ''}
          </button>
          <button role="tab" aria-selected={tab === 'invitees'} className={`chip ${tab === 'invitees' ? 'is-active' : ''}`} onClick={() => setTab('invitees')}>
            Invitee names{flaggedInvitees ? ` · ${flaggedInvitees} to review` : ''}
          </button>
          <button role="tab" aria-selected={tab === 'log'} className={`chip ${tab === 'log' ? 'is-active' : ''}`} onClick={() => setTab('log')}>
            Log
          </button>
        </div>
        {tab !== 'log' && (
          <label className="muted small review-only">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} /> Only needs review
          </label>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {tab === 'people' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Gen</th><th>Links</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className={p.suspended_at ? 'is-suspended' : ''}>
                  <td>{p.display_name ?? <span className="muted">—</span>}</td>
                  <td>
                    <span className={`pill tone-${STATUS_TONE[p.name_status]}`}><i />{p.name_status}</span>
                    {p.suspended_at && <span className="pill tone-quiet suspended-pill"><i />suspended</span>}
                  </td>
                  <td>{p.depth}</td>
                  <td>{p.links}</td>
                  <td>{fmt(p.created_at)}</td>
                  <td className="actions">
                    {p.name_status !== 'ok' && btn('participant', p.id, 'approve', 'Approve')}
                    {p.name_status === 'ok' && btn('participant', p.id, 'flag', 'Flag')}
                    {p.name_status !== 'hidden' && btn('participant', p.id, 'hide', 'Hide')}
                    {btn('participant', p.id, 'replace', 'Replace')}
                    {p.suspended_at
                      ? btn('participant', p.id, 'unsuspend', 'Unsuspend', true)
                      : btn('participant', p.id, 'suspend', 'Suspend', true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!people.length && <p className="muted small">Nothing to review.</p>}
        </div>
      )}

      {tab === 'invitees' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Invitee name</th><th>Status</th><th>Invited by</th><th>Link</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              {invitees.map((l) => (
                <tr key={l.id}>
                  <td>{l.recipient_label ?? <span className="muted">— hidden</span>}</td>
                  <td><span className={`pill tone-${STATUS_TONE[l.label_status]}`}><i />{l.label_status}</span></td>
                  <td>{l.sender_name ?? '—'}</td>
                  <td>{l.status}</td>
                  <td>{fmt(l.created_at)}</td>
                  <td className="actions">
                    {l.label_status !== 'ok' && l.recipient_label && btn('invitation', l.id, 'approve', 'Approve')}
                    {l.label_status === 'ok' && btn('invitation', l.id, 'flag', 'Flag')}
                    {l.label_status !== 'hidden' && btn('invitation', l.id, 'hide', 'Hide')}
                    {btn('invitation', l.id, 'replace', 'Replace')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!invitees.length && <p className="muted small">Nothing to review.</p>}
        </div>
      )}

      {tab === 'log' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Name</th><th>Reason</th></tr></thead>
            <tbody>
              {data.log.map((a) => (
                <tr key={a.id}>
                  <td>{fmt(a.created_at)}</td>
                  <td>{a.admin_email}</td>
                  <td>{a.action}</td>
                  <td>{a.target_type}</td>
                  <td>{a.new_value ? `${a.old_value ?? '—'} → ${a.new_value}` : a.old_value ?? ''}</td>
                  <td>{a.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.log.length && <p className="muted small">No moderation actions yet.</p>}
        </div>
      )}
      <p className="muted small">
        Name review: {data.name_review === 'before'
          ? 'new names stay off invitation pages until approved.'
          : 'new names are shown right away; review them here.'} Change “name_review” in Settings.
      </p>
    </div>
  );
}
