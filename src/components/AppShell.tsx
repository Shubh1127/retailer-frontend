"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMe,
  MeError,
  type MeResponse,
} from "@/lib/api/me";
import { reportSession } from "@/lib/api/session";
import { supabase } from "@/lib/supabase";
import ThemeToggle from "@/components/ThemeToggle";
import MobileTabBar from "@/components/MobileTabBar";
import FirstLoginRedirect from "@/components/FirstLoginRedirect";
import { forgetCachedMe, readCachedMe, writeCachedMe } from "@/lib/cachedMe";
import NavIcon, { type NavIconName } from "@/components/NavIcons";

/**
 * `icon` names the SAME glyph the mobile tab bar draws for the destination.
 * The bar is icon-only, so its pictures are its labels; a header showing a
 * different one for the same route would teach two things for one place.
 */
const tabs: {
  href: string;
  label: string;
  enabled: boolean;
  icon: NavIconName;
}[] = [
  { href: "/dashboard", label: "Dashboard", enabled: true, icon: "home" },
  { href: "/jobs", label: "Jobs", enabled: true, icon: "jobs" },
  { href: "/scan", label: "Scan", enabled: true, icon: "scan" },
  { href: "/product-search", label: "Product search", enabled: true, icon: "search" },
  { href: "/orders", label: "Order list", enabled: true, icon: "list" },
  // Compare, Reconcile and Mappings used to sit here greyed out with a
  // "Coming soon" tooltip. Six months of that teaches people to read past the
  // nav rather than along it, and they cost width the real destinations wanted.
  // They come back when they exist.
  //
  // Suppliers, Baskets and Account are reachable from the avatar menu instead
  // — see AccountMenu.
  //
  // BASKETS MOVED THERE TOO. It reads like a destination and is really a
  // review: the working paths all END at a basket — a job's Add, a scan's Add,
  // a search's Add — so it is where you go to check what those put there, not
  // where you go to do something. Off the nav, the five that remain are the
  // five things a retailer actually starts.
];

/**
 * A click-to-open panel.
 *
 * WHY NOT HOVER
 *
 * These panels were opened on hover, which failed in two ways. The panel sits
 * 8px below its trigger, so moving the pointer down to it left the hover area
 * and shut it before it could be reached — the gap was unclosable by design.
 * And both panels contain buttons; a menu you have to keep hovering to use
 * cannot be operated by keyboard at all, and is painful with a trackpad or on
 * touch, where there is no hover to begin with.
 *
 * Click to open, click outside or press Escape to close. The panel then stays
 * put while it is being used, which is the whole point of it.
 */
