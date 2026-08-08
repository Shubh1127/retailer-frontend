"use client";

/**
 * Session gate.
 *
 * Applied once at the root layout rather than per page: a gate each page has to
 * remember is a gate a new page eventually forgets. Public routes are named
 * here, so opening one up is a deliberate edit to a short list instead of an
 * omission nobody notices.
 *
 * WHY IT REDIRECTS RATHER THAN DRAWING A FORM
 *
 * The login page exists and can be linked to, so sending people there keeps one
 * sign-in screen in the app. It carries `next` so a visitor stopped on the way
 * to a job lands on that job afterwards, rather than on a generic dashboard
 * having lost what they were doing.
 *
 * WHY A BLOCKED ACCOUNT GETS ITS OWN STATE
 *
 * "Signed out" and "blocked" look identical to a naive gate and are opposite
 * problems: one is fixed by signing in, the other cannot be. Redirecting a
 * blocked user to the login form loops them through a sign-in that succeeds at
 * Supabase and then fails at our API, forever.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { whoAmI, type Me } from "@/lib/api/me";

/**
 * Routes a signed-out visitor may see.
 *
 * The marketing homepage is public because it is what convinces somebody to
 * sign up; `/login` obviously has to be, or signing in would require being
 * signed in.
 */
const PUBLIC_PATHS = new Set(["/", "/login"]);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

type State =
  | { phase: "checking" }
  | { phase: "public" }
  | { phase: "redirecting" }
  | { phase: "blocked"; message: string }
  | { phase: "ready"; me: Me };

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "checking" });

  const check = useCallback(async () => {
    if (isPublic(pathname)) {
      setState({ phase: "public" });
      return;
    }

    if (!isSupabaseConfigured()) {
      setState({ phase: "redirecting" });
      router.replace("/login");
      return;
    }

    try {
      setState({ phase: "ready", me: await whoAmI() });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message : "Sign in to continue";

      // 403 from our API means the token is fine and the account is not.
      if (status === 403) {
        setState({ phase: "blocked", message });
        return;
      }

      setState({ phase: "redirecting" });
      const params = new URLSearchParams({ next: pathname });
      // A 401 is just "not signed in" and needs no explanation. Anything else —
      // the backend being unreachable, say — is worth repeating on the form,
      // because otherwise it looks like the password was wrong.
      if (status && status !== 401) params.set("reason", message);
      router.replace(`/login?${params.toString()}`);
    }
  }, [pathname, router]);

  useEffect(() => {
    void check();
  }, [check]);

  if (state.phase === "public") return <>{children}</>;

  if (state.phase === "checking" || state.phase === "redirecting") {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] text-ink-soft">
        Checking your session…
      </div>
    );
  }

  if (state.phase === "blocked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center">
          <h1 className="text-[15px] font-semibold text-ink">Account blocked</h1>
          <p className="mt-2 text-[13px] text-ink-soft">{state.message}</p>
          <button
            type="button"
            onClick={async () => {
              await supabase().auth.signOut();
              router.replace("/login");
            }}
            className="mt-4 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:bg-canvas"
          >
            Sign in as someone else
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
