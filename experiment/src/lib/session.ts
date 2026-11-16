import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** undefined while the initial session (including a magic-link hash) resolves. */
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => alive && setSession(s));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return session;
}

// Join details are kept locally while the email is verified. They are also
// sent as auth metadata so a magic link opened in another browser still works.
export interface PendingJoin {
  token: string;
  name: string;
  marketing: boolean;
  research: boolean;
}

const KEY = 'px.pending';

export const pending = {
  get(): PendingJoin | null {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(p: PendingJoin) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* private mode: metadata fallback still works */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

export function pendingFromSession(session: Session | null | undefined, token: string): PendingJoin | null {
  const local = pending.get();
  if (local && local.token === token && local.name && local.research) return local;
  const meta = session?.user?.user_metadata ?? {};
  if (meta.invite_token === token && meta.display_name && meta.research_consent) {
    return { token, name: meta.display_name, marketing: !!meta.marketing_consent, research: true };
  }
  return null;
}
