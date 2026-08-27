"use client";

/**
 * Account, and everything that is settings rather than work.
 *
 * A PAGE, NOT A POPOVER — because of the phone. On a desktop the account menu
 * in the header is fine: a small panel next to the thing that opened it. On a
 * phone that is a cramped overlay reached from a corner, and the bottom tab bar
 * needs a real destination with a real URL to send people to.
 *
 * IT IS ALSO THE PHONE'S OVERFLOW MENU. The tab bar holds five things, which is
 * all a thumb reaches across a small screen. Jobs, Baskets and Suppliers are
 * real destinations that did not make that cut, and on a phone the header they
 * used to live in is hidden — so they are listed here. On a desktop they are
 * still in the header or the avatar menu, and these links are simply a second
 * way in.
 *
 * WHY ACCESSIBILITY SLIDES IN RATHER THAN EXPANDING
 *
 * It is a separate subject with its own options, and a phone screen has room
 * for one subject at a time. Sliding it in from the right — and back out to the
 * left — is the gesture every mobile settings app uses for "deeper", so the
 * back arrow needs no explanation. `AnimatePresence` keeps the outgoing panel
 * mounted long enough to leave, which is what makes it read as one surface
 * moving rather than two surfaces swapping.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

import AppShell from "@/components/AppShell";
import { reportSession } from "@/lib/api/session";
import { supabase } from "@/lib/supabase";
import { getMe, type MeResponse } from "@/lib/api/me";
import { applyTheme, readChoice, resolve, setChoice, type ThemeChoice } from "@/lib/theme";

/** A person's display name, from their email. Mirrors the header's own rule. */
function displayName(email: string | undefined): string {
  if (!email) return "Account";
  const local = email.split("@")[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || email
  );
}

