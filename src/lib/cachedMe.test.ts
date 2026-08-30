/**
 * Remembering who is signed in, and the ways that goes wrong.
 *
 * The cache exists to stop `/api/me` being fetched before the header can paint
 * on every single page load. It is stale-while-revalidate: it decides what to
 * SHOW for a moment, never what is true — the request goes out regardless and
 * overwrites it.
 *
 * The failures worth pinning are the ones where showing the wrong thing for a
 * moment actually matters:
 *
 *   the wrong person   two people share a browser in a shop office. A record
 *                      written for one account must never describe another.
 *   a rejected session the server has disowned the token; continuing to show
 *                      whose it was is the one lie this could tell.
 *   storage that fails localStorage throws outright in a private window or
 *                      with site data blocked, and a header that failed to
 *                      paint because a CACHE lookup threw would be a worse bug
 *                      than the one being fixed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { forgetCachedMe, readCachedMe, writeCachedMe } from "./cachedMe";
import type { MeResponse } from "@/lib/api/me";

function me(over: Partial<MeResponse["user"]> = {}): MeResponse {
  return {
    user: {
      id: "user-1",
      email: "buyer@example.ie",
      role: "retailer",
      storeName: "Corner Shop",
      ...over,
    } as MeResponse["user"],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("remembering and reading back", () => {
  it("returns what was written", () => {
    writeCachedMe(me());
    expect(readCachedMe()?.user.email).toBe("buyer@example.ie");
  });

  it("returns nothing when nothing was written", () => {
    expect(readCachedMe()).toBeNull();
  });

  it("forgets on request", () => {
    writeCachedMe(me());
    forgetCachedMe();
    expect(readCachedMe()).toBeNull();
  });
});

describe("whose details these are", () => {
  it("refuses a record written for a different account", () => {
    writeCachedMe(me({ id: "user-1" }));

    // Two people sharing a browser in a shop office. Without the check, the
    // second sees the first person's name over their own data.
    expect(readCachedMe("user-2")).toBeNull();
  });

  it("returns it when the account matches", () => {
    writeCachedMe(me({ id: "user-1" }));
    expect(readCachedMe("user-1")?.user.id).toBe("user-1");
  });
});

describe("what it refuses to believe", () => {
  it("ignores a record older than a week", () => {
    writeCachedMe(me());

    const raw = JSON.parse(window.localStorage.getItem("retailcompare.me.v1")!);
    raw.at = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem("retailcompare.me.v1", JSON.stringify(raw));

    // Not a freshness guarantee — the background fetch is that. This stops a
    // browser unopened for a month painting a month-old store name.
    expect(readCachedMe()).toBeNull();
  });

  it("ignores a record with no user id", () => {
    window.localStorage.setItem(
      "retailcompare.me.v1",
      JSON.stringify({ at: Date.now(), userId: "user-1", me: { user: {} } }),
    );
    expect(readCachedMe()).toBeNull();
  });

  it("ignores anything that is not the shape it wrote", () => {
    window.localStorage.setItem("retailcompare.me.v1", "not json at all");
    expect(readCachedMe()).toBeNull();
  });
});

describe("storage that does not work", () => {
  it("reads as empty when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("The operation is insecure.");
    });

    // A private window, or site data blocked. The header must still paint.
    expect(() => readCachedMe()).not.toThrow();
    expect(readCachedMe()).toBeNull();
  });

  it("does not throw when the write fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // The app works without the cache — that is the whole point of treating it
    // as one rather than as state.
    expect(() => writeCachedMe(me())).not.toThrow();
  });

  it("does not throw when clearing fails", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("The operation is insecure.");
    });

    expect(() => forgetCachedMe()).not.toThrow();
  });
});
