import { usePath } from './lib/router';
import { useSession } from './lib/session';
import { isConfigured } from './lib/supabase';
import { InvitePage } from './pages/InvitePage';
import { HomePage } from './pages/HomePage';
import { AdminPage } from './pages/AdminPage';
import { ExperimentPage } from './pages/ExperimentPage';
import { RESERVED_SLUGS } from './lib/sharing';
import { Constellation, Loading, Screen } from './components/ui';

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

  // Tolerate punctuation that messaging apps glue onto the end of a pasted link.
  // /join/TOKEN (current links) and /i/TOKEN (earlier links) are the same invitation.
  const invite = path.match(/^\/(?:join|i)\/([A-Za-z0-9_-]{10,64})[/.,;:!?)\]'"’”]*$/);
  if (invite) return <InvitePage key={invite[1]} token={invite[1]} session={session} />;
  // A damaged or truncated invitation link: say so, rather than showing sign-in.
  if (/^\/(join|i)(\/|$)/.test(path)) return <InvalidInvite />;
  if (path.startsWith('/admin')) return <AdminPage session={session} />;
  // An experiment's own address: /harvard-baseball/TOKEN is an invitation
  // (the token decides everything; the name is for people), /harvard-baseball
  // is the experiment's public page.
  const named = path.match(/^\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])\/([A-Za-z0-9_-]{10,64})[/.,;:!?)\]'"’”]*$/);
  if (named && !RESERVED_SLUGS.has(named[1])) return <InvitePage key={named[2]} token={named[2]} session={session} />;
  const page = path.match(/^\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])\/?$/);
  if (page && !RESERVED_SLUGS.has(page[1])) return <ExperimentPage key={page[1]} slug={page[1]} />;
  return <HomePage session={session} />;
}

function InvalidInvite() {
  return (
    <Screen className="center">
      <div className="stack fade-up text-center">
        <Constellation small />
        <h1 className="title">This link isn’t active.</h1>
        <p className="muted">Ask the person who sent it for a new one.</p>
      </div>
    </Screen>
  );
}
