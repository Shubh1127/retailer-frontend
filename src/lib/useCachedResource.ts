"use client";

/**
 * A page's data: shown from this tab's cache at once, then checked with the server.
 *
 * ── THE SHAPE OF IT ─────────────────────────────────────────────────────────
 *
 *   first visit      nothing cached → `loading` is true → skeleton → fetch →
 *                    paint → remember.
 *   coming back      cached → painted on the FIRST render, `loading` false, and
 *                    a refetch goes out behind it. The list is there before the
 *                    navigation has finished animating.
 *
 * `loading` therefore means "there is nothing to show yet", not "a request is in
 * flight" — `revalidating` is that. A page that showed its skeleton whenever a
 * request was open would blank the list every time somebody came back to it,
 * which is the thing this exists to stop.
 *
 * ── THE TWO WAYS TO CHANGE THE DATA, AND WHY THEY ARE DIFFERENT ─────────────
 *
 *   commit(next)     the server said this. State AND cache.
 *   show(next)       the UI is running ahead. State ONLY.
 *
 * That split is the whole discipline of this module. A quantity moves under the
 * thumb before the write lands, and if that optimistic value were cached, a
 * FAILED write would be remembered as a success: come back to the page and it
 * shows a number no server ever agreed to, with nothing in flight to correct
 * it. Optimism is for the screen, which is about to be corrected anyway. The
 * cache only ever holds answers.
 *
 * ── READING STORAGE DURING RENDER ───────────────────────────────────────────
 *
 * The cached value is read in the `useState` initializer rather than in an
 * effect, because an effect runs after the first paint — which would show the
 * skeleton for a frame and lose the only thing this is for. Guarded with
 * `typeof window`, so the server renders the empty state. This is the same
 * trade `cachedMe` already makes for the header.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { readCache, writeCache } from "@/lib/sessionCache";

export interface CachedResource<T> {
  data: T | undefined;
  /** Nothing to show yet. NOT the same as "a request is open". */
  loading: boolean;
  /** A request is open over data that is already on screen. */
  revalidating: boolean;
  error: string | null;
  /** The server said this: state and cache. */
  commit: (next: T) => void;
  /**
   * The UI is running ahead: state ONLY, never cached.
   *
   * Takes an updater as well as a value, because an optimistic change is
   * usually a small edit to what is already there rather than a whole new
   * object from somewhere.
   */
  show: Dispatch<SetStateAction<T | undefined>>;
  /**
   * The server has now accepted what is on screen: cache it as it stands.
   *
   * For writes that answer `{ ok: true }` rather than with the new object — a
   * quantity, a removal. The optimistic value was shown immediately, the write
   * went out behind it, and only when it comes back is that value something the
   * server agrees with and therefore something worth remembering. Calling this
   * before the response would cache a change that might still fail.
   */
  persist: () => void;
  /** Ask again. */
  refresh: () => Promise<void>;
}

export function useCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: {
    /** Skip the cache and the fetch entirely — for a page that is gated. */
    enabled?: boolean;
    maxAgeMs?: number;
    /** Keeps one account's data from being shown to the next in the same tab. */
    userId?: string;
    onError?: (message: string) => void;
  } = {},
): CachedResource<T> {
  const { enabled = true, maxAgeMs, userId, onError } = opts;

  const [data, setData] = useState<T | undefined>(() => {
    if (typeof window === "undefined" || !enabled) return undefined;
    return readCache<T>(key, {
      ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
      ...(userId ? { userId } : {}),
    });
  });

  const [loading, setLoading] = useState(data === undefined && enabled);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The fetcher is captured, deliberately.
   *
   * Callers write it inline, so it is a new function on every render; as an
   * effect dependency it would refetch forever. The KEY is the dependency —
   * which is the right one, because the key is what says which data this is.
   */
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const commit = useCallback(
    (next: T) => {
      setData(next);
      writeCache(key, next, { ...(userId ? { userId } : {}) });
    },
    [key, userId],
  );

  const show = setData;

  /**
   * The latest data, readable from callbacks without making them depend on it.
   * `hasData` keeps `refresh` from re-creating itself on every change.
   */
  const dataRef = useRef(data);
  dataRef.current = data;

  const hasData = useRef(data !== undefined);
  hasData.current = data !== undefined;

  const persist = useCallback(() => {
    if (dataRef.current === undefined) return;
    writeCache(key, dataRef.current, { ...(userId ? { userId } : {}) });
  }, [key, userId]);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    if (hasData.current) setRevalidating(true);
    else setLoading(true);

    try {
      const next = await fetcherRef.current();
      setData(next);
      writeCache(key, next, { ...(userId ? { userId } : {}) });
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load this page";
      /**
       * A FAILED REFETCH DOES NOT WIPE THE SCREEN. What is already shown came
       * from the server a moment ago; replacing a working list with an error
       * because one refresh failed is a worse answer than the slightly older
       * list. The error is reported and the data stays.
       */
      if (!hasData.current) setError(message);
      onErrorRef.current?.(message);
    } finally {
      setLoading(false);
      setRevalidating(false);
    }
  }, [enabled, key, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, revalidating, error, commit, show, persist, refresh };
}
