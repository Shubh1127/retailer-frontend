"use client";

/**
 * What this person has searched for, for as long as the tab is open.
 *
 * ── DELIBERATELY NOT IN THE DATABASE ────────────────────────────────────────
 *
 * A search history is a record of what a shop was thinking about buying, and
 * storing that server-side would make it something to secure, to export, to
 * delete on request and to reason about when an account is shared. It buys
 * nothing: the value of "birra moretti" is that it was typed four minutes ago
 * and is about to be typed again, and that value is gone by tomorrow.
 *
 * So it lives in sessionStorage. Per tab, gone when the tab closes, never sent
 * anywhere, and cleared with everything else on sign-out.
 *
 * ── THE RULES, AND WHY EACH ONE ─────────────────────────────────────────────
 *
 *   MOST RECENT FIRST     the list is read top-down and the useful one is
 *                         almost always the last one.
 *   DE-DUPLICATED, loosely — case and surrounding space ignored, because
 *                         "Coca Cola" and "coca cola " are one search to the
 *                         person who typed them and two rows is just noise.
 *                         Re-searching an old term MOVES it to the top rather
 *                         than adding a second copy.
 *   EIGHT, AT MOST        a dropdown longer than a glance is a list to read
 *                         rather than a shortcut to take, and it would cover
 *                         the results underneath it.
 *   NOTHING BLANK         and nothing absurd: a pasted paragraph is not a
 *                         search worth offering back.
 */

const KEY = "retailcompare.cache.v1.search:recent";
const LIMIT = 8;
const MAX_TERM_LENGTH = 120;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The terms, newest first. Always an array, even when storage is unreadable. */
export function readRecentSearches(): string[] {
  const store = storage();
  if (!store) return [];

  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

/**
 * Remember a search that actually ran.
 *
 * Called on SUBMIT, not on every keystroke — the history is of questions asked,
 * not of letters typed. Returns the new list so a caller can render it without
 * a second read.
 */
export function rememberSearch(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed || trimmed.length > MAX_TERM_LENGTH) return readRecentSearches();

  const existing = readRecentSearches();
  const deduped = existing.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...deduped].slice(0, LIMIT);

  const store = storage();
  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(next));
    } catch {
      /* Full, blocked or private. A missing history is not worth a crash. */
    }
  }

  return next;
}

/** Drop one term — the × beside it in the list. */
export function forgetSearch(term: string): string[] {
  const next = readRecentSearches().filter(
    (entry) => entry.toLowerCase() !== term.trim().toLowerCase(),
  );

  const store = storage();
  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(next));
    } catch {
      /* as above */
    }
  }

  return next;
}

/** Forget the lot. Also happens on sign-out, via `clearCache`. */
export function clearRecentSearches(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* nothing to do, and nothing worth reporting */
  }
}
