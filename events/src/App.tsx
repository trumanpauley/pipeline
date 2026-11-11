import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { configProblem, isConfigured } from './lib/supabase';
import { Layout, Spinner } from './components/Layout';
import { InvitePage } from './pages/InvitePage';
import { MePage } from './pages/MePage';
import { GuestDashboardPage } from './pages/GuestDashboardPage';

// Guests never load the organizer dashboard code.
const OrganizerPage = lazy(() => import('./pages/OrganizerPage').then(m => ({ default: m.OrganizerPage })));

export function App() {
  if (!isConfigured) {
    return (
      <BrowserRouter>
      <Layout>
        <div className="card stack">
          <h1>Setup needed</h1>
          <p className="error">{configProblem}</p>
          <p className="muted">
            Fix <code>events/.env.local</code> (locally) or the Vercel environment variables, then restart{' '}
            <code>npm run dev</code> or redeploy.
          </p>
        </div>
      </Layout>
      </BrowserRouter>
    );
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/i/:token" element={<InvitePage />} />
        <Route path="/e/:eventId" element={<GuestDashboardPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/organizer" element={<Suspense fallback={<Layout><Spinner /></Layout>}><OrganizerPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/me" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
