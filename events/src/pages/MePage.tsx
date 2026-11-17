import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { signOut, useSession } from '../lib/auth';
import { eventWhen } from '../lib/format';
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
  if (session === null) return <Layout><SignIn title="Your invitations" /></Layout>;
  // Only follow same-site relative paths.
  if (next && /^\/[a-z]/i.test(next) && !next.startsWith('//')) return <Navigate to={next} replace />;
  if (error) return <Layout><div className="state"><ErrorNote message={error} /></div></Layout>;
  if (!events) return <Layout><Spinner /></Layout>;
  if (events.length === 1) return <Navigate to={`/e/${events[0].event_id}`} replace />;

  return (
    <Layout>
      {events.length === 0 ? (
        <div className="state">
          <div className="state-body">
            <h1 className="title title--sm">No invitations yet</h1>
            <p className="muted">Nothing found for {session.user.email}.</p>
          </div>
          <button className="btn btn--block" onClick={() => signOut()}>Use another email</button>
        </div>
      ) : (
        <>
          <h1 className="title title--sm" style={{ paddingTop: 24 }}>Your events</h1>
          <ul className="list">
            {events.map(e => (
              <li key={e.event_id}>
                <Link to={`/e/${e.event_id}`} className="list-row">
                  <div className="grow">
                    <div style={{ fontWeight: 600, fontSize: 18 }}>{e.name}</div>
                    <div className="faint small">{eventWhen(e.starts_at).date}</div>
                  </div>
                  {e.role === 'host' ? <span className="pill pill--green">Hosting</span>
                    : <span className={e.rsvp_status === 'attending' ? 'pill pill--green' : 'pill'}>{e.rsvp_status === 'attending' ? 'Going' : 'Not going'}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <button className="text-btn" onClick={() => signOut()}>Sign out · {session.user.email}</button>
        </>
      )}
    </Layout>
  );
}
