"use client";

/**
 * The landing page's calls to action, which depend on who is looking.
 *
 * The page itself is a server component and cannot know about the session, so
 * these are the client islands inside it. `MarketingNav` already worked this
 * way; the body of the page did not, which is why a signed-in retailer was
 * still being told to "Get started free" and offered a login form they had
 * already been through.
 *
 * TWO RULES, BOTH TAKEN FROM THE NAV
 *
 *  1. While the session is loading, never render the signed-OUT state. A
 *     signed-in visitor seeing "Log in" flash on every page load reads as
 *     having been silently signed out.
 *  2. Unlike the nav, these sit in the middle of a layout, so the space is
 *     reserved while loading rather than collapsed — otherwise the hero jumps
 *     as soon as Supabase answers.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/useSession";
import { getMyStats, type MeStats } from "@/lib/api/me";
import { eur } from "@/lib/api/jobs";

const PRIMARY =
  "rounded-md bg-teal-500 px-5 py-2.5 text-[14px] font-medium text-white shadow-card hover:bg-teal-600";
const SECONDARY =
  "rounded-md border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink hover:bg-canvas";

/** Holds the row's height while the session resolves, showing nothing. */
function Placeholder() {
  return (
    <div aria-hidden="true" className="invisible">
      <span className={PRIMARY}>&nbsp;</span>
    </div>
  );
}

export function HeroActions() {
  const session = useSession();

  if (session.loading) {
    return (
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Placeholder />
      </div>
    );
  }

  // Signed in: the two things they actually came back for. Offering "Get
  // started free" to somebody with an account is an invitation to make a
  // second one.
  if (session.signedIn) {
    return (
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/dashboard" className={PRIMARY}>
          Go to your dashboard
        </Link>
        <Link href="/jobs" className={SECONDARY}>
          Job history
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {/* The dashboard needs an account, so this asks for one rather than
          linking straight into a page that would bounce a visitor to the login
          form the moment they arrived. */}
      <Link href="/login?mode=signup" className={PRIMARY}>
        Get started free
      </Link>
      <Link href="/login" className={SECONDARY}>
        Log in
      </Link>
    </div>
  );
}

/**
 * The three headline figures under the hero.
 *
 * Hardcoded until now — "6 wholesalers compared · €30.00 saved this week ·
 * 3.4% of weekly spend" — shown identically to everyone. On a marketing page
 * that reads as illustrative. On a page a SIGNED-IN retailer lands on, "saved
 * this week" reads as their own number, and it was invented. The supplier count
 * was wrong too: six, while two are integrated.
 *
 * So a signed-in retailer gets their real last-7-days figures, and a visitor
 * keeps the illustrative ones — labelled as an example, which they were not
 * before.
 */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="nums text-xl font-semibold text-ink">{value}</p>
      <p className="text-[12.5px] text-ink-soft">{label}</p>
    </div>
  );
}

export function HeroStats() {
  const session = useSession();
  const [stats, setStats] = useState<MeStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!session.signedIn) return;
    let cancelled = false;

    getMyStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        // The hero must render regardless. A stats failure falls back to the
        // illustrative figures rather than leaving three blank slots.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [session.signedIn]);

  const showReal = session.signedIn && stats !== null && !failed;

  return (
    <div className="mt-10 max-w-md border-t border-line pt-6">
      <div className="grid grid-cols-3 gap-6">
        {showReal ? (
          <>
            <Stat
              value={String(stats.suppliers)}
              label={stats.suppliers === 1 ? "wholesaler compared" : "wholesalers compared"}
            />
            {/* Their own number, however small. A retailer who saved nothing
                this week is better served by "€0.00" than by a figure that
                belongs to nobody. */}
            <Stat value={eur(stats.savings)} label={`saved in ${stats.days} days`} />
            <Stat
              value={stats.savingsPct === null ? "—" : `${stats.savingsPct}%`}
              label="of compared spend"
            />
          </>
        ) : (
          <>
            <Stat value="2" label="wholesalers compared" />
            <Stat value="€30.00" label="saved this week" />
            <Stat value="3.4%" label="of weekly spend" />
          </>
        )}
      </div>

      {/* Said outright when the numbers are not the reader's own. */}
      {!showReal && !session.loading && (
        <p className="mt-2 text-[11.5px] text-ink-faint">Example figures</p>
      )}

      {/* Nothing uploaded yet is a real answer, and a more useful one than a
          row of zeros with no explanation. */}
      {showReal && stats.jobs === 0 && (
        <p className="mt-2 text-[11.5px] text-ink-faint">
          No files uploaded in the last {stats.days} days.
        </p>
      )}
    </div>
  );
}

/** "Manage suppliers" goes to the real page once there is somebody to show it to. */
export function SuppliersLink() {
  const session = useSession();

  return (
    <Link
      href={session.signedIn ? "/suppliers" : "/login"}
      className="text-[13.5px] font-medium text-teal-600 hover:text-link"
    >
      Manage suppliers →
    </Link>
  );
}

/**
 * The closing band.
 *
 * The COPY changes too, not just the button — "Create an account, upload your
 * EPOS export" describes a step a signed-in retailer has already taken, and
 * leaving it there would make the page read as though it had not noticed them.
 */
export function ClosingCta() {
  const session = useSession();

  const signedIn = !session.loading && session.signedIn;

  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
      <div>
        {/* Ordinary body tokens, because the band now follows the theme (see
            the `bg-teal-50` wrapper). `ink` is dark on the light tint and light
            on the dark one, so no `dark:` variant is needed and no hard `white`
            can strand the text against a background that moved. */}
        <h2 className="text-[22px] font-semibold text-ink">
          Compare this week&apos;s order list
        </h2>
        <p className="mt-2 text-[14px] text-ink-soft">
          {signedIn
            ? "Upload your EPOS export and see every line priced across your suppliers."
            : "Create an account, upload your EPOS export, and see every line priced across your suppliers."}
        </p>
      </div>
      <Link
        href={signedIn ? "/dashboard" : "/login?mode=signup"}
        className="shrink-0 rounded-md bg-teal-500 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-teal-600"
      >
        {signedIn ? "Upload an order file" : "Create an account"}
      </Link>
    </div>
  );
}
