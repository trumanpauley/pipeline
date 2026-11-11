import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { signOut, useSession } from '../lib/auth';
import { formatEventDate } from '../lib/format';
import type { MyEvent } from '../lib/types';
import { ErrorNote, Layout, Spinner } from '../components/Layout';
import { SignIn } from '../components/SignIn';

export function MePage() {
  const session = useSession();
  const [params] = useSearchParams();
  const next = params.get('next');
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) api.myEvents().then(setEvents).catch(e => setError(e.message));
  }, [session]);

  if (session === undefined) return <Layout><Spinner /></Layout>;
  if (session === null) {
    return (
      <Layout>
        <SignIn title="Find your invitations" intro="Enter the email you RSVP'd with. We'll send you a code — no password needed." />
      </Layout>
    );
  }
  // Only follow same-site relative paths.
  if (next && /^\/[a-z]/i.test(next) && !next.startsWith('//')) return <Navigate to={next} replace />;
  if (error) return <Layout><div className="card"><ErrorNote message={error} /></div></Layout>;
  if (!events) return <Layout><Spinner /></Layout>;
  if (events.length === 1) return <Navigate to={`/e/${events[0].event_id}`} replace />;

  return (
    <Layout>
      <div className="card stack">
        <h1>Your events</h1>
        {events.length === 0 ? (
          <p className="muted">
            We couldn't find an RSVP for <strong>{session.user.email}</strong>. Open the invitation link you
            were sent to RSVP, or sign in with a different email.
          </p>
        ) : (
          <ul className="list">
            {events.map(e => (
              <li key={e.event_id}>
                <Link to={`/e/${e.event_id}`} className="list-item">
                  <strong>{e.name}</strong>
                  <span className="muted small">{formatEventDate(e.starts_at)}{e.role === 'host' ? ' · Organizer' : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <button className="link small" onClick={() => signOut()}>Sign out ({session.user.email})</button>
      </div>
    </Layout>
  );
}
