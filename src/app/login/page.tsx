"use client";

/**
 * The authentication page.
 *
 * A real page rather than a form the gate draws over whatever you asked for, so
 * it can be bookmarked and returned to after a failed attempt. It is also the
 * ONLY public route in the app: there is no landing page, and `/` redirects
 * into the gated dashboard.
 *
 * `?next=` carries where the visitor was heading. Somebody who follows a link to
 * a job and gets stopped here should land on that job once they sign in, not on
 * a generic dashboard having lost what they were doing.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SignInForm from "@/components/SignInForm";
import { isSupabaseConfigured, accessToken } from "@/lib/supabase";
import { whoAmI } from "@/lib/api/me";

function LoginPanel() {
  const router = useRouter();
  const params = useSearchParams();

  const next = params.get("next") || "/dashboard";
  const reason = params.get("reason");

  const [checking, setChecking] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Already signed in? Then skip the form.
   *
   * "Signed in" has to mean what the GATE means by it, which is `whoAmI` —
   * whether the backend accepts this person — not merely "Supabase issued a
   * token". Checking only for a token created a redirect loop: the token was
   * valid, so this page bounced to the dashboard; the backend rejected it, so
   * the gate bounced back here; forever, with the browser pinging between two
   * URLs and no way to reach the form.
   *
   * Now a backend that refuses leaves the visitor here, on a page with a form
   * and the reason on it.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await accessToken();
      if (cancelled) return;

      if (!token) {
        setChecking(false);
        return;
      }

      try {
        await whoAmI();
        if (!cancelled) router.replace(next);
      } catch (error) {
        if (cancelled) return;
        const status = (error as { status?: number }).status;
        // 401 is just an expired session — the form is the whole answer, and
        // saying "unauthorised" above it would only be noise.
        if (status !== 401) {
          setProblem(error instanceof Error ? error.message : "Could not sign you in");
        }
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  const onSignedIn = useCallback(() => {
    // `replace`, not `push`: the login page must not sit in the back stack, or
    // "back" from the dashboard returns to a form that instantly redirects.
    router.replace(next);
  }, [next, router]);

  if (!isSupabaseConfigured()) {
    return (
      <div className="w-full max-w-sm rounded-xl border border-amber-200 bg-amber-50 p-6 text-[13px] text-amber-900">
        Sign-in is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then rebuild — these are baked
        in at build time, so setting them afterwards has no effect.
      </div>
    );
  }

  if (checking) {
    return <div className="text-[13px] text-ink-soft">Checking your session…</div>;
  }

  // A live failure from the check above outranks the `reason` the gate passed
  // in the URL: the query string says why they were sent here a moment ago, the
  // check says what is wrong right now.
  const message = problem ?? reason;

  return (
    <SignInForm
      onSignedIn={onSignedIn}
      {...(message ? { message } : {})}
    />
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-12">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500 text-[13px] font-bold text-white">
          R
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          RetailCompare
        </span>
      </div>

      {/* useSearchParams needs a Suspense boundary for a static export. */}
      <Suspense fallback={<div className="text-[13px] text-ink-soft">Loading…</div>}>
        <LoginPanel />
      </Suspense>
    </main>
  );
}