function Popover({
  label,
  trigger,
  triggerClassName,
  children,
}: {
  /** Accessible name for the trigger. */
  label: string;
  trigger: React.ReactNode;
  triggerClassName: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    // `mousedown` rather than `click`: a click that starts inside the panel and
    // ends outside it — a drag to select text — should not close it.
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-line bg-surface p-3 text-left shadow-lg">
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * A person's display name, from their email.
 *
 * "sarah.murphy@example.com" becomes "Sarah Murphy". A guess, but a far better
 * one than the address itself in a navbar — and it is only ever chrome: the
 * email is shown in full in the panel underneath, where it is the thing that
 * actually identifies the account.
 */
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

/** Up to two initials for the avatar. */
function initials(email: string | undefined): string {
  const name = displayName(email);
  if (name === "Account") return "?";
  const parts = name.split(" ").filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase());
  return letters.join("") || "?";
}


function AccountMenu({ me }: { me: MeResponse["user"] }) {
  const router = useRouter();

  return (
    // `text-canvas` rather than `text-white`: `ink` inverts between themes, so
    // hard white initials vanish against a near-white avatar in dark mode.
    <Popover
      label="Account"
      triggerClassName="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-canvas"
      trigger={initials(me.email)}
    >
      {(close) => (
        <>
          <div className="text-[13px] font-semibold text-ink">
            {displayName(me.email)}
          </div>
          <div className="truncate text-[11.5px] text-ink-faint">{me.email}</div>

          <div className="mt-2 space-y-1 border-t border-line pt-2 text-[12px] text-ink-soft">
            {me.storeName && (
              <div>
                <span className="font-medium text-ink">Store:</span> {me.storeName}
              </div>
            )}
            <div>
              <span className="font-medium text-ink">Role:</span>{" "}
              {me.role === "admin" ? "Administrator" : "Retailer"}
            </div>
          </div>

          {/* Baskets and Suppliers. The account details are already ABOVE —
              name, store, role — and the theme is the button beside this
              avatar, so a link called "Account" here would lead to a page
              repeating what the panel it was opened from already said. It
              stays a phone destination, where the header does not exist. */}
          <div className="mt-2 border-t border-line pt-2">
            <Link
              href="/baskets"
              onClick={close}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink-soft hover:bg-canvas hover:text-ink"
            >
              <NavIcon name="basket" size={15} />
              Baskets
            </Link>
            <Link
              href="/suppliers"
              onClick={close}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink-soft hover:bg-canvas hover:text-ink"
            >
              <NavIcon name="store" size={15} />
              Suppliers
            </Link>
          </div>

          <button
            type="button"
            onClick={async () => {
              // Closed first: the sign-out and redirect are asynchronous, and a
              // menu left hanging open over a changing page looks like a freeze.
              close();
              // The next person at this machine must not see the last one's
              // name while their own is being fetched. Cleared before the sign
              // out rather than after, so a redirect cannot outrun it.
              forgetCachedMe();
              // Reported BEFORE the sign-out: afterwards there is no token left to
              // authenticate the report with, and an unauthenticated one is dropped.
              await reportSession("signed-out");
              await supabase().auth.signOut();
              router.replace("/login");
            }}
            className="mt-3 w-full rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-canvas hover:text-ink"
          >
            Sign out
          </button>
        </>
      )}
    </Popover>
  );
}

export default function AppShell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  /**
   * PAINTED FROM THE LAST ANSWER, then corrected by a fresh one.
   *
   * The lazy initialiser runs during the first render, so the header arrives
   * with the page instead of a beat after it. `/api/me` is the same answer
   * every time for the same person, and it was being asked on every single
   * page load — name, store and avatar all appearing late.
   *
   * The cache never decides what is TRUE. The request below still goes out on
   * every mount and overwrites whatever was shown.
   */
  const [me, setMe] = useState<MeResponse | null>(() =>
    typeof window === 'undefined' ? null : readCachedMe(),
  );

  useEffect(() => {
    let cancelled = false;
    // The gate has already established there is a session by the time any page
    // renders this, so a failure here is not worth a visible error — it costs
    // the chrome, not the page.
    void getMe()
      .then((result) => {
        if (cancelled) return;
        setMe(result);
        writeCachedMe(result);
      })
      .catch((error: unknown) => {
        /**
         * A REJECTED SESSION MUST NOT LEAVE A NAME ON SCREEN.
         *
         * Any other failure — offline, a 500 — is worth riding out on the
         * cached details, which is the point of having them. A 401 is
         * different: the server has disowned this session, and continuing to
         * show whose it was would be the one lie this cache could tell.
         */
        if (error instanceof MeError && error.status === 401) {
          forgetCachedMe();
          setMe(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Offers Get Started once, on a genuine first sign-in with nothing
          connected. Renders nothing; see the component. */}
      <FirstLoginRedirect />

      {/*
       * DESKTOP ONLY. On a phone the bottom tab bar is the navigation, and a
       * header carrying a second copy of it — plus a logo, a theme button and
       * an avatar — spent the top of a small screen on chrome. Everything it
       * held is reachable: the tabs from the bar, the account and the theme
       * from Account, which the bar's last button opens.
       */}
      <header className="sticky top-0 z-40 hidden border-b border-line bg-surface/90 backdrop-blur lg:block">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500 text-[13px] font-bold text-white">
              R
            </span>
            <span className="hidden text-[15px] font-semibold tracking-tight text-ink sm:inline">
              RetailCompare
            </span>
          </Link>

          <nav className="hidden flex-1 items-center justify-center gap-0.5 lg:flex">
            {tabs.map((t) =>
              t.enabled ? (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    active === t.label
                      ? "bg-teal-50 text-link"
                      : "text-ink-soft hover:bg-canvas hover:text-ink"
                  }`}
                >
                  <NavIcon name={t.icon} active={active === t.label} />
                  {t.label}
                </Link>
              ) : (
                <div key={t.href} className="group relative">
                  <span className="flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-faint">
                    <NavIcon name={t.icon} />
                    {t.label}
                  </span>

                  {/* Same inversion as the avatar: `bg-ink` flips with the
                      theme, so the label must flip with it. */}
                  <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[11px] text-canvas opacity-0 shadow transition-opacity duration-200 group-hover:opacity-100">
                    Coming soon
                  </div>
                </div>
              ),
            )}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            {/* Nothing is rendered until the real values arrive. A placeholder
                name that is replaced a moment later reads as the app having
                signed you in as somebody else. */}
            {me && (
              <>
                {me.user.storeName && (
                  <span className="hidden text-[12.5px] font-medium text-ink sm:inline">
                    {me.user.storeName}
                  </span>
                )}
              </>
            )}

            <ThemeToggle />

            {me ? (
              <AccountMenu me={me.user} />
            ) : (
              <div className="h-8 w-8 rounded-full bg-canvas" />
            )}
          </div>
        </div>
      </header>
      {/* `pb-24` on mobile clears the fixed tab bar. Without it the last row
          of every table sits underneath it, permanently unreachable. */}
      {/* `pb-24` clears the fixed tab bar; without it the last row of every
          table sits underneath it, permanently unreachable. */}
      <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-5 sm:px-6 lg:py-8 lg:pb-8">
        {children}
      </main>

      <MobileTabBar />
    </div>
  );
}
