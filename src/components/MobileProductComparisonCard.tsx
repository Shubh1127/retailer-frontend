"use client";

/**
 * One Ready-To-Order line, on a phone.
 *
 * WHY NOT THE TABLE, SHRUNK
 *
 * The desktop table answers "which of these five suppliers is cheapest" by
 * putting five prices on one line and letting the eye run across them. That
 * shape needs 720px and there is no honest way to fold it into 360: squeezing
 * the columns turns five prices into five illegible ones, and a horizontal
 * scroller hides the comparison behind a gesture — the buyer swipes right,
 * loses the product name off the left edge, and is reading numbers with nothing
 * attached to them.
 *
 * So the phone asks a different question with the same data. The pipeline has
 * ALREADY chosen a supplier; on a small screen that answer is the headline and
 * the four numbers behind it are the working, folded away until somebody wants
 * to check it. A retailer on a shop floor is confirming a decision, not auditing
 * one, and the ones who do want to audit it are one tap away.
 *
 * NOTHING HERE DECIDES ANYTHING.
 *
 * The winner is `row.bestSupplier`, the price is `row.price`, the saving is
 * `row.savings`, each supplier's offer comes from the same `cheapestOffer` the
 * table's columns read, and Qty and Add are the same `QtyCell` and `CartCell`
 * the table renders. A second implementation of "who is cheapest" that agreed
 * with the first on the day it was written is a bug with a long fuse — the
 * phone would eventually offer a product at a price the desktop never chose,
 * and the basket it went to would be the phone's answer.
 */

import { useState } from "react";

import ProductImage from "@/components/ProductImage";
import StockLine from "@/components/StockLine";
import { CartCell, QtyCell, type CartState } from "@/components/Cart";
import { cheapestOffer, type SupplierColumn } from "@/components/SupplierPrices";
import { sameDisplaySupplier } from "@/lib/api/cart";
import {
  eur,
  type ReadyToOrderRow,
  type RowDecision,
  type RowVerification,
} from "@/lib/api/jobs";

/**
 * Savings, against the retailer's OWN cost — never supplier-versus-supplier.
 *
 * The same three states the table's Savings column draws, read off the same
 * fields, moved next to the winning price because a card has no column for it
 * and a number that far from the price it relates to means nothing.
 *
 * "No saving" is still SAID. Dropping it to save a line would leave a card that
 * looks identical to one with a real saving, and the retailer would learn to
 * assume every card is saving them money.
 */
function Savings({ row }: { row: ReadyToOrderRow }) {
  if (row.savingsStatus === "saving" && row.savings !== undefined) {
    return (
      <p className="mt-1 text-[12px] font-medium text-emerald-700">
        Save {eur(row.savings)}
        {row.savingsPct !== undefined && (
          <span className="ml-1 font-normal opacity-70">
            {Math.round(row.savingsPct * 100)}%
          </span>
        )}
        {row.baselineCost !== undefined && (
          <span className="ml-1 font-normal text-ink-faint">
            vs {eur(row.baselineCost)}
          </span>
        )}
      </p>
    );
  }

  if (row.savingsStatus === "no-saving") {
    return (
      <p className="mt-1 text-[12px] text-ink-soft">
        No saving
        {row.costDelta !== undefined && row.costDelta < 0 && (
          <span className="ml-1 text-amber-700">
            · {eur(Math.abs(row.costDelta))} dearer than your cost
          </span>
        )}
      </p>
    );
  }

  // No cost in the uploaded file, so no saving can honestly be claimed. The
  // table draws a dash under a heading; a dash alone on a card says nothing, so
  // the card says nothing instead.
  return null;
}

/**
 * The suppliers that did not win, folded away.
 *
 * COLLAPSED BY DEFAULT and every non-winning column is kept, including the ones
 * with no price. A supplier the table shows as "—" is a real fact — nothing from
 * them we would be willing to order — and quietly dropping it from the phone
 * would make the roster look shorter than it is.
 */
