"use client";

/**
 * The search box for finding one product, shared by the dashboard and
 * /product-search.
 *
 * SHARED for the same reason `ProductPriceTable` is: the two screens ask one
 * question, and when they each owned their own box they drifted — different
 * placeholders, different submit affordances, and one of them keyboard-
 * submittable while the other looked like it might not be.
 *
 * A REAL FORM, WITH A REAL SUBMIT BUTTON. That is what makes Enter work, on a
 * desktop keyboard and on a phone's "Search" key alike, and it is also what
 * makes a handheld barcode scanner work with no code at all: those present as
 * a keyboard, type the digits and press Enter, which arrives here as an
 * ordinary submit. `enterKeyHint` asks the on-screen keyboard to label its
 * action key "Search" rather than "Go" or a newline arrow.
 *
 * THE ICON IS THE BUTTON, inside the field on the right. A magnifier sitting in
 * the box as decoration is a thing people tap, and tapping decoration does
 * nothing — so it submits. It keeps a 40px target and an accessible name even
 * though nothing about it is text.
 *
 * NOTHING GOES OUT UNTIL IT IS SUBMITTED. This box used to search on a 350ms
 * debounce, which fired several searches while somebody typed "birra moretti
 * premium lager" — one per pause long enough to look like a finished word.
 *
 * ── RECENT SEARCHES ─────────────────────────────────────────────────────────
 *
 * Offered when the field is focused and empty, which is exactly the moment
 * somebody is deciding what to type. They come from this tab's sessionStorage
 * and never leave the browser — see `recentSearches`.
 *
 * Picking one submits it DIRECTLY rather than filling the box and relying on
 * the parent's state having updated: `onChange` then `onSubmit` in the same
 * tick would search for whatever was in the field a moment ago, because the
 * parent has not re-rendered yet. So `onSubmit` takes the term.
 *
 * Dismissal is on blur, DELAYED by a frame. Clicking a suggestion blurs the
 * input first, and a list that unmounts on blur unmounts before the click it
 * was blurred by can land.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { forgetSearch, readRecentSearches } from "@/lib/recentSearches";

export default function ProductSearchBox({
  value,
  onChange,
  onSubmit,
  busy = false,
  placeholder = "Product name, SKU or barcode",
  className = "",
  tone = "surface",
  recent = true,
  children,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The term is passed when a suggestion was picked. See the header. */
  onSubmit: (term?: string) => void;
  busy?: boolean;
  placeholder?: string;
  /** Extra classes for the form, for the two screens' different widths. */
  className?: string;
  /**
   * Which background the box sits ON, so the field contrasts with it.
   *
   * The page background is `canvas` and the dashboard card is `surface`, so a
   * single fixed colour makes the field disappear on one of the two.
   */
  tone?: "surface" | "canvas";
  /** Offer this tab's recent searches when the field is focused and empty. */
  recent?: boolean;
  /** Anything that belongs beside the field — a Clear button, say. */
  children?: React.ReactNode;
}) {
  const [history, setHistory] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read after mount, never during render: sessionStorage does not exist on the
  // server, and the list is not worth a hydration mismatch.
  useEffect(() => {
    if (recent) setHistory(readRecentSearches());
  }, [recent, value]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const suggestionsOpen = recent && focused && value.trim() === "" && history.length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || busy) return;
    onSubmit();
  };

  const pick = (term: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setFocused(false);
    onChange(term);
    onSubmit(term);
  };

  return (
    <form onSubmit={submit} className={`flex flex-wrap items-center gap-2 ${className}`}>
      {/* `flex-1` with a floor, so a Clear button beside it sits on the same
          line on a desktop and wraps below it on a phone. */}
      <div className="relative min-w-[200px] max-w-lg flex-1">
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // A frame's grace, so a click on a suggestion lands before the list
            // that carries it unmounts.
            blurTimer.current = setTimeout(() => setFocused(false), 120);
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          // Asks a phone keyboard for a "Search" action key. Enter submits
          // either way — this only makes the key say what it does.
          enterKeyHint="search"
          // pr-11 keeps the typed text clear of the button. Without it a long
          // barcode runs underneath the magnifier.
          //
          // The two `::-webkit-search-*` resets remove Chrome and Safari's own
          // clear "×", which is drawn at the right edge of a `type="search"`
          // field — exactly where the magnifier sits. Two overlapping controls
          // in one corner, one of which cancels the search.
          className={`w-full rounded-md border border-line py-2.5 pl-3.5 pr-12 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${
            tone === "canvas" ? "bg-canvas" : "bg-surface"
          }`}
        />

        <button
          type="submit"
          disabled={!value.trim() || busy}
          aria-label="Search"
          title="Search"
          // A 40px square. The icon inside is 17px, but the TARGET is what
          // a thumb has to hit, and on a phone this is the only submit
          // control on the screen.
          className={`absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-ink-soft transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
            tone === "canvas" ? "hover:bg-surface" : "hover:bg-canvas"
          }`}
        >
          {busy ? (
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
              className="animate-spin"
            >
              {/* A ring with a gap, so the rotation is visible. */}
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          ) : (
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
          )}
        </button>

        <AnimatePresence>
          {suggestionsOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-pop"
            >
              <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                Recent searches
              </p>
              <ul>
                {history.map((term) => (
                  <li key={term} className="flex items-stretch">
                    <button
                      type="button"
                      // onMouseDown, not onClick: mousedown fires BEFORE the
                      // input's blur, so the pick is registered even if the
                      // dismissal timer were ever shortened.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pick(term);
                      }}
                      className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-ink hover:bg-canvas"
                    >
                      {term}
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget ${term}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setHistory(forgetSearch(term));
                      }}
                      className="px-3 text-[13px] text-ink-faint hover:text-ink"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {children}
    </form>
  );
}
