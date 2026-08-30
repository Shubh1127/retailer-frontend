/**
 * The signed-in user's own details, remembered between page loads.
 *
 * WHY. `/api/me` was fetched on every single page render, and the header sat
 * empty until it landed — name, store and avatar appearing a beat after the
 * page they belong to. It is the same answer every time for the same person,
 * and it is the answer we already had a moment ago.
 *
 * STALE WHILE REVALIDATE, and both halves matter. The cache paints instantly;
 * the request still goes out on every mount and overwrites it. So this never
 * decides what is true — it decides what to show for the ~200ms before the
 * truth arrives.
 *
 * WHAT IS SAFE TO PUT HERE, AND WHY THIS IS
 *
 * Nothing in `MeResponse` is a credential. The access token is Supabase's and
 * already lives in this same localStorage; a name, a store and an email add no
 * new secret to a device that is already signed in.
 *
 * `role` is the field worth thinking about, and it is safe for one specific
 * reason: nothing in this app authorises on it. It is rendered as the word
 * "Administrator" or "Retailer" in two places and read nowhere else, and every
 * route that matters is enforced by the backend against the token. A tampered
 * or stale role changes a label for one render. If that ever stops being true —
 * if a menu, a route or a control starts gating on `me.role` — this cache must
 * not be its source.
 *
 * KEYED TO THE USER IT DESCRIBES. The id travels with the record so a cache
 * written for one account cannot describe another. Two people sharing a browser
 * is a real thing in a shop office, and the failure mode without this is the
 * second person seeing the first person's name over their own data.
 */

import type { MeResponse } from '@/lib/api/me';

const KEY = 'retailcompare.me.v1';

/**
 * How old a remembered record may be before it is ignored.
 *
 * Not a freshness guarantee — the background fetch is that. This only stops a
 * browser that has not been opened in a month painting a month-old store name
 * for a moment before correcting it.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Cached {
  at: number;
  /** Whose details these are. See the header. */
  userId: string;
  me: MeResponse;
}

/**
 * What was remembered, if anything.
 *
 * Every read is guarded: localStorage throws outright in some contexts — a
 * private window, site data blocked, a thumbnail renderer — and a header that
 * failed to paint because a cache lookup threw would be a worse bug than the
 * one this fixes.
 */
export function readCachedMe(expectedUserId?: string): MeResponse | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw) as Cached;
    if (!cached?.me?.user?.id) return null;
    if (Date.now() - cached.at > MAX_AGE_MS) return null;

    // A record for somebody else is not a stale record, it is the wrong one.
    if (expectedUserId && cached.userId !== expectedUserId) return null;

    return cached.me;
  } catch {
    return null;
  }
}

export function writeCachedMe(me: MeResponse): void {
  try {
    const record: Cached = { at: Date.now(), userId: me.user.id, me };
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Full, blocked, or private. The app works without it — that is the whole
    // point of treating this as a cache rather than as state.
  }
}

/**
 * Forget it — on sign-out, and whenever the server disowns the session.
 *
 * Called on sign-out rather than left to expire, because the next person to use
 * this machine must not see the last one's name while their own is fetched.
 */
export function forgetCachedMe(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do, and nothing worth reporting */
  }
}
