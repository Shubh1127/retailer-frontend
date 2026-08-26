"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forgetLocation,
  getMe,
  shareLocation,
  type MeLocation,
  type MeResponse,
} from "@/lib/api/me";
import { reportSession } from "@/lib/api/session";
import { supabase } from "@/lib/supabase";
import ThemeToggle from "@/components/ThemeToggle";

const tabs = [
  { href: "/dashboard", label: "Dashboard", enabled: true },
  { href: "/jobs", label: "Jobs", enabled: true },
  { href: "/scan", label: "Scan", enabled: true },
  { href: "/product-search", label: "Product search", enabled: true },
  { href: "/orders", label: "Order list", enabled: true },
  { href: "/compare", label: "Compare", enabled: false },
  { href: "/baskets", label: "Baskets", enabled: true },
  { href: "/reconcile", label: "Reconcile", enabled: false },
  { href: "/mappings", label: "Mappings", enabled: false },
  { href: "/suppliers", label: "Suppliers", enabled: true },
];

function PinIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

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

/**
 * The location chip.
 *
 * Shows what is actually known, and says which kind it is. A location guessed
 * from an IP block and one the user deliberately shared are different facts, and
 * presenting them identically would overstate the first.
 *
 * Permission is only ever requested by pressing the button. Calling
 * `getCurrentPosition` on mount would fire the browser's prompt at somebody who
 * has not asked for the feature, which is the surest way to get it denied
 * permanently.
 */
function LocationChip({
  location,
  onChanged,
}: {
  location: MeLocation;
  onChanged: (next: MeLocation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This browser cannot report a location.");
      return;
    }

    setBusy(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const next = await shareLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            ...(Number.isFinite(position.coords.accuracy)
              ? { accuracyMetres: position.coords.accuracy }
              : {}),
          });
          onChanged(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save the location");
        } finally {
          setBusy(false);
        }
      },
      (positionError) => {
        setBusy(false);
        // The three cases mean genuinely different things, and "could not get
        // location" for all of them tells somebody nothing about what to do.
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location permission was declined. You can allow it in your browser's site settings."
            : positionError.code === positionError.POSITION_UNAVAILABLE
              ? "Your device could not determine a position."
              : "Timed out finding your location.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, [onChanged]);

  const forget = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await forgetLocation());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the location");
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  return (
    <div className="hidden sm:block">
      <Popover
        label="Location settings"
        triggerClassName="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-ink-soft hover:bg-canvas hover:text-ink"
        trigger={
          <>
            <PinIcon />
            <span>
              {location.label ?? "Location not set"}
              {location.source === "ip" && (
                <span className="ml-1 text-ink-faint">(approx.)</span>
              )}
            </span>
          </>
        }
      >
        {() => (
          <>
            <div className="text-xs font-semibold text-ink">Location</div>

            <div className="mt-2 space-y-1.5 text-[12px] text-ink-soft">
              <div>
                <span className="font-medium text-ink">Showing:</span>{" "}
                {location.label ?? "Nothing yet"}
              </div>
              <div>
                <span className="font-medium text-ink">Source:</span>{" "}
                {location.source === "precise"
                  ? "Shared from your device"
                  : location.source === "ip"
                    ? "Estimated from your network address"
                    : "Unknown"}
              </div>
              {location.source === "precise" &&
                location.accuracyMetres !== undefined && (
                  <div>
                    <span className="font-medium text-ink">Accurate to:</span> about{" "}
                    {Math.round(location.accuracyMetres)} m
                  </div>
                )}

              {error && (
                <div className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
                  {error}
                </div>
              )}

              {location.canAsk ? (
                <>
                  <p className="pt-1 text-[11.5px] text-ink-faint">
                    Sharing your location sets your store&apos;s region. Your
                    browser will ask first, and you can remove it at any time.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={ask}
                    className="mt-1 w-full rounded-md bg-teal-500 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-teal-600 disabled:opacity-50"
                  >
                    {busy ? "Locating…" : "Use my location"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={forget}
                  className="mt-1 w-full rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-50"
                >
                  {busy ? "Working…" : "Remove my location"}
                </button>
              )}
            </div>
          </>
        )}
      </Popover>
    </div>
  );
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

          <button
            type="button"
            onClick={async () => {
              // Closed first: the sign-out and redirect are asynchronous, and a
              // menu left hanging open over a changing page looks like a freeze.
              close();
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
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The gate has already established there is a session by the time any page
    // renders this, so a failure here is not worth a visible error — it costs
    // the chrome, not the page.
    void getMe()
      .then((result) => {
        if (!cancelled) setMe(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onLocationChanged = useCallback((location: MeLocation) => {
    setMe((current) => (current ? { ...current, location } : current));
  }, []);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
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
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    active === t.label
                      ? "bg-teal-50 text-link"
                      : "text-ink-soft hover:bg-canvas hover:text-ink"
                  }`}
                >
                  {t.label}
                </Link>
              ) : (
                <div key={t.href} className="group relative">
                  <span className="cursor-not-allowed whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-faint">
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
                <LocationChip location={me.location} onChanged={onLocationChanged} />
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
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
