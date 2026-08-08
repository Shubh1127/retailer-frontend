"use client";

import Link from "next/link";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * The landing page's header.
 *
 * The buttons on the right change with the session, because the alternative is
 * showing "Sign in" to somebody who already is — which sends them through a
 * login form that immediately redirects them back out again.
 *
 * While the session is still loading the auth buttons are left out entirely
 * rather than defaulting to "Log in". A signed-in visitor seeing "Log in" flash
 * on every page load reads as having been signed out.
 */
export default function MarketingNav() {
  const session = useSession();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500 text-[13px] font-bold text-white">
            R
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">RetailCompare</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          <a href="#how" className="text-[13.5px] font-medium text-ink-soft hover:text-ink">How it works</a>
          <a href="#suppliers" className="text-[13.5px] font-medium text-ink-soft hover:text-ink">Suppliers</a>
          <a href="#trust" className="text-[13.5px] font-medium text-ink-soft hover:text-ink">Trust &amp; controls</a>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {session.loading ? null : session.signedIn ? (
            <>
              <span className="hidden text-[13px] text-ink-faint sm:inline">
                {session.email}
              </span>
              <button
                type="button"
                onClick={() => void supabase().auth.signOut()}
                className="hidden text-[13.5px] font-medium text-ink-soft hover:text-ink sm:inline"
              >
                Sign out
              </button>
              <Link
                href="/dashboard"
                className="rounded-md bg-teal-500 px-3.5 py-2 text-[13.5px] font-medium text-white shadow-card hover:bg-teal-600"
              >
                Go to dashboard
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-2 text-[13.5px] font-medium text-ink-soft hover:text-ink"
              >
                Log in
              </Link>
              <Link
                href="/login?mode=signup"
                className="rounded-md bg-teal-500 px-3.5 py-2 text-[13.5px] font-medium text-white shadow-card hover:bg-teal-600"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
