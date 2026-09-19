"use client";

/**
 * The scan screen, on the phone that is doing the scanning.
 *
 * ── WHAT THIS SCREEN IS FOR, AND WHAT IT IS NOT ─────────────────────────────
 *
 * Scanning collects. It does not price, and it does not order. A scanned
 * barcode goes straight into the central order cart — `scanCartCompat` merges
 * it with `source: 'scan'`, so `/api/scan/cart` is that same cart filtered by
 * origin rather than a list of its own. This screen exists to beep, to show
 * what has been beeped, and to let a wrong beep be undone.
 *
 * There is therefore NO price on it, no "fetch live prices" and no "add to
 * baskets". Those questions are asked of the order cart, which is where the
 * products already are. The one call that contacts a supplier takes seconds per
 * wholesaler, and putting it on the screen somebody is holding while walking a
 * shop floor is what made scanning feel slow.
 *
 * ── THE INPUT IS THE PAGE ───────────────────────────────────────────────────
 *
 * Everything above the list is one job: get a barcode in. The camera button is
 * the primary action because a phone in an aisle is a camera; the text field is
 * there because a handheld scanner types into it and because a damaged barcode
 * has to be typeable. Both submit to the same handler the desktop uses.
 *
 * ── THE LIST IS A RECEIPT, NOT A WORKSPACE ──────────────────────────────────
 *
 * Rows carry what identifies a product — picture, name, barcode, pack — plus
 * the quantity and a way to remove it, and nothing else. There is no slide-up
 * sheet as there is on the order cart, because the sheet there exists to hold
 * four suppliers' prices and this screen has none to hold. A sheet containing
 * only what the row already shows would be a tap that buys nothing.
 */

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";

import ConfirmDialog from "@/components/ConfirmDialog";
import ProductThumb from "@/components/ProductThumb";
import type { ScanLine } from "@/lib/api/scan";

type FilterId = "all" | "unrecognised";

export interface PendingScan {
  code: string;
  at: number;
}

export interface ScanFeedback {
  kind: "ok" | "miss" | "error";
  text: string;
}

function titleOf(line: ScanLine): string {
  return line.product?.name ?? line.name ?? "";
}

