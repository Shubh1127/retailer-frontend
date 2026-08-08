"use client";

/**
 * Is anybody signed in, and who?
 *
 * For chrome only — a nav that says "Dashboard" instead of "Log in". It reads
 * the Supabase session directly, which is the cheap local answer and NOT an
 * authorisation check: it cannot tell whether the backend considers this person
 * a retailer, an admin, or blocked. `whoAmI` answers that, and the gate is what
 * enforces it.
 *
 * Subscribed rather than read once, so signing out in one tab updates the nav in
 * the others instead of leaving a stale "Sign out" button behind.
 */

import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";

export interface SessionState {
  loading: boolean;
  signedIn: boolean;
  email?: string;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    loading: true,
    signedIn: false,
  });

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setState({ loading: false, signedIn: false });
      return;
    }

    const client = supabase();
    let cancelled = false;

    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setState({
        loading: false,
        signedIn: Boolean(data.session),
        ...(data.session?.user.email ? { email: data.session.user.email } : {}),
      });
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      setState({
        loading: false,
        signedIn: Boolean(session),
        ...(session?.user.email ? { email: session.user.email } : {}),
      });
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return state;
}
