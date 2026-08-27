"use client";

/**
 * The bottom tab bar, on phones only.
 *
 * WHY IT EXISTS. The header nav is `hidden lg:flex`, so until now a phone got
 * the logo and an avatar and no way to reach anything — which is the wrong way
 * round, because scanning a shelf is the one job on this system that is done on
 * a phone rather than at a desk.
 *
 * FIVE, AND NO MORE. A thumb reaches about five targets across a phone before
 * they get too narrow to hit reliably, so this is the five things a retailer
 * does, not a menu of every route. Jobs, Baskets and Suppliers stay in the
 * header for the desktop, where there is room to read them.
 *
 * ICONS ALONE, DELIBERATELY. Labels at this size are 9px and unreadable, and
 * five of them turn the bar into a wall of text. Each icon carries an
 * `aria-label` instead, so a screen reader gets the words the eye does not
 * need — the shapes are conventional enough (a house, a list, a scan frame, a
 * magnifier, a person) to be read at a glance.
 *
 * ACTIVE STATE COMES FROM THE PATH, not from the `active` label a page passes
 * in. A page that forgets to pass one, or passes a different string, would
 * otherwise leave the bar showing nothing selected.
 *
 * The current tab is marked by the ICON ALONE — colour plus a heavier stroke.
 * There was a dot under it as well, which was one marker too many: it said
 * nothing the colour had not already said, and it pushed the icons off centre
 * in their own row.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 24px line icons, inline so the bar costs no request and no dependency. */
const ICONS = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  /** A scan frame with a beam — read as "scan", where a QR block reads as "code". */
  scan: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M4 12h16" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 18.5a6 6 0 0 1 11 0" />
    </>
  ),
} as const;

interface Tab {
  href: string;
  /** Read aloud, and used as the title. The eye gets the icon. */
  label: string;
  icon: keyof typeof ICONS;
}

const TABS: Tab[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/orders", label: "Order list", icon: "list" },
  { href: "/scan", label: "Scan", icon: "scan" },
  { href: "/product-search", label: "Product search", icon: "search" },
  { href: "/settings", label: "Account", icon: "user" },
];

function isActive(pathname: string, href: string): boolean {
  // Prefix match, so /jobs/<id> keeps Dashboard's sibling lit and /settings
  // stays lit on any sub-page it grows later.
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileTabBar() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Main"
      /**
       * `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the iPhone
       * home indicator, which otherwise sits on top of the middle button —
       * the Scan one, which is the whole reason a phone is being used.
       */
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-label={tab.label}
                title={tab.label}
                aria-current={active ? "page" : undefined}
                // min-h-14: a 56px target, comfortably above the 44px floor a
                // thumb needs, and tall enough that the tap does not land on
                // the page behind it.
                className={`flex min-h-14 items-center justify-center transition-colors ${
                  active ? "text-link" : "text-ink-faint hover:text-ink-soft"
                }`}
              >
                <svg
                  width="23"
                  height="23"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.1 : 1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {ICONS[tab.icon]}
                </svg>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