/** Everything a search box should be able to find a scanned line by. */
function haystack(line: ScanLine): string {
  return [line.product?.name, line.name, line.gtin14, line.scannedCode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function MobileScanList({
  lines,
  pending,
  discovering,
  highlight,
  loading,
  typed,
  onTyped,
  onSubmit,
  inputRef,
  scannerSeen,
  cameraOn,
  onCamera,
  cameraError,
  feedback,
  onQuantity,
  onClear,
  clearing,
}: {
  lines: readonly ScanLine[];
  /** Beeps that have not come back yet. */
  pending: readonly PendingScan[];
  /** Lines whose background supplier lookup is still running. */
  discovering: readonly number[];
  /** A repeat scan just pointed at this line. */
  highlight: number | null;
  loading: boolean;
  typed: string;
  onTyped: (value: string) => void;
  onSubmit: () => void;
  /** Owned by the page, which keeps it focused for the handheld scanner. */
  inputRef: React.RefObject<HTMLInputElement>;
  scannerSeen: boolean;
  cameraOn: boolean;
  onCamera: () => void;
  cameraError: string | null;
  feedback: ScanFeedback | null;
  /** Zero removes the line — the page's own handler decides that. */
  onQuantity: (line: ScanLine, next: number) => void;
  onClear: () => void;
  clearing: boolean;
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<ScanLine | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const unrecognised = useMemo(() => lines.filter((line) => !line.product).length, [lines]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter(
      (line) =>
        (filter === "all" || !line.product) &&
        (needle === "" || haystack(line).includes(needle)),
    );
  }, [lines, filter, query]);

  return (
    <div className="lg:hidden">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h1 className="text-[18px] font-semibold tracking-tight text-ink">
          Scan{" "}
          <span className="tabular-nums text-ink-faint">({loading ? "…" : lines.length})</span>
        </h1>
        {lines.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={clearing}
            className="text-[13.5px] font-medium text-ink-soft disabled:opacity-50"
          >
            {clearing ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>

      {/* WHERE THESE GO, said once and plainly. A screen that collects into
          something else has to name the something else, or the buyer scans
          forty products and then goes looking for them. */}
      {/* <p className="mt-1 text-[12px] leading-snug text-ink-soft">
        Everything you scan goes straight to your{" "}
        <Link href="/order-cart?tab=scan" className="font-medium text-link underline">
          order cart
        </Link>
        . Prices are fetched there.
      </p> */}

      {/* ── Getting a barcode in ──────────────────────────────────────────── */}
      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        <motion.button
          type="button"
          onClick={onCamera}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.12 }}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-[14.5px] font-semibold ${
            cameraOn
              ? "border border-line bg-surface text-ink"
              : "bg-teal-600 text-white hover:bg-teal-700"
          }`}
        >
          <CameraGlyph />
          {cameraOn ? "Stop camera" : "Scan with camera"}
        </motion.button>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="mt-2 flex gap-2"
        >
          <input
            ref={inputRef}
            value={typed}
            onChange={(event) => onTyped(event.target.value)}
            placeholder="or type a barcode…"
            aria-label="Barcode"
            autoComplete="off"
            // inputMode numeric brings up the digits keypad; `text-[16px]` stops
            // iOS Safari zooming the page on focus, which it never undoes.
            inputMode="numeric"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3.5 text-[16px] tabular-nums text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!typed.trim()}
            className="min-h-11 shrink-0 rounded-xl border border-line px-4 text-[13.5px] font-medium text-ink disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {scannerSeen && (
          <p className="mt-2 text-[11.5px] font-medium text-good-600">
            ✓ Scanner detected — just scan, the box does not need to be selected.
          </p>
        )}
      </div>

      {cameraError && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">
          {cameraError}
        </p>
      )}

      {/* One line of feedback, not a log: the person is looking up at a shelf
          and needs to know the beep registered. */}
      <AnimatePresence>
        {feedback && (
          <motion.p
            key={feedback.text}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={`mt-3 rounded-xl px-3.5 py-2.5 text-[12.5px] ${
              feedback.kind === "ok"
                ? "bg-good-50 text-good-600"
                : feedback.kind === "miss"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {feedback.text}
          </motion.p>
        )}
      </AnimatePresence>

      {/* ── Search and filter ─────────────────────────────────────────────── */}
      {!loading && lines.length > 0 && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                <SearchGlyph />
              </span>
              <input
                ref={searchInput}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scanned products…"
                aria-label="Search scanned products"
                className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-[16px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    searchInput.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint hover:bg-canvas"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Two chips, not four. The only question worth filtering a scan list
              by is "what did not resolve" — those are the lines that need a
              human before the cart is worth comparing. */}
          <div className="mt-3 flex gap-2">
            {([
              { id: "all" as const, label: "All", count: lines.length },
              { id: "unrecognised" as const, label: "Not found", count: unrecognised },
            ]).map((entry) => {
              const active = filter === entry.id;
              return (
                <motion.button
                  key={entry.id}
                  type="button"
                  onClick={() => setFilter(entry.id)}
                  aria-pressed={active}
                  whileTap={{ scale: 0.94 }}
                  transition={{ duration: 0.12 }}
                  className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium ${
                    active
                      ? "bg-ink text-canvas"
                      : "border border-line bg-surface text-ink-soft hover:bg-canvas"
                  }`}
                >
                  {entry.label} <span className="tabular-nums opacity-70">{entry.count}</span>
                </motion.button>
              );
            })}
          </div>
        </>
      )}

      {/* ── The list ──────────────────────────────────────────────────────── */}
      {loading ? (
        <ScanListSkeleton />
      ) : lines.length === 0 && pending.length === 0 ? (
        <EmptyScan onCamera={onCamera} />
      ) : (
        <ul className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
          {/* Beeps that have not come back yet, at the top, showing the barcode
              as read. This is what makes a scan feel instant: the number
              appears with the beep and fills in behind it. */}
          <AnimatePresence initial={false}>
            {pending.map((entry) => (
              <motion.li
                key={`pending-${entry.code}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-3 border-b border-line bg-canvas/60 px-3 py-2.5 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-ink-faint"
                >
                  <span className="animate-pulse text-[17px]">⋯</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="nums block truncate text-[13px] font-semibold text-ink">
                    {entry.code}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">Looking it up…</span>
                </span>
              </motion.li>
            ))}

            {visible.map((line) => (
              <ScanListRow
                key={line.id}
                line={line}
                highlighted={highlight === line.id}
                discovering={discovering.includes(line.id)}
                onQuantity={(next) => onQuantity(line, next)}
                onRemove={() => setPendingRemoval(line)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {!loading && lines.length > 0 && visible.length === 0 && (
        <p className="py-10 text-center text-[12.5px] text-ink-soft">
          {query ? `Nothing scanned matches “${query.trim()}”.` : "Everything scanned was recognised."}
        </p>
      )}

      {!loading && lines.length > 0 && (
        <Link
          href="/order-cart?tab=scan"
          className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-teal-600 text-[14px] font-semibold text-white hover:bg-teal-700"
        >
          Go to order cart ({lines.length})
        </Link>
      )}

      <AnimatePresence>
        {pendingRemoval && (
          <ConfirmDialog
            title="Remove this item?"
            body={
              <>
                This will remove{" "}
                <span className="font-medium text-ink">
                  {titleOf(pendingRemoval) || pendingRemoval.gtin14 || pendingRemoval.scannedCode}
                </span>{" "}
                from your order cart.
              </>
            }
            confirmLabel="Remove"
            onConfirm={() => {
              onQuantity(pendingRemoval, 0);
              setPendingRemoval(null);
            }}
            onCancel={() => setPendingRemoval(null)}
          />
        )}

        {confirmClear && (
          <ConfirmDialog
            title={`Remove all ${lines.length} scanned products?`}
            body="They will be taken out of your order cart. Anything you added another way stays."
            confirmLabel="Remove all"
            busy={clearing}
            onConfirm={() => {
              onClear();
              setConfirmClear(false);
            }}
            onCancel={() => setConfirmClear(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ScanListRow({
  line,
  highlighted,
  discovering,
  onQuantity,
  onRemove,
}: {
  line: ScanLine;
  highlighted: boolean;
  discovering: boolean;
  onQuantity: (next: number) => void;
  onRemove: () => void;
}) {
  const product = line.product;
  const title = titleOf(line);

  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        // A repeat scan bumped this line's quantity rather than adding a row.
        // The flash is the only thing that says so on a screen somebody is not
        // looking at while they beep.
        backgroundColor: highlighted ? "rgb(254 243 199)" : "rgba(0,0,0,0)",
      }}
      exit={{ opacity: 0, x: -32, transition: { duration: 0.18, ease: "easeIn" } }}
      transition={{ duration: 0.18 }}
      className="border-b border-line px-3 py-2.5 last:border-b-0"
    >
      <div className="flex items-start gap-3">
        <ProductThumb {...(product?.imageUrl ? { src: product.imageUrl } : {})} size={52} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-snug text-ink">
            {title || (
              <span className="font-medium text-ink-soft">
                {/* Honest about what is happening: no catalogue of ours holds
                    this, so the suppliers are being asked directly. Saying
                    "not found" while that runs states a verdict we do not have. */}
                {discovering ? "Checking suppliers…" : "Not found"}
              </span>
            )}
          </p>

          <p className="mt-0.5 truncate text-[11px] tabular-nums text-ink-soft">
            EAN {line.gtin14 ?? line.scannedCode}
          </p>

          {product?.sizeText && (
            <p className="mt-0.5 truncate text-[11px] text-ink-faint">{product.sizeText}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {/* WHERE THIS CAME FROM. "Cross-referenced across three wholesalers"
                and "one catalogue mentions it" are different degrees of
                confidence, and a buyer should know which. */}
            {line.resolvedFrom === "master" && (
              <span
                title="Mapped across two or more wholesalers"
                className="rounded bg-good-50 px-1.5 py-0.5 text-[10px] font-medium text-good-600"
              >
                mapped
              </span>
            )}
            {line.resolvedFrom === "catalogue" && (
              <span
                title="Found in one wholesaler's own catalogue — no cross-supplier mapping"
                className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-soft"
              >
                catalogue
              </span>
            )}
            {!product && !discovering && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                not recognised
              </span>
            )}
          </div>
        </div>
      </div>

      {/* The controls get their own line, so a stepper and a bin are never
          within a thumb's width of each other. */}
      <div className="mt-2 flex items-center gap-2 pl-[64px]">
        <motion.button
          type="button"
          aria-label={`Fewer of ${title || line.scannedCode}`}
          disabled={line.quantity <= 1}
          onClick={() => onQuantity(line.quantity - 1)}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.12 }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-[18px] text-ink-soft disabled:opacity-40"
        >
          −
        </motion.button>

        <span className="flex h-10 min-w-[48px] flex-1 items-center justify-center rounded-xl border border-line text-[14px] font-semibold tabular-nums text-ink">
          <motion.span
            key={line.quantity}
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
          >
            {line.quantity}
          </motion.span>
        </span>

        <motion.button
          type="button"
          aria-label={`More of ${title || line.scannedCode}`}
          onClick={() => onQuantity(line.quantity + 1)}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.12 }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-[18px] text-ink-soft"
        >
          +
        </motion.button>

        <motion.button
          type="button"
          aria-label={`Remove ${title || line.scannedCode}`}
          onClick={onRemove}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.12 }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
          </svg>
        </motion.button>
      </div>
    </motion.li>
  );
}

function EmptyScan({ onCamera }: { onCamera: () => void }) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-12 text-center">
      <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-canvas text-ink-faint">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4H7M17 4h2.5A1.5 1.5 0 0 1 21 5.5V8M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H4.5A1.5 1.5 0 0 1 3 18.5V16" />
          <path d="M7 9v6M10.5 9v6M14 9v6M17 9v6" />
        </svg>
      </span>

      <p className="mt-4 text-[15px] font-semibold text-ink">Nothing scanned yet</p>
      <p className="mt-1 max-w-[250px] text-[12.5px] leading-snug text-ink-soft">
        Point the camera at a barcode, or type one in. Each product goes straight to your
        order cart.
      </p>

      <button
        type="button"
        onClick={onCamera}
        className="mt-5 flex min-h-11 w-full max-w-[260px] items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-[14px] font-semibold text-white hover:bg-teal-700"
      >
        <CameraGlyph />
        Scan with camera
      </button>
    </div>
  );
}

/**
 * The shape of the list while it loads.
 *
 * Four rows: a scan list is usually shorter than a cart, and a screenful of
 * grey bars overstates how long this takes. Same contract as the cart's — the
 * bars are `aria-hidden` decoration with one live status beside them.
 */
function ScanListSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading your scanned products…
      </span>

      <ul aria-hidden="true" className="mt-3 animate-pulse overflow-hidden rounded-xl border border-line bg-surface">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="border-b border-line px-3 py-2.5 last:border-b-0">
            <div className="flex items-start gap-3">
              <div className="h-[52px] w-[52px] shrink-0 rounded-lg bg-canvas" />
              <div className="min-w-0 flex-1">
                <div
                  className="h-3 rounded bg-canvas"
                  style={{ width: `${[70, 55, 64, 48][row]}%` }}
                />
                <div className="mt-1.5 h-2.5 w-28 rounded bg-canvas" />
                <div className="mt-1.5 h-2.5 w-16 rounded bg-canvas" />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 pl-[64px]">
              <div className="h-10 w-10 rounded-xl bg-canvas" />
              <div className="h-10 flex-1 rounded-xl bg-canvas" />
              <div className="h-10 w-10 rounded-xl bg-canvas" />
              <div className="h-10 w-10 rounded-xl bg-canvas" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function CameraGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
