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
import NavIcon, { type NavIconName } from "@/components/NavIcons";
import { usePathname } from "next/navigation";

interface Tab {
  href: string;
  /** Read aloud, and used as the title. The eye gets the icon. */
  label: string;
  icon: NavIconName;
}

const TABS: Tab[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/orders", label: "Order list", icon: "list" },
  /**
   * `?camera=1` opens the viewfinder on arrival.
   *
   * Tapping a scan icon means "I want to scan", not "show me a page with a
   * button that starts scanning". The page consumes the flag and strips it, so
   * coming BACK to /scan — from the tab bar's own highlight, or the back
   * button — lands on the list rather than reopening the camera.
   */
  { href: "/scan?camera=1", label: "Scan", icon: "scan" },
  { href: "/product-search", label: "Product search", icon: "search" },
  { href: "/settings", label: "Account", icon: "user" },
];

function isActive(pathname: string, href: string): boolean {
  // Compared on the PATH only — `/scan?camera=1` and `/scan` are the same tab,
  // and the query string is an instruction rather than a destination.
  const path = href.split("?")[0] ?? href;
  // Prefix match, so /jobs/<id> keeps its sibling lit and /settings stays lit
  // on any sub-page it grows later.
  return pathname === path || pathname.startsWith(`${path}/`);
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
                <NavIcon name={tab.icon} size={23} active={active} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
