import type { ReactNode } from 'react';
import { eventWhen } from '../lib/format';
import type { PublicEvent } from '../lib/types';

export function EventHeader({ event, status, showAbout = true }: { event: PublicEvent; status?: ReactNode; showAbout?: boolean }) {
  const when = eventWhen(event.starts_at, event.ends_at);
  return (
    <header className="hero">
      {status}
      <h1 className="title">{event.name}</h1>
      <div className="meta">
        <span className="meta-primary">{when.date}</span>
        {when.time && <span className="meta-secondary">{when.time}</span>}
        {event.location_name && <span className="meta-secondary">{event.location_name}</span>}
      </div>
      {showAbout && event.description && <p className="about">{event.description}</p>}
    </header>
  );
}
