/**
 * The session-only search history, and read-once caching.
 *
 * Two rules are worth defending here because both are easy to break by
 * accident and neither fails loudly:
 *
 *   A RESTORED SEARCH IS NOT RE-CACHED. `consumeCache` reads and deletes, so
 *   results survive exactly one return trip. If a restore ever wrote back, a
 *   search would become permanent for the life of the tab — the opposite of
 *   what a search screen is for.
 *
 *   THE HISTORY NEVER LEAVES THE BROWSER. It is sessionStorage and nothing
 *   else: no request, no database, gone when the tab closes.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { consumeCache, readCache, writeCache, clearCache } from "./sessionCache";
import {
  clearRecentSearches,
  forgetSearch,
  readRecentSearches,
  rememberSearch,
} from "./recentSearches";

beforeEach(() => window.sessionStorage.clear());

describe("a search result survives exactly one return trip", () => {
  it("is there when you come straight back, and gone the time after", () => {
    writeCache("product-search:last", { searched: "coca cola", results: [1, 2] });

    // First return: the results are still on screen.
    expect(consumeCache<{ searched: string }>("product-search:last")?.searched).toBe("coca cola");

    // Second: a clean search box, which is what a search page should open on.
    expect(consumeCache("product-search:last")).toBeUndefined();
  });

  it("leaves other entries alone", () => {
    writeCache("product-search:last", { a: 1 });
    writeCache("order-cart:all:1", { b: 2 });

    consumeCache("product-search:last");

    // The cart is not a search: it is restored every time, not once.
    expect(readCache("order-cart:all:1")).toEqual({ b: 2 });
  });
});

describe("recent searches", () => {
  it("keeps the newest first", () => {
    rememberSearch("coca cola");
    rememberSearch("nutella");

    expect(readRecentSearches()).toEqual(["nutella", "coca cola"]);
  });

  it("moves a repeated search up rather than storing it twice", () => {
    rememberSearch("coca cola");
    rememberSearch("nutella");
    rememberSearch("COCA COLA  ");

    // One entry, at the top, in the spelling most recently used.
    expect(readRecentSearches()).toEqual(["COCA COLA", "nutella"]);
  });

  it("holds eight at most, dropping the oldest", () => {
    for (let index = 1; index <= 10; index += 1) rememberSearch(`term ${index}`);

    const history = readRecentSearches();
    expect(history).toHaveLength(8);
    expect(history[0]).toBe("term 10");
    expect(history).not.toContain("term 1");
  });

  it("ignores blanks and absurd lengths", () => {
    rememberSearch("   ");
    rememberSearch("x".repeat(500));

    expect(readRecentSearches()).toEqual([]);
  });

  it("forgets one term on request", () => {
    rememberSearch("coca cola");
    rememberSearch("nutella");

    expect(forgetSearch("COCA COLA")).toEqual(["nutella"]);
    expect(readRecentSearches()).toEqual(["nutella"]);
  });

  it("survives rubbish in storage", () => {
    window.sessionStorage.setItem("retailcompare.cache.v1.search:recent", "{not json");
    expect(readRecentSearches()).toEqual([]);
  });

  it("goes when the cache is cleared on sign-out", () => {
    rememberSearch("coca cola");
    clearCache();

    // The next person on this tab must not see what the last one was pricing.
    expect(readRecentSearches()).toEqual([]);
  });

  it("clears on request", () => {
    rememberSearch("coca cola");
    clearRecentSearches();
    expect(readRecentSearches()).toEqual([]);
  });
});
