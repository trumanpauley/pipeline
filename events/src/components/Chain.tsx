import { useEffect, useRef } from 'react';
import { firstName } from '../lib/format';

export interface ChainNode {
  name: string;
  role: 'host' | 'guest';
  isYou?: boolean;
  pending?: boolean; // the guest before they RSVP
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Organizer → … → you, as connected avatars. Scrolls to "you" on long chains. */
export function Chain({ nodes }: { nodes: ChainNode[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [nodes.length]);

  return (
    <ol className="chain" ref={ref} aria-label="Invitation chain">
      {nodes.map((n, i) => {
        const cls = ['chain-node', n.role === 'host' && 'chain-node--host', n.isYou && 'chain-node--you', n.pending && 'chain-node--pending']
          .filter(Boolean).join(' ');
        const label = n.isYou ? 'You' : firstName(n.name);
        return (
          <li key={i} className={cls} aria-label={n.role === 'host' ? `${n.name}, organizer` : n.isYou ? 'You' : n.name}>
            <span className="chain-avatar" aria-hidden="true">{n.isYou && n.pending ? '' : initials(n.isYou ? n.name || 'You' : n.name)}</span>
            <span className="chain-name" aria-hidden="true">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
