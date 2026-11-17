import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { isLocalDemo } from './demo';

/**
 * Keeps the inviter's invitation cards current without a refresh.
 *
 * Subscribes (Supabase Realtime) to changes on invitations this participant
 * sent; RLS means the server only ever streams their own rows. If Realtime
 * isn't available, it falls back to a gentle poll while the page is visible.
 * Either way it also refreshes when the app comes back to the foreground, so
 * statuses are current after reopening.
 */
export function useLiveInvitations(participantId: string | undefined, onChange: () => void) {
  const [live, setLive] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!participantId) return;
    let timer = 0;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), 250); // coalesce bursts (open + answer + join)
    };

    const channel = isLocalDemo
      ? null
      : supabase
          .channel(`invitations:${participantId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'invitations', filter: `sender_id=eq.${participantId}` }, fire)
          .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    const onVisible = () => {
      if (document.visibilityState === 'visible') fire();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [participantId]);

  // Fallback poll while not subscribed and visible.
  useEffect(() => {
    if (!participantId || live) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') cb.current();
    }, 20000);
    return () => window.clearInterval(id);
  }, [participantId, live]);

  return live;
}
