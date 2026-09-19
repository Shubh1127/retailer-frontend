/**
 * The session cache and the hook over it.
 *
 * THE RULE THIS FILE EXISTS TO DEFEND: optimistic state may reach the screen,
 * and must never reach the cache. Everything else here is detail. If `show`
 * ever starts writing through, a failed write becomes a remembered success —
 * come back to the page and it shows a quantity no server ever agreed to, with
 * nothing left in flight to correct it. That is a silent wrong-order bug, and
 * it is invisible until a delivery arrives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import { cacheKeys, clearCache, readCache, writeCache } from "./sessionCache";
import { useCachedResource } from "./useCachedResource";

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("the session cache", () => {
  it("gives back what it was given", () => {
    writeCache("thing", { a: 1 });
    expect(readCache<{ a: number }>("thing")).toEqual({ a: 1 });
  });

  it("forgets an answer that is too old to paint", () => {
    writeCache("thing", { a: 1 });
    expect(readCache("thing", { maxAgeMs: -1 })).toBeUndefined();
  });

  it("refuses a record written for somebody else", () => {
    // Two people share a shop-office machine; signing out and in again happens
    // in one tab. The previous account's cart is wrong, not stale.
    writeCache("thing", { a: 1 }, { userId: "user-a" });
    expect(readCache("thing", { userId: "user-b" })).toBeUndefined();
    expect(readCache("thing", { userId: "user-a" })).toEqual({ a: 1 });
  });

  it("survives storage that throws or holds rubbish", () => {
    window.sessionStorage.setItem("retailcompare.cache.v1.broken", "{not json");
    expect(readCache("broken")).toBeUndefined();

    const original = window.sessionStorage.setItem;
    window.sessionStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    // A page that failed to render because a cache write threw would be a worse
    // bug than the one the cache fixes.
    expect(() => writeCache("thing", { a: 1 })).not.toThrow();
    window.sessionStorage.setItem = original;
  });

  it("clears only its own keys", () => {
    writeCache("mine", { a: 1 });
    window.sessionStorage.setItem("supabase.auth.token", "keep-me");

    clearCache();

    expect(readCache("mine")).toBeUndefined();
    expect(window.sessionStorage.getItem("supabase.auth.token")).toBe("keep-me");
  });

  it("names its keys in one place, varying by what is shown", () => {
    expect(cacheKeys.orderCart("scan", 2)).not.toBe(cacheKeys.orderCart("all", 2));
    expect(cacheKeys.orderCart("all", 1)).not.toBe(cacheKeys.orderCart("all", 2));
  });
});

// ---------------------------------------------------------------------------

function Probe({
  fetcher,
  onReady,
}: {
  fetcher: () => Promise<string>;
  onReady?: (api: ReturnType<typeof useCachedResource<string>>) => void;
}) {
  const resource = useCachedResource<string>("probe", fetcher);
  onReady?.(resource);

  return (
    <div>
      <span data-testid="data">{resource.data ?? "—"}</span>
      <span data-testid="loading">{String(resource.loading)}</span>
      <span data-testid="revalidating">{String(resource.revalidating)}</span>
    </div>
  );
}

describe("coming back to a page", () => {
  it("fetches on a first visit, and remembers the answer", async () => {
    const fetcher = vi.fn().mockResolvedValue("from server");
    render(<Probe fetcher={fetcher} />);

    // Nothing cached: there is genuinely nothing to show yet.
    expect(screen.getByTestId("loading").textContent).toBe("true");

    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("from server"));
    expect(readCache<string>("probe")).toBe("from server");
  });

  it("paints the cached answer on the FIRST render, with no loading state", async () => {
    writeCache("probe", "from cache");
    const fetcher = vi.fn().mockResolvedValue("from server");

    render(<Probe fetcher={fetcher} />);

    // The whole point: it is on screen before the request has even been made.
    expect(screen.getByTestId("data").textContent).toBe("from cache");
    expect(screen.getByTestId("loading").textContent).toBe("false");

    // And it still checks, replacing what it showed.
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("from server"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps showing the old answer when the refetch fails", async () => {
    writeCache("probe", "from cache");
    render(<Probe fetcher={vi.fn().mockRejectedValue(new Error("offline"))} />);

    await waitFor(() => expect(screen.getByTestId("revalidating").textContent).toBe("false"));
    // A working list beats an error banner over an empty one.
    expect(screen.getByTestId("data").textContent).toBe("from cache");
  });
});

describe("optimistic state never reaches the cache", () => {
  it("show() changes the screen and not the cache", async () => {
    let api: ReturnType<typeof useCachedResource<string>> | undefined;
    render(<Probe fetcher={vi.fn().mockResolvedValue("server")} onReady={(a) => { api = a; }} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("server"));

    act(() => api!.show("optimistic"));

    expect(screen.getByTestId("data").textContent).toBe("optimistic");
    // THE ASSERTION THIS FILE IS FOR.
    expect(readCache<string>("probe")).toBe("server");
  });

  it("commit() changes both, because the server said so", async () => {
    let api: ReturnType<typeof useCachedResource<string>> | undefined;
    render(<Probe fetcher={vi.fn().mockResolvedValue("server")} onReady={(a) => { api = a; }} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("server"));

    act(() => api!.commit("confirmed"));

    expect(screen.getByTestId("data").textContent).toBe("confirmed");
    expect(readCache<string>("probe")).toBe("confirmed");
  });

  it("persist() caches what is on screen, for writes that answer ok rather than with an object", async () => {
    let api: ReturnType<typeof useCachedResource<string>> | undefined;
    render(<Probe fetcher={vi.fn().mockResolvedValue("server")} onReady={(a) => { api = a; }} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("server"));

    // The quantity moves first…
    act(() => api!.show("quantity 5"));
    expect(readCache<string>("probe")).toBe("server");

    // …and is only remembered once the write comes back.
    act(() => api!.persist());
    expect(readCache<string>("probe")).toBe("quantity 5");
  });

  it("a failed write leaves the cache holding the last confirmed answer", async () => {
    let api: ReturnType<typeof useCachedResource<string>> | undefined;
    render(<Probe fetcher={vi.fn().mockResolvedValue("server")} onReady={(a) => { api = a; }} />);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("server"));

    act(() => api!.show("quantity 5"));
    // The write rejects, so `persist` is never reached and the page re-reads.
    expect(readCache<string>("probe")).toBe("server");
  });
});
