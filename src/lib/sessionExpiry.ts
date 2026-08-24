"use client";

/**
 * What happens when a session dies while somebody is using the app.
 *
 * With a 30-minute inactivity timeout, the common case is NOT a browser being
 * closed. It is a tab left open on the shop floor: the person walks away, the
 * session times out at Supabase, and the browser still holds a JWT that has not
 * expired and a page that still looks signed in. Nothing appears wrong until
 * they touch something — and then the API says 401.
 *
 * Without this, that 401 surfaced as whatever error the page happened to
 * render, leaving them looking at an order they were no longer signed in to.
 * The honest response is to return them to sign-in.
 *
 * IDEMPOTENT BY DESIGN. A page in flight can have several requests running at
 * once and all of them will 401 together; only the first should act.
 */

import { supabase, isSupabaseConfigured } from "./supabase";

let handling = false;

/** Reset between tests. Never called by the app. */
export function resetSessionExpiryGuard(): void {
  handling = false;
}

/**
 * The session is gone. Clear what is left of it locally, then go to sign-in.
 *
 * `scope: "local"` deliberately: the session is already dead at Supabase, so a
 * round trip to revoke it would only fail — and a failure there would leave a
 * stale token in storage looking valid to the next page load.
 */
export async function handleSessionExpired(reason?: string): Promise<void> {
  if (handling) return;
  if (typeof window === "undefined") return;

  // Already at sign-in: nothing to do, and redirecting would loop.
  if (window.location.pathname.startsWith("/login")) return;

  handling = true;

  try {
    if (isSupabaseConfigured()) {
      await supabase().auth.signOut({ scope: "local" });
    }
  } catch {
    // Clearing local storage is best effort; the redirect matters more.
  }

  const params = new URLSearchParams({
    next: window.location.pathname + window.location.search,
    reason: reason ?? "Your session timed out. Sign in again to continue.",
  });

  // A full navigation rather than a router push: the session is gone, so every
  // cached page and in-memory query belongs to somebody no longer signed in,
  // and reloading is the cheapest way to be sure none of it survives.
  window.location.assign(`/login?${params.toString()}`);
}

/**
 * Notice a session ending even when nobody is clicking.
 *
 * The 401 path above needs a request to fire. An idle tab makes none — but
 * supabase-js still tries to refresh at roughly t+58.5 min, and with the
 * session already timed out that refresh fails and the client emits
 * `SIGNED_OUT`. Listening for it means an abandoned tab returns to sign-in on
 * its own rather than sitting there looking authenticated.
 */
export function watchForSignOut(): () => void {
  if (typeof window === "undefined" || !isSupabaseConfigured()) return () => {};

  const { data } = supabase().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") void handleSessionExpired();
  });

  return () => data.subscription.unsubscribe();
}
