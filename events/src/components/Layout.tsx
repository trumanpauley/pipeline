import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/me" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Pipeline Events
        </Link>
      </header>
      <main className={wide ? 'page page--wide' : 'page'}>{children}</main>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="center-msg" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="error" role="alert">{message}</p>;
}