function OtherSuppliers({
  row,
  columns,
}: {
  row: ReadyToOrderRow;
  columns: readonly SupplierColumn[];
}) {
  const [open, setOpen] = useState(false);

  const others = columns
    .filter((column) => !sameDisplaySupplier(row.bestSupplier, column.id))
    .map((column) => ({ column, offer: cheapestOffer(row, column.id) }));

  if (others.length === 0) return null;

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-medium text-ink-soft hover:text-ink"
      >
        <span
          aria-hidden="true"
          className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▼
        </span>
        {others.length} other supplier{others.length === 1 ? "" : "s"}
      </button>

      {open && (
        <ul className="mt-1 space-y-1.5 rounded-lg border border-line bg-canvas px-3 py-2.5">
          {others.map(({ column, offer }) => {
            const price = offer?.exVatCasePrice;
            // How much dearer than the winner — the same subtraction the table's
            // column prints beside the price, so the gap needs no arithmetic.
            const delta = price === undefined ? undefined : price - row.price;

            return (
              <li key={column.id} className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words text-[12.5px] text-ink-soft">
                  {column.name}
                </span>

                <span className="shrink-0 text-right">
                  {price === undefined ? (
                    <span className="text-[12.5px] text-ink-faint">—</span>
                  ) : (
                    <>
                      <span className="text-[13px] tabular-nums text-ink">{eur(price)}</span>
                      {delta !== undefined && delta > 0 && (
                        <span className="ml-1 text-[11px] tabular-nums text-ink-faint">
                          +{eur(delta)}
                        </span>
                      )}
                    </>
                  )}
                  {/* Under the price, as everywhere else. When a cheaper
                      supplier reads "out of stock" this is the reason it did
                      not win, and without it the line looks like an oversight. */}
                  <StockLine
                    inStock={offer?.inStock}
                    {...(offer?.availabilityText
                      ? { availabilityText: offer.availabilityText }
                      : {})}
                    supplierName={column.name}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function MobileProductComparisonCard({
  row,
  cart,
  columns,
  quantity,
  onQuantityChange,
  decision,
  onOpenDetail,
  verification,
  cartLocked,
  isRecord,
  isVerifying,
}: {
  row: ReadyToOrderRow;
  cart: CartState;
  /** The same supplier roster the table's columns are built from. */
  columns: readonly SupplierColumn[];
  /** The page's draft quantity for this row, as the Qty column receives it. */
  quantity?: number;
  onQuantityChange: (next: number) => void;
  /** An admin's live verdict on this line. Dashboard only. */
  decision?: RowDecision;
  /** Opens the product detail popup. Absent where the page has none. */
  onOpenDetail?: () => void;
  verification?: RowVerification;
  cartLocked?: boolean;
  isRecord?: boolean;
  isVerifying?: boolean;
}) {
  const selected = row.detail.selected;
  const winner = cheapestOffer(row, row.bestSupplier);
  const removed = decision?.type === "row-removed";

  return (
    <article
      className={`px-4 py-3.5 ${removed ? "bg-red-50/50 opacity-60" : ""}`}
      aria-label={row.product}
    >
      {/* ---- What was ordered, and what was matched to it ------------------ */}
      <div className="flex items-start gap-2.5">
        <ProductImage
          {...(selected?.imageUrl ? { src: selected.imageUrl } : {})}
          alt={selected?.product ?? row.product}
          size={44}
        />

        <div className="min-w-0 flex-1">
          {/* `break-words`, because a phone is 360px and wholesale product
              names are not written for one. An overflowing name would either
              be clipped or would push the card wider than the screen, and a
              horizontal scrollbar is the one thing this layout exists to
              avoid. */}
          <h3
            className={`break-words text-[14px] font-semibold leading-snug text-ink ${
              removed ? "line-through" : ""
            }`}
          >
            {row.product}
          </h3>

          {selected?.product && (
            <p className="mt-0.5 break-words text-[12.5px] leading-snug text-ink-soft">
              {selected.product}
            </p>
          )}

          {/* SKU and the spreadsheet row on one faint line. The row number is
              kept — it is how a retailer finds the line in their own file when
              something needs fixing — but it is not a column here, because on
              a phone the first thing read should be the product. */}
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            {selected?.sku && <span className="tabular-nums">SKU {selected.sku}</span>}
            {selected?.sku && " · "}
            <span className="tabular-nums">Row {row.row}</span>
          </p>
        </div>

        {onOpenDetail && (
          <button
            type="button"
            onClick={onOpenDetail}
            aria-label={`Details for ${row.product}`}
            className="-m-1 shrink-0 rounded p-1 text-[12px] font-medium text-ink-faint hover:text-teal-600"
          >
            Details
          </button>
        )}
      </div>

      {/* ---- Caveats, the same ones the table shows ------------------------ */}
      {(row.eanConfirmed || row.warnings.length > 0 || decision) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.eanConfirmed && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
              ✓ Barcode confirmed
            </span>
          )}
          {row.warnings.length > 0 && (
            <span
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700"
              title={row.warnings.map((warning) => warning.message).join("\n")}
            >
              ⚠ {row.warnings[0]!.message}
              {row.warnings.length > 1 && (
                <span className="opacity-70"> +{row.warnings.length - 1}</span>
              )}
            </span>
          )}
          {decision?.type === "row-confirmed" && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
              ✓ Confirmed by {decision.by ?? "an administrator"}
            </span>
          )}
          {decision?.type === "row-removed" && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">
              Removed by {decision.by ?? "an administrator"}
              {decision.reason && ` — ${decision.reason}`}
            </span>
          )}
        </div>
      )}

      {/* ---- The decision -------------------------------------------------- */}
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
          Best price
        </p>

        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words text-[13.5px] font-medium text-emerald-800">
            {row.bestSupplierName}
          </span>
          <span className="shrink-0 text-[17px] font-semibold tabular-nums text-emerald-800">
            {eur(row.price)}
          </span>
        </div>

        {/* Three states and the third is blank — a supplier who published no
            stock field must not be drawn as either answer. */}
        <StockLine
          inStock={winner?.inStock}
          {...(winner?.availabilityText ? { availabilityText: winner.availabilityText } : {})}
          supplierName={row.bestSupplierName}
        />

        <Savings row={row} />
      </div>

      <OtherSuppliers row={row} columns={columns} />

      {/* ---- How many, and into whose basket ------------------------------- */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink-soft">Qty</span>
        <QtyCell
          row={row}
          cart={cart}
          {...(quantity !== undefined ? { quantity } : {})}
          onQuantityChange={onQuantityChange}
          {...(isRecord !== undefined ? { isRecord } : {})}
          mobile
        />
      </div>

      <div className="mt-2.5">
        <CartCell
          row={row}
          cart={cart}
          {...(quantity !== undefined ? { quantity } : {})}
          {...(verification !== undefined ? { verification } : {})}
          {...(cartLocked !== undefined ? { cartLocked } : {})}
          {...(isRecord !== undefined ? { isRecord } : {})}
          {...(isVerifying !== undefined ? { isVerifying } : {})}
          mobile
        />
      </div>
    </article>
  );
}
