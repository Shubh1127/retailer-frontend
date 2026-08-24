/**
 * The client half of the 30-minute inactivity timeout.
 *
 * The backend is the boundary — it refuses an idle session whatever this does,
 * and that is what stops a token replayed from a script. This exists so a
 * person who walks away comes back to a sign-in page rather than to a screen
 * that still shows their order and fails the moment they touch it.
 *
 * The clock is compared against wall-clock timestamps on a short tick rather
 * than being one long `setTimeout`, because a suspended laptop suspends timers
 * too: a single thirty-minute timeout fires late by however long the machine
 * slept, silently granting a fresh half hour on waking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { watchForIdle, IDLE_TIMEOUT_MS } from "./idleTimer";

const MINUTE = 60_000;

/** A clock the test moves by hand. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Run the interval enough times to cover a stretch of wall-clock time. */
function tickThrough(clock: ReturnType<typeof fakeClock>, ms: number, tickMs = 1000) {
  for (let elapsed = 0; elapsed < ms; elapsed += tickMs) {
    clock.advance(tickMs);
    vi.advanceTimersByTime(tickMs);
  }
}

describe("an idle user", () => {
  it("is signed out after thirty minutes", () => {
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });
    tickThrough(clock, 31 * MINUTE);
    stop();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("is NOT signed out at twenty-nine minutes", () => {
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });
    tickThrough(clock, 29 * MINUTE);
    stop();

    expect(onExpired).not.toHaveBeenCalled();
  });

  it("uses the same thirty minutes the backend does", () => {
    expect(IDLE_TIMEOUT_MS).toBe(30 * MINUTE);
  });
});

describe("an active user", () => {
  it("stays signed in indefinitely", () => {
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

    // Two hours, touching something every ten minutes.
    for (let round = 0; round < 12; round++) {
      tickThrough(clock, 10 * MINUTE);
      window.dispatchEvent(new Event("pointerdown"));
    }
    stop();

    expect(onExpired).not.toHaveBeenCalled();
  });

  it("is saved by activity immediately before the boundary", () => {
    // 29:59 then a keypress. The clock restarts; nothing expires.
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

    tickThrough(clock, 29 * MINUTE + 59_000);
    window.dispatchEvent(new Event("keydown"));
    tickThrough(clock, 29 * MINUTE);
    stop();

    expect(onExpired).not.toHaveBeenCalled();
  });

  it("counts a scroll, a touch and a wheel as being present", () => {
    for (const event of ["scroll", "touchstart", "wheel"]) {
      const clock = fakeClock();
      const onExpired = vi.fn();
      const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

      tickThrough(clock, 25 * MINUTE);
      window.dispatchEvent(new Event(event));
      tickThrough(clock, 25 * MINUTE);
      stop();

      expect(onExpired, `${event} should count as activity`).not.toHaveBeenCalled();
    }
  });

  it("counts coming back to the tab", () => {
    const clock = fakeClock();
    const onExpired = vi.fn();
    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

    tickThrough(clock, 25 * MINUTE);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    tickThrough(clock, 25 * MINUTE);
    stop();

    expect(onExpired).not.toHaveBeenCalled();
  });

  it("does NOT count the tab being hidden", () => {
    // Leaving is not presence. Only returning is.
    const clock = fakeClock();
    const onExpired = vi.fn();
    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    tickThrough(clock, 20 * MINUTE);
    document.dispatchEvent(new Event("visibilitychange"));
    tickThrough(clock, 15 * MINUTE);
    stop();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});

describe("things that must NOT count as activity", () => {
  it("ignores a token refresh, because it listens for no auth events at all", () => {
    // supabase-js renews the JWT on a timer with nobody present. Treating that
    // as activity would keep an abandoned tab signed in for ever, which is the
    // failure this whole feature exists to prevent.
    const clock = fakeClock();
    const onExpired = vi.fn();
    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

    // Whatever a refresh might emit, none of it reaches this watcher.
    tickThrough(clock, 20 * MINUTE);
    window.dispatchEvent(new Event("supabase.auth.token-refreshed"));
    window.dispatchEvent(new Event("focus"));
    tickThrough(clock, 15 * MINUTE);
    stop();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("ignores time passing on its own", () => {
    const clock = fakeClock();
    const onExpired = vi.fn();
    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

    tickThrough(clock, 45 * MINUTE);
    stop();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});

describe("expiring exactly once", () => {
  it("does not fire again on later ticks", () => {
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });
    tickThrough(clock, 60 * MINUTE);
    stop();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("cannot be revived by a late click", () => {
    // The session is already gone at the backend. A click arriving afterwards
    // must not look like it brought it back.
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });
    tickThrough(clock, 31 * MINUTE);
    window.dispatchEvent(new Event("pointerdown"));
    tickThrough(clock, 31 * MINUTE);
    stop();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("stops listening once stopped", () => {
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });
    stop();
    tickThrough(clock, 60 * MINUTE);

    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("a suspended machine", () => {
  it("expires on the wall clock, not on elapsed timer ticks", () => {
    // A laptop lid closed for an hour suspends timers. Comparing timestamps
    // means the very first tick after waking already sees the gap; a single
    // long setTimeout would instead fire late and hand out a fresh half hour.
    const clock = fakeClock();
    const onExpired = vi.fn();

    const stop = watchForIdle({ tickMs: 1000, onExpired, now: clock.now });

    // One tick fires, but an hour of wall-clock time has passed.
    clock.advance(60 * MINUTE);
    vi.advanceTimersByTime(1000);
    stop();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
