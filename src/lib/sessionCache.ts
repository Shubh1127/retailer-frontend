"use client";

/**
 * What this tab already knows, kept between page changes.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * Every page in this app fetches on mount, and in the App Router a page
 * unmounts the moment you navigate away from it. Going to Settings and back to
 * the order cart therefore refetched the cart, and — worse — re-ran every
 * catalogue enrichment batch behind it. Nothing had changed in those four
 * seconds; the answer was one the browser had just been given.
 *
 * ── WHY sessionStorage AND NOT localStorage ─────────────────────────────────
 *
 * Per tab, and gone when the tab closes. That is the right lifetime for "what
 * was on screen a moment ago": it survives every navigation inside a session,
 * and it cannot hand a stale order to somebody who opens the browser tomorrow.
 * It also cannot leak between two people sharing a shop-office machine in
 * different windows, which localStorage can.
 *
 * Records are still stamped with the user id, because signing out and in again
 * within ONE tab would otherwise show the previous account's cart for a frame.
 *
 * ── WHAT MAY BE WRITTEN HERE, AND WHEN ──────────────────────────────────────
 *
 * ONLY WHAT THE SERVER HAS CONFIRMED. The UI moves optimistically — a quantity
 * changes under the thumb before the write lands — and that optimistic value
 * must never reach this cache. If it did, a failed write would be remembered
 * as though it had succeeded, and the next visit to the page would show a
 * quantity no server ever agreed to, with nothing left in flight to correct it.
 *
 * So: React state is what the person sees, and it may run ahead. This is what
 * the server last said, and it is written after a response, never before one.
 *
 * ── IT IS A CACHE, NOT A STORE ──────────────────────────────────────────────
 *
 * Nothing here decides what is true. Every read is paired with a refetch that
 * overwrites it — the cache only decides what to show for the few hundred
 * milliseconds before the truth arrives. Every access is wrapped, because
 * storage throws outright in a private window, with site data blocked, or when
 * the quota is full, and a page that failed to render because a cache lookup
 * threw would be a far worse bug than the one this fixes.
 */

const VERSION = "v1";
const PREFIX = `retailcompare.cache.${VERSION}`;

/**
 * How old a remembered answer may be before it is ignored.
 *
 * Not a freshness guarantee — the background refetch is that. This stops a tab
 * left open over a lunch break painting an hour-old cart for a moment before
 * correcting it.
 */
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

interface Envelope<T> {
  at: number;
  /** Whose data this is. A record for somebody else is wrong, not stale. */
  userId?: string;
  data: T;
}

/**
 * The keys, named in one place.
 *
 * Pages do not invent strings: a typo silently produces a second cache that
 * never hits, which looks exactly like the feature not working. Keys that vary
 * by what is being shown — the cart's tab and page — carry those in the key, so
 * switching tabs cannot show the previous tab's rows.
 */
export const cacheKeys = {
  /** A finished search, kept for ONE return trip. See `consumeCache`. */
  productSearch: "product-search:last",
  dashboardSearch: "dashboard:last-search",
  orderCart: (tab: string, page: number) => `order-cart:${tab}:${page}`,
  /** Images and pack text, by line id. Shared by every view of the cart. */
  cartEnrichment: "order-cart:enrichment",
  scanCart: "scan-cart",
  suppliers: "suppliers",
  jobs: (page: number) => `jobs:${page}`,
  job: (jobId: string) => `job:${jobId}`,
  baskets: "baskets",
  orders: "orders",
  dashboard: "dashboard",
} as const;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** What was remembered, if anything still counts. */
export function readCache<T>(
  key: string,
  opts: { maxAgeMs?: number; userId?: string } = {},
): T | undefined {
  const store = storage();
  if (!store) return undefined;

  try {
    const raw = store.getItem(`${PREFIX}.${key}`);
    if (!raw) return undefined;

    const envelope = JSON.parse(raw) as Envelope<T>;
    if (!envelope || typeof envelope.at !== "number") return undefined;

    if (Date.now() - envelope.at > (opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS)) return undefined;

    // A record for somebody else is not a stale record, it is the wrong one.
    if (opts.userId && envelope.userId && envelope.userId !== opts.userId) return undefined;

    return envelope.data;
  } catch {
    return undefined;
  }
}

/**
 * Remember a server-confirmed answer.
 *
 * Call this with a RESPONSE, never with optimistic state — see the header.
 */
export function writeCache<T>(key: string, data: T, opts: { userId?: string } = {}): void {
  const store = storage();
  if (!store) return;

  try {
    const envelope: Envelope<T> = {
      at: Date.now(),
      ...(opts.userId ? { userId: opts.userId } : {}),
      data,
    };
    store.setItem(`${PREFIX}.${key}`, JSON.stringify(envelope));
  } catch {
    /**
     * Quota, private mode, or blocked site data. The app works without it —
     * which is the whole point of treating this as a cache rather than state.
     * A cart of two hundred lines with images is comfortably inside the ~5MB
     * sessionStorage allowance, but a quota error is never worth a crash.
     */
  }
}

/**
 * Read an entry AND forget it, so it can only be shown once.
 *
 * ── WHY ANYTHING WOULD WANT THIS ────────────────────────────────────────────
 *
 * A search result is not the same kind of thing as a cart. The cart is what the
 * shop is buying and is worth restoring every time it is opened; a search is a
 * question somebody asked a minute ago, and it has a natural half-life. Coming
 * straight back to the page — because a product was opened, or the wrong tab
 * was tapped — should find the results still there. Coming back tomorrow
 * afternoon to an empty box and a fresh start is what a search screen is for.
 *
 * So the entry survives exactly one return trip. Restoring it does not write it
 * back; only running the search again does.
 */
export function consumeCache<T>(
  key: string,
  opts: { maxAgeMs?: number; userId?: string } = {},
): T | undefined {
  const found = readCache<T>(key, opts);
  dropCache(key);
  return found;
}

/** Forget one entry — when a page learns its cached answer is wrong. */
export function dropCache(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(`${PREFIX}.${key}`);
  } catch {
    /* nothing to do, and nothing worth reporting */
  }
}

/**
 * Forget everything this service owns.
 *
 * Called on SIGN-OUT, and it matters: the next person to sign in on this tab
 * must not see the last one's order for a frame. Only our own keys are removed,
 * so anything else the app or Supabase keeps in sessionStorage is left alone.
 */
export function clearCache(): void {
  const store = storage();
  if (!store) return;

  try {
    const doomed: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(`${PREFIX}.`)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    /* nothing to do, and nothing worth reporting */
  }
}
