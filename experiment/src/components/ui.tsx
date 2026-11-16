import { useEffect, type ReactNode } from 'react';

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <main className={`screen ${className}`}>
      <div className="screen-inner">{children}</div>
    </main>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  busy,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  busy?: boolean;
}) {
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled || busy}>
      {busy ? <span className="spinner" aria-label="Loading" /> : children}
    </button>
  );
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={`check ${checked ? 'is-checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true" />
      <span className="check-label">{children}</span>
    </label>
  );
}

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

export function Loading() {
  return (
    <Screen className="center">
      <span className="pulse" aria-label="Loading" />
    </Screen>
  );
}

/** Ambient network: a few nodes that draw their links in, then breathe. */
export function Constellation({ small = false }: { small?: boolean }) {
  const nodes = [
    [50, 50], [22, 28], [80, 24], [18, 72], [76, 78], [50, 12], [92, 52], [8, 46],
  ];
  const links = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [2, 5], [2, 6], [3, 7], [1, 7]];
  return (
    <svg className={`constellation ${small ? 'is-small' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
      {links.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          style={{ animationDelay: `${0.25 + i * 0.09}s` }}
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 0 ? 2.6 : 1.6} className={i === 0 ? 'core' : ''}
          style={{ animationDelay: `${i * 0.07}s` }} />
      ))}
    </svg>
  );
}
