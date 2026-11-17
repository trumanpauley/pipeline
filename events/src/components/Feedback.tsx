import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Transient confirmation pill ("Link copied"). */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 1800);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = message ? <div className="toast" role="status">{message}</div> : null;
  return { show, node };
}

/** Destructive action that needs a second tap instead of a browser confirm(). */
export function ConfirmButton({ children, confirmLabel, onConfirm, className, disabled }: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={className} disabled={disabled}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirmLabel : children}
    </button>
  );
}
