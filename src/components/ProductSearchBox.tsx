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
 */

import { type FormEvent } from "react";

export default function ProductSearchBox({
  value,
  onChange,
  onSubmit,
  busy = false,
  placeholder = "Product name, SKU or barcode",
  className = "",
  tone = "surface",
  children,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
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
  /** Anything that belongs beside the field — a Clear button, say. */
  children?: React.ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || busy) return;
    onSubmit();
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
      </div>

      {children}
    </form>
  );
}
