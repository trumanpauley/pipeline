import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface ShellProps {
  children: ReactNode;
  action?: ReactNode;
  wide?: boolean;
  cta?: boolean; // leave room for a fixed bottom button
}

export function Layout({ children, action, wide = false, cta = false }: ShellProps) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/me" className="wordmark" aria-label="Pipeline home">
          <span className="wordmark-dot" aria-hidden="true" />
          Pipeline
        </Link>
        {action}
      </header>
      <main className={['page', wide && 'page--wide', cta && 'page--cta'].filter(Boolean).join(' ')}>{children}</main>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-label={label}>
      <span className="spinner" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="error" role="alert">{message}</p>;
}
