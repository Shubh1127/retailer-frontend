"use client";

/**
 * The client half of the 30-minute inactivity timeout.
 *
 * THE BACKEND IS THE BOUNDARY. It refuses a request from a session idle for
 * thirty minutes whatever this file does, and that is the part that matters
 * because a token can be replayed from a script with no browser involved. This
 * exists so a person who walks away comes back to a sign-in page rather than to
 * a screen that still shows their order and fails the moment they touch it.
 *
 * WHAT COUNTS AS ACTIVITY
 *
 * Deliberately coarse: pointer, keyboard, scroll, touch, and a tab becoming
 * visible again. Enough to know somebody is there, and nothing that is recorded
 * anywhere — these events never reach the audit trail, which is for actions
 * that change money, state or access.
 *
 * WHAT DOES NOT COUNT
 *
 * An automatic token refresh. supabase-js renews the JWT on a timer with nobody
 * present, and treating that as activity would keep an abandoned tab signed in
 * for ever — the exact failure this whole feature exists to prevent. Nothing
 * here listens to `TOKEN_REFRESHED`, and that omission is the point.
 *
 * Background polling does not count either. The job list refreshes every five
 * seconds; those requests carry `X-Activity: passive` so the backend does not
 * read them as somebody being present.
 */

import { handleSessionExpired } from "./sessionExpiry";

/** Matches the backend's INACTIVITY_TIMEOUT_MINUTES. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * How often the timer is checked, rather than one long timeout.
 *
 * A single `setTimeout` of thirty minutes does not survive a laptop lid: the
 * timer is suspended with the machine and fires late by however long it slept,
 * so somebody who closed the lid for an hour would be given a fresh half hour
 * on opening it. Comparing wall-clock timestamps on a short tick is immune to
 * that, and the backend would refuse them anyway.
 */
const TICK_MS = 15_000;

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
] as const;

export interface IdleWatchOptions {
  timeoutMs?: number;
  tickMs?: number;
  /** Injected in tests. Defaults to the real expiry handler. */
  onExpired?: () => void | Promise<void>;
  /** Injected in tests. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Start watching for inactivity. Returns a function that stops it.
 *
 * Idempotent about expiry: once it has fired, the tick stops, so a tab cannot
 * queue several redirects while the first is still navigating.
 */
export function watchForIdle(options: IdleWatchOptions = {}): () => void {
  if (typeof window === "undefined") return () => {};

  const timeoutMs = options.timeoutMs ?? IDLE_TIMEOUT_MS;
  const tickMs = options.tickMs ?? TICK_MS;
  const now = options.now ?? (() => Date.now());
  const onExpired = options.onExpired ?? (() => handleSessionExpired());

  let lastActivity = now();
  let fired = false;

  const markActive = () => {
    // Once expired, activity means nothing: the session is already gone at the
    // backend and a late click must not appear to revive it.
    if (fired) return;
    lastActivity = now();
  };

  const onVisibility = () => {
    // Returning to the tab is somebody being there. Leaving it is not, so the
    // hidden case deliberately does nothing rather than resetting the clock.
    if (document.visibilityState === "visible") markActive();
  };

  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, markActive, { passive: true });
  }
  document.addEventListener("visibilitychange", onVisibility);

  const timer = window.setInterval(() => {
    if (fired) return;
    if (now() - lastActivity < timeoutMs) return;

    fired = true;
    window.clearInterval(timer);
    void onExpired();
  }, tickMs);

  return () => {
    window.clearInterval(timer);
    for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
