"use client";

/**
 * The three ways to start, side by side.
 *
 * WHAT THIS REPLACED. A single empty state that said "Start with an order list"
 * and offered one button. By then it was wrong twice over: scanning had become
 * the fastest way into the system and was not mentioned, and a retailer holding
 * one product had no route in at all short of building a list for it.
 *
 * WHY "OR" IS DRAWN RATHER THAN IMPLIED. Three boxes in a row read as three
 * steps — do this, then this, then this — which is exactly wrong: they are
 * alternatives. The separator is the cheapest way to say "pick one".
 *
 * THE THREE ENDINGS ARE DELIBERATELY DIFFERENT.
 *
 *   scan     -> /scan          a product in your hand, into the virtual cart
 *   barcode  -> /product-search  a number, and the question "who stocks this"
 *   sheet    -> /orders        a week's order, reviewed before it is sent
 *
 * The middle one used to hand off to /scan, which was wrong: typing a barcode
 * is a lookup, not a scan. Somebody at a desk with a number on a note wants to
 * see the four suppliers' prices, not to have it silently added to a cart they
 * were not looking at.
 *
 * NOTHING HERE CONTACTS A SUPPLIER. All three land on a screen where the
 * retailer decides what happens next; an order list is reviewed before it is
 * sent, and prices are fetched only when somebody presses the button.
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Enough digits to be a barcode. The backend does the real validation. */
const MIN_BARCODE_DIGITS = 8;

/**
 * Line icons at a common size, so the three boxes read as one set.
 *
 * Drawn here rather than imported: they are three glyphs used in one place, and
 * an icon package would be a dependency for less markup than this.
 */
function Icon({ name, size = 20 }: { name: "scan" | "barcode" | "upload" | "arrow"; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "scan" && (
        <>
          {/* A scan frame with a beam. A QR block would read as "code". */}
          <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
          <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
          <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
          <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
          <path d="M4 12h16" />
        </>
      )}
      {name === "barcode" && (
        <>
          {/* The bars themselves — what is printed on the pack, not a scanner. */}
          <path d="M4 6v12M7.5 6v12M11 6v9M14.5 6v12M17 6v9M20 6v12" />
        </>
      )}
      {name === "upload" && (
        <>
          <path d="M12 15V4" />
          <path d="m8 8 4-4 4 4" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </>
      )}
      {name === "arrow" && (
        <>
          <path d="M5 12h13" />
          <path d="m13 7 5 5-5 5" />
        </>
      )}
    </svg>
  );
}

function Box({
  icon,
  title,
  body,
  children,
}: {
  icon: "scan" | "barcode" | "upload";
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center rounded-xl border border-line bg-surface p-4 text-center md:p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-ink-soft">
        <Icon name={icon} size={21} />
      </span>
      <h3 className="mt-2.5 text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-[34ch] text-[12.5px] leading-relaxed text-ink-soft md:max-w-[26ch] md:flex-1">
        {body}
      </p>
      <div className="mt-4 w-full">{children}</div>
    </div>
  );
}

/**
 * "OR" between two boxes — a vertical rule beside them on a wide screen, a
 * horizontal one between them once they stack.
 */
function Or() {
  // `flex-1` on the rules rather than a fixed height or width: the separator
  // runs horizontally between stacked boxes and vertically between side-by-side
  // ones, and the rule has to grow along whichever axis that is.
  const rule = "flex-1 bg-line h-px md:h-auto md:w-px";

  return (
    <div className="flex items-center justify-center md:flex-col">
      <span className={rule} />
      <span className="px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint md:px-0 md:py-2">
        or
      </span>
      <span className={rule} />
    </div>
  );
}

export default function StartOptions() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const digits = code.replace(/\D/g, "");
  const usable = digits.length >= MIN_BARCODE_DIGITS;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!usable) return;
    // The search page runs it and shows the four suppliers. The query stays in
    // the URL, so the result is refreshable and can be sent to somebody.
    router.push(`/product-search?q=${encodeURIComponent(digits)}`);
  };

  return (
    <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
      <Box
        icon="scan"
        title="Scan a product"
        body="Scan the barcode of the physical product with your camera or a handheld scanner."
      >
        <button
          type="button"
          onClick={() => router.push("/scan?camera=1")}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700"
        >
          <Icon name="scan" size={16} />
          Scan product
        </button>
      </Box>

      <Or />

      <Box
        icon="barcode"
        title="Enter a barcode"
        body="Type the number printed on the pack and see which suppliers stock it."
      >
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="5054267013926"
            aria-label="Barcode"
            enterKeyHint="search"
            className="nums w-full min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <button
            type="submit"
            disabled={!usable}
            aria-label="Search this barcode"
            title={
              usable
                ? "Search this barcode"
                : `A barcode is at least ${MIN_BARCODE_DIGITS} digits`
            }
            // Square, matching the field's height, so the arrow reads as the
            // end of the field rather than as a second control beside it.
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="arrow" size={18} />
          </button>
        </form>
      </Box>

      <Or />

      <Box
        icon="upload"
        title="Upload a sheet"
        body="Import a CSV into an order list, check the quantities, then send it for comparison."
      >
        <button
          type="button"
          onClick={() => router.push("/orders")}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-teal-600 px-3.5 py-2 text-[13px] font-medium text-teal-700 hover:bg-teal-50"
        >
          <Icon name="upload" size={16} />
          Build an order list
        </button>
      </Box>
    </div>
  );
}
