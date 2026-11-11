import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { Layout, Spinner } from './components/Layout';
import { InvitePage } from './pages/InvitePage';
import { MePage } from './pages/MePage';
import { GuestDashboardPage } from './pages/GuestDashboardPage';

// Guests never load the organizer dashboard code.
const OrganizerPage = lazy(() => import('./pages/OrganizerPage').then(m => ({ default: m.OrganizerPage })));

export function App() {
  if (!isConfigured) {
    return (
      <Layout>
        <div className="card stack">
          <h1>Setup needed</h1>
          <p className="muted">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (in <code>.env.local</code> or
            your Vercel project) and rebuild.
          </p>
        </div>
      </Layout>
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
