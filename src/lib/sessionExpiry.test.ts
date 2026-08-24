/**
 * What the app does when the session dies while it is open.
 *
 * With a 30-minute inactivity timeout the common case is not a closed browser.
 * It is a tab left open on the shop floor: the person walks away, Supabase
 * times the session out, and the browser still holds a JWT that has not expired
 * on a page that still looks signed in. Nothing appears wrong until they touch
 * something.
 *
 * The backend rejects that request — verified against the live project, where a
 * dead session returns 403 from introspection and becomes a 401 here. These
 * tests cover the other half: that the 401 puts them back at sign-in rather
 * than showing an error on a page they are no longer authenticated for.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));

vi.mock("./supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: () => ({ auth: { signOut: signOutMock } }),
  accessToken: vi.fn().mockResolvedValue("tok-1"),
}));

const { handleSessionExpired, resetSessionExpiryGuard } = await import("./sessionExpiry");

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionExpiryGuard();
  signOutMock.mockResolvedValue({ error: null });

  // jsdom's location cannot be reassigned, so it is replaced wholesale.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: "/jobs/abc", search: "?tab=ready", assign },
  });
});

afterEach(() => vi.restoreAllMocks());

describe("a session that has expired", () => {
  it("sends the person back to sign-in", async () => {
    await handleSessionExpired();

    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]![0])).toMatch(/^\/login\?/);
  });

  it("remembers where they were, so they land back on it", async () => {
    await handleSessionExpired();

    const url = new URL(String(assign.mock.calls[0]![0]), "https://app.test");
    expect(url.searchParams.get("next")).toBe("/jobs/abc?tab=ready");
  });

  it("says why, rather than dropping them at a bare login form", async () => {
    await handleSessionExpired();

    const url = new URL(String(assign.mock.calls[0]![0]), "https://app.test");
    expect(url.searchParams.get("reason")).toMatch(/timed out/i);
  });

  it("clears the stale token LOCALLY, without calling Supabase", async () => {
    // The session is already dead there, so a round trip to revoke it would
    // only fail — and failing would leave a stale token in storage looking
    // valid to the next page load.
    await handleSessionExpired();

    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
  });

  it("acts once, however many requests fail together", async () => {
    // A page in flight fires several calls at once and they all 401 together.
    await Promise.all([
      handleSessionExpired(),
      handleSessionExpired(),
      handleSessionExpired(),
    ]);

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("still redirects when clearing the token throws", async () => {
    // Storage being unavailable must not strand somebody on a page they are no
    // longer signed in to.
    signOutMock.mockRejectedValue(new Error("storage unavailable"));

    await handleSessionExpired();

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("does nothing when already at sign-in", async () => {
    // The login page's own calls can 401 perfectly normally; redirecting would
    // loop it.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/login", search: "", assign },
    });

    await handleSessionExpired();

    expect(assign).not.toHaveBeenCalled();
  });
});
