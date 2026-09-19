"use client";

/**
 * One product, opened from the mobile cart list.
 *
 * ── WHY A SHEET AND NOT A PAGE ──────────────────────────────────────────────
 *
 * The buyer is walking a list of two hundred lines checking prices. A route
 * change costs the scroll position, and getting back to line 143 after every
 * look is the whole job made tedious. A sheet leaves the list mounted
 * underneath, so dismissing it puts them back exactly where they were.
 *
 * ── ONE SUPPLIER PER ROW, ALWAYS FOUR ROWS ──────────────────────────────────
 *
 * The desktop card renders the same four wholesalers as a 4-across grid, which
 * at phone width gives each price about 70px and turns "not connected" into
 * three truncated letters. Down the screen instead, each row gets the full
 * width and can afford to say what it actually means.
 *
 * The four rows are drawn even when nobody has priced anything. A missing row
 * reads as "that supplier does not sell this", which is a different and much
 * stronger claim than "we have not asked yet" — see the status handling in
 * `OfferValue`.
 *
 * ── THE MOTION IS THE EXPLANATION ───────────────────────────────────────────
 *
 * The sheet rises from the edge it will return to, so where it came from and
 * where a dismissal sends it are the same fact, shown rather than learned. The
 * curve is the app's standard ease-out — fast to arrive, slow to settle —
 * because a panel that decelerates reads as a physical thing and a linear one
 * reads as a repaint.
 *
 * Under `prefers-reduced-motion` the y-slide is dropped and the cross-fade
 * remains, via the app-level `MotionConfig`. See `MotionProvider`.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 * No fetching and no writes. Quantity and removal arrive as callbacks, exactly
 * as they do for the desktop card, so the cart keeps owning its own state.
 */

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

import ProductThumb from "@/components/ProductThumb";
import { eur } from "@/lib/mock-data";
import { bySupplierOrder, SUPPLIER_COLUMNS } from "@/lib/suppliers";
import type { CartOffer, OrderListLine, PricedCartLine } from "@/lib/api/orderList";

/**
 * What one wholesaler's answer says, in the width a phone has.
 *
 * THE THREE ABSENCES STAY APART, for the reason `CartOffer.status` exists at
 * all: "we never asked", "we asked and got nothing back" and "they do not
 * stock it" are three different facts, and only the last is about the product.
 */
function OfferValue({ offers }: { offers: readonly CartOffer[] }) {
  if (offers.length === 0) {
    return <span className="text-[13px] text-ink-faint">–</span>;
  }

  const priced = offers.filter((offer) => offer.exVatCasePrice !== undefined);

  if (priced.length > 0) {
    // Cheapest first when one wholesaler quotes the same product twice — a
    // case and a single, usually.
    const cheapest = priced.reduce((low, offer) =>
      (offer.exVatCasePrice ?? Infinity) < (low.exVatCasePrice ?? Infinity) ? offer : low,
    );

    return (
      <span className="flex items-baseline gap-1.5">
        <span className="nums text-[14px] font-semibold text-ink">
          {eur(cheapest.exVatCasePrice!)}
        </span>
        {cheapest.unitsPerCase !== undefined && (
          <span className="text-[11px] text-ink-faint">
            {cheapest.unitsPerCase} ×{cheapest.unitSize !== undefined ? ` ${cheapest.unitSize}${cheapest.uom ?? ""}` : ""}
          </span>
        )}
      </span>
    );
  }

  const status = offers[0]?.status;
  if (status === "not-connected") return <span className="text-[12px] text-ink-faint">not connected</span>;
  if (status === "unavailable") return <span className="text-[12px] text-amber-700">no answer</span>;
  if (status === "not-found") return <span className="text-[12px] text-ink-faint">not stocked</span>;
  return <span className="text-[13px] text-ink-faint">–</span>;
}

