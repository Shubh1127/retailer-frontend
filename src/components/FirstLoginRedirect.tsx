"use client";

/**
 * Sending a brand-new retailer to Get Started, once.
 *
 * WHY IT IS A REDIRECT AND NOT A BANNER
 *
 * On a first sign-in the app cannot do anything: no trade account is connected,
 * so a search has nobody to ask and a basket has nowhere to go. A dashboard
 * with a dismissible notice above it invites somebody to dismiss it and then
 * spend five minutes discovering the same fact the hard way.
 *
 * ONLY ON A GENUINE FIRST SIGN-IN, AND ONLY WITH NOTHING CONNECTED. Both
 * conditions, because either alone gets it wrong:
 *
 *   firstLogin alone           would re-route somebody who connected an account
 *                              during this very session, the moment they
 *                              navigated anywhere.
 *   hasConnectedSuppliers      would drag a long-standing retailer who
 *   alone                      disconnected their last account back through an
 *                              onboarding flow they finished a year ago. That
 *                              is what the gate modal is for.
 *
 * ONCE PER SESSION, tracked in `sessionStorage`. A retailer who lands on Get
 * Started and deliberately navigates away must be able to stay away —
 * re-routing them on the next page load is a trap, not an onboarding flow.
 * `sessionStorage` and not `localStorage`: this is a fact about the current
 * visit, and it carries nothing sensitive.
 *
 * IT FAILS SILENT. If the check cannot be made the retailer is left where they
 * are. Nothing here is important enough to interrupt somebody over.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { getOnboardingState } from "@/lib/api/supplierCredentials";

/**
 * Marks that this visit has already been offered the flow — PER USER.
 *
 * `sessionStorage` belongs to the TAB, not to the person. Keyed on the flow
 * alone, a retailer signing in after somebody else signed out inherited the
 * previous person's latch and was silently never offered onboarding — exactly
 * what a new account hits on a browser that has been used for testing.
 */
const seenKey = (userId?: string): string =>
  // A FALLBACK, NOT AN ESCAPE. Without one, a response carrying no user id
  // would skip the latch entirely and re-offer the flow on every navigation —
  // trading the inherited-latch bug for a redirect loop, which is worse.
  `rc.onboarding.offered:${userId ?? "unknown"}`;

function alreadyOffered(userId?: string): boolean {
  try {
    return window.sessionStorage.getItem(seenKey(userId)) === "1";
  } catch {
    // Private browsing, or storage disabled. Treat as "not offered" — the worst
    // case is one extra redirect, which is the behaviour we want anyway.
    return false;
  }
}

function markOffered(userId?: string): void {
  try {
    window.sessionStorage.setItem(seenKey(userId), "1");
  } catch {
    /* nothing to do; see above */
  }
}

/** Re-arm the offer, so a later disconnect can surface it again this visit. */
function clearOffered(userId?: string): void {
  try {
    window.sessionStorage.removeItem(seenKey(userId));
  } catch {
    /* nothing to do; see above */
  }
}

export default function FirstLoginRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Never bounce off the pages that ARE the answer, or the sign-in screen.
    if (
      pathname?.startsWith("/get-started") ||
      pathname?.startsWith("/suppliers") ||
      pathname?.startsWith("/login")
    ) {
      return;
    }

    let cancelled = false;

    /**
     * RETRIED, BECAUSE THE FIRST ATTEMPT RACES THE SESSION.
     *
     * This runs on mount, and on the mount immediately after signing in the
     * Supabase session may not be in storage yet — `accessToken()` reads
     * `getSession()` and can still answer `undefined` for a tick or two. The
     * request then goes out with no Authorization header, the backend answers
     * 401, and the catch below swallowed it. The effect never re-ran, because
     * `pathname` had not changed, so a brand-new retailer was never offered
     * onboarding at all — silently, with nothing on screen or in the console to
     * say why.
     *
     * Everything the retailer clicks LATER works, because by then the session
     * has hydrated. That is exactly why this was so hard to see.
     *
     * A few short attempts, then give up quietly. This is an offer, not a
     * requirement, and it must never become a spinner or a loop.
     */
    const ATTEMPTS = 4;
    const GAP_MS = 400;

    const decide = async () => {
      for (let attempt = 0; attempt < ATTEMPTS && !cancelled; attempt += 1) {
        try {
          const state = await getOnboardingState();
          if (cancelled) return;

          // An admin connects nothing of their own — supplier reads run on the
          // shared accounts — so Get Started would ask them to open four
          // wholesale accounts to use a system that already works for them.
          if (state.usesSharedAccounts) return;

          const { userId } = state;

          /**
           * RE-ARMED THE MOMENT THEY HAVE AN ACCOUNT.
           *
           * The latch stops somebody who deliberately left Get Started being
           * dragged back on the next navigation. But a retailer who later
           * disconnects their last supplier is back in the state this exists
           * for, and a latch set earlier in the same visit would keep them out
           * of it. Clearing it while they ARE connected means the offer is
           * available again the next time they are not.
           */
          if (state.hasConnectedSuppliers) {
            clearOffered(userId);
            return;
          }

          // They deliberately left it earlier in this visit. Their choice stands.
          if (alreadyOffered(userId)) return;

          /**
           * ZERO CONNECTED ACCOUNTS IS THE CONDITION — not "is this their first
           * visit". A retailer with nothing connected cannot do anything the
           * app is for, and that is equally true on their fifth sign-in as on
           * their first.
           *
           * Connecting an account ends it — `hasConnectedSuppliers` goes true
           * and this stops firing — so there is no loop.
           */
          markOffered(userId);
          router.replace("/get-started");
          return;
        } catch (error) {
          const last = attempt === ATTEMPTS - 1;

          if (last) {
            /**
             * SAID, NOT SWALLOWED.
             *
             * Silent was the whole problem: the check failed on every load and
             * left no trace anywhere. A retailer is still not interrupted — the
             * page carries on exactly as before — but anyone looking at why the
             * flow did not appear now has something to find.
             */
            // eslint-disable-next-line no-console
            console.warn("[onboarding] could not check supplier setup —", error);
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, GAP_MS));
        }
      }
    };

    void decide();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
