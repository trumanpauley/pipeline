import { usePath } from './lib/router';
import { useSession } from './lib/session';
import { isConfigured } from './lib/supabase';
import { InvitePage } from './pages/InvitePage';
import { HomePage } from './pages/HomePage';
import { AdminPage } from './pages/AdminPage';
import { Loading, Screen } from './components/ui';

export function App() {
  const path = usePath();
  const session = useSession();

  if (!isConfigured) {
    return (
      <Screen className="center">
        <h1 className="title">Not configured</h1>
        <p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</p>
      </Screen>
    );
  }
  if (session === undefined) return <Loading />;

  const invite = path.match(/^\/i\/([A-Za-z0-9_-]{10,64})\/?$/);
  if (invite) return <InvitePage key={invite[1]} token={invite[1]} session={session} />;
  if (path.startsWith('/admin')) return <AdminPage session={session} />;
  return <HomePage session={session} />;
}