export default function ProductDetailSheet({
  line,
  priced,
  cases,
  pending,
  title,
  identity,
  identityLabel,
  packText,
  badges,
  onQuantity,
  onRemove,
  onClose,
}: {
  line: OrderListLine;
  priced?: PricedCartLine;
  cases: number;
  pending: boolean;
  title: string;
  identity?: string;
  identityLabel?: string;
  packText?: string;
  badges?: React.ReactNode;
  onQuantity: (cases: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * THE PAGE BEHIND DOES NOT SCROLL while the sheet is open. Without this, a
   * flick inside the sheet that reaches its end keeps going and scrolls the
   * list underneath, so dismissing the sheet lands somewhere else entirely.
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const offers = priced?.offers ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex flex-col justify-end"
    >
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: "linear" }}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />

      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.3 }}
        className="relative max-h-[88vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop"
      >
        {/* The grab handle. Decorative — dismissal is the scrim, Escape, or
            the close button; a drag gesture would need a physics library to
            feel right and a broken one feels worse than none. */}
        <div className="sticky top-0 z-10 flex justify-center bg-surface pb-1 pt-2.5">
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line" />
          <button ref={closeRef} type="button" onClick={onClose} className="sr-only">
            Close product details
          </button>
        </div>

        <div className="flex gap-3 px-4 pb-3 pt-1">
          <ProductThumb
            {...(line.imageUrl ? { src: line.imageUrl } : {})}
            size={68}
            rounded="rounded-xl"
          />

          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[14.5px] font-semibold leading-snug text-ink">{title}</h2>
            {identity && (
              <p className="mt-0.5 text-[11.5px] tabular-nums text-ink-soft">
                {identityLabel ?? "EAN"} {identity}
              </p>
            )}
            {packText && <p className="mt-0.5 text-[11.5px] text-ink-soft">{packText}</p>}
            {badges && <div className="mt-1.5 flex flex-wrap items-center gap-1">{badges}</div>}
          </div>
        </div>

        <ul className="border-t border-line">
          {SUPPLIER_COLUMNS.map((column) => {
            const columnOffers = bySupplierOrder(
              offers.filter((offer) => column.ids.includes(offer.supplierId)),
              (offer) => offer.supplierId,
            );
            const isBest =
              priced?.best !== undefined && column.ids.includes(priced.best.supplierId);

            return (
              <li
                key={column.label}
                className={`flex min-h-[52px] items-center gap-2 border-b border-line px-4 ${
                  isBest ? "bg-good-50/50" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
                  {column.label}
                  {isBest && (
                    <span className="ml-1.5 rounded bg-good-50 px-1.5 py-0.5 text-[10px] font-semibold text-good-600">
                      best
                    </span>
                  )}
                </span>
                <OfferValue offers={columnOffers} />
              </li>
            );
          })}
        </ul>

        {!priced?.pricedAt && (
          <p className="px-4 pt-3 text-[11.5px] leading-snug text-ink-soft">
            Nothing here has been priced yet. Use <span className="font-medium">Fetch live prices</span>{" "}
            for what these wholesalers charge right now, or{" "}
            <span className="font-medium">Compare prices</span> for the full run with allocation.
          </p>
        )}

        {/* ── The action bar ────────────────────────────────────────────────
            Quantity and removal, the two things that can be done to a line
            from here. Sticky, so a long supplier list never scrolls the
            controls off the bottom. */}
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface p-3">
          <motion.button
            type="button"
            aria-label="Fewer cases"
            disabled={cases <= 1}
            onClick={() => onQuantity(cases - 1)}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.12 }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line text-[20px] text-ink-soft hover:bg-canvas disabled:opacity-40"
          >
            −
          </motion.button>

          <div
            aria-busy={pending || undefined}
            className={`flex h-12 flex-1 items-center justify-center rounded-xl border-2 text-[16px] font-semibold tabular-nums transition-colors ${
              pending ? "border-line text-ink-soft opacity-70" : "border-teal-500 text-ink"
            }`}
          >
            {/* Keyed on the value, so each change mounts a new element and the
                number visibly ticks over instead of silently becoming another
                number. This is the only feedback that a tap registered before
                the write lands 400ms later. */}
            <motion.span
              key={cases}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              {cases}
            </motion.span>
          </div>

          <motion.button
            type="button"
            aria-label="More cases"
            onClick={() => onQuantity(cases + 1)}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.12 }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line text-[20px] text-ink-soft hover:bg-canvas"
          >
            +
          </motion.button>

          <motion.button
            type="button"
            aria-label={`Remove ${title}`}
            onClick={onRemove}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.12 }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white hover:bg-red-700"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
            </svg>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