function initials(email: string | undefined): string {
  return displayName(email)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function ChevronRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** One row that goes somewhere. */
function NavRow({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-canvas"
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] text-ink">{label}</span>
        {hint && <span className="block text-[11.5px] text-ink-faint">{hint}</span>}
      </span>
      <span className="text-ink-faint">
        <ChevronRight />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

const THEMES: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Always light, whatever the device is set to" },
  { value: "dark", label: "Dark", hint: "Always dark — easier in a cold store or a back room" },
  { value: "system", label: "Match my device", hint: "Follows the phone's own light/dark schedule" },
];

function Accessibility() {
  /**
   * Starts as "system" so the first render matches the server's HTML, exactly
   * as ThemeToggle does. Reading localStorage during render would make the
   * markup differ and React would report a hydration mismatch.
   */
  const [choice, setLocalChoice] = useState<ThemeChoice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLocalChoice(readChoice());
    setMounted(true);
  }, []);

  // While the choice is "system", follow the device as it changes — somebody on
  // an automatic schedule should see this switch with everything else.
  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(resolve("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  const pick = (next: ThemeChoice) => {
    setChoice(next);
    setLocalChoice(next);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-3 text-[13.5px] font-semibold text-ink">
        Appearance
      </h2>

      <div role="radiogroup" aria-label="Theme">
        {THEMES.map((theme) => {
          // Until mounted the stored choice is unknown, so nothing is shown as
          // selected rather than briefly showing the wrong one.
          const selected = mounted && choice === theme.value;

          return (
            <button
              key={theme.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(theme.value)}
              className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-canvas"
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] text-ink">{theme.label}</span>
                <span className="block text-[11.5px] text-ink-faint">{theme.hint}</span>
              </span>

              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-teal-600 bg-teal-600" : "border-line"
                }`}
              >
                {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

type Panel = "main" | "accessibility";

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [panel, setPanel] = useState<Panel>("main");

  useEffect(() => {
    let cancelled = false;
    void getMe()
      .then((result) => {
        if (!cancelled) setMe(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load your account");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    // Reported BEFORE the sign-out: afterwards there is no token left to
    // authenticate the report with, and an unauthenticated one is dropped.
    await reportSession("signed-out");
    await supabase().auth.signOut();
    router.replace("/login");
  }, [router]);

  /**
   * One transition, mirrored.
   *
   * Deeper enters from the right and leaves to the right; back does the
   * opposite. Reusing one definition is what keeps them consistent — two
   * hand-written variants drift, and a panel that leaves the way it came in
   * reads as a glitch rather than as going back.
   */
  const slide = {
    initial: (deeper: boolean) => ({ x: deeper ? "100%" : "-100%", opacity: 0 }),
    animate: { x: 0, opacity: 1 },
    exit: (deeper: boolean) => ({ x: deeper ? "100%" : "-100%", opacity: 0 }),
  };

  return (
    <AppShell active="Account">
      {/* `overflow-x-hidden`, or the panel sliding in from off-screen widens
          the page and the whole layout scrolls sideways mid-animation. */}
      <div className="relative max-w-md overflow-x-hidden">
        <AnimatePresence mode="wait" initial={false} custom={panel === "accessibility"}>
          {panel === "main" ? (
            <motion.div
              key="main"
              custom={false}
              variants={slide}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.28 }}
            >
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">Account</h1>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                Who you are signed in as, and how this app behaves on this device.
              </p>

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                  {error}
                </div>
              )}

              <div className="mt-5 space-y-4">
                {/* ---- Who ---- */}
                <section className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-canvas">
                      {me ? initials(me.user.email) : "—"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-ink">
                        {me ? displayName(me.user.email) : "Loading…"}
                      </p>
                      <p className="truncate text-[12px] text-ink-faint">
                        {me?.user.email ?? ""}
                      </p>
                    </div>
                  </div>

                  {me && (
                    <div className="mt-3 space-y-1 border-t border-line pt-3 text-[12.5px] text-ink-soft">
                      {me.user.storeName && (
                        <div>
                          <span className="font-medium text-ink">Store:</span>{" "}
                          {me.user.storeName}
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-ink">Role:</span>{" "}
                        {me.user.role === "admin" ? "Administrator" : "Retailer"}
                      </div>
                    </div>
                  )}
                </section>

                {/* ---- Settings ---- */}
                <section className="overflow-hidden rounded-xl border border-line bg-surface">
                  <button
                    type="button"
                    onClick={() => setPanel("accessibility")}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-canvas"
                  >
                    <span>
                      <span className="block text-[13.5px] text-ink">Accessibility</span>
                      <span className="block text-[11.5px] text-ink-faint">
                        Light or dark
                      </span>
                    </span>
                    <span className="text-ink-faint">
                      <ChevronRight />
                    </span>
                  </button>
                </section>

                {/* ---- Everywhere the tab bar has no room for ----
                    Five buttons is what a thumb reaches; these are the real
                    destinations that did not fit, and on a phone the header
                    they used to live in is hidden. */}
                <section className="overflow-hidden rounded-xl border border-line bg-surface lg:hidden">
                  <h2 className="border-b border-line px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">
                    More
                  </h2>
                  <NavRow href="/jobs" label="Jobs" hint="Every comparison you have run" />
                  <NavRow
                    href="/baskets"
                    label="Baskets"
                    hint="What is waiting at each supplier"
                  />
                  <NavRow
                    href="/suppliers"
                    label="Suppliers"
                    hint="Connections and their status"
                  />
                </section>

                {/* ---- Out ---- */}
                <section className="rounded-xl border border-line bg-surface p-4">
                  <button
                    type="button"
                    disabled={signingOut || !me}
                    onClick={() => void signOut()}
                    className="w-full rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40"
                  >
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </section>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="accessibility"
              custom
              variants={slide}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.28 }}
            >
              <button
                type="button"
                onClick={() => setPanel("main")}
                className="-ml-1 flex items-center gap-1 rounded-md px-1 py-1 text-[13px] text-ink-soft hover:text-ink"
              >
                <span className="rotate-180">
                  <ChevronRight />
                </span>
                Account
              </button>

              <h1 className="mt-2 text-[19px] font-semibold tracking-tight text-ink">
                Accessibility
              </h1>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                How this app looks on this device. The choice is remembered here, not on
                your account, so a shop tablet and a phone can differ.
              </p>

              <div className="mt-5">
                <Accessibility />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
