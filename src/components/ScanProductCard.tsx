"use client";

import { useState } from "react";

import ScanThumb from "@/components/ScanThumb";
import StockLine from "@/components/StockLine";
import { cartSupplierLabel } from "@/lib/api/cart";
import { eur } from "@/lib/mock-data";
import type { MasterSupplierSku, ScanLine } from "@/lib/api/scan";

/**
 * One scanned line, on a phone.
 *
 * WHY NOT `ScanRow` REFLOWED
 *
 * `ScanRow` lays each supplier out as a rank of fixed columns — a 160px name, an
 * 80px price, then the code and the link — because on a wide screen four
 * suppliers reading down in straight columns is the comparison. A phone is
 * 360px and the thumbnail has already taken 44 of them, so those columns wrap:
 * the price lands under the supplier it belongs to, the code lands under the
 * price, and four offers become twelve ragged lines with no alignment left to
 * read down.
 *
 * The card asks the same question the dashboard's card asks. The cheapest
 * supplier `fetchScanPrices` chose is the headline, the ones it beat fold away,
 * and the codes and links go with them — a buyer on a shop floor is checking a
 * price, and the supplier's own product page is not what they are holding the
 * phone for.
 *
 * NOTHING HERE DECIDES ANYTHING. The winner is `line.best`, exactly as the row
 * beside it reads it, and the quantity buttons call the same `onQuantity` the
 * row does. A second "who is cheapest" would eventually disagree with the
 * server's, and the bulk Add button above sends `line.best` — so the phone
 * would be showing one supplier and ordering from another.
 */
export default function ScanCard({
  line,
  highlighted,
  discovering,
  onQuantity,
}: {
  line: ScanLine;
  highlighted?: boolean;
  discovering?: boolean;
  onQuantity: (next: number) => void;
}) {
  const [showOthers, setShowOthers] = useState(false);

  const product = line.product;
  const suppliers = product?.suppliers ?? [];

  const isWinner = (offer: MasterSupplierSku): boolean =>
    line.best?.supplierId === offer.supplierId &&
    line.best?.supplierSku === offer.supplierSku;

  const winner = suppliers.find(isWinner);
  const others = suppliers.filter((offer) => !isWinner(offer));

  return (
    <li
      className={`p-3 transition-colors duration-500 lg:hidden ${
        highlighted ? "bg-amber-50" : ""
      }`}
    >
      {/* ---- What was scanned --------------------------------------------- */}
      <div className="flex items-start gap-2.5">
        <ScanThumb line={line} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* `break-words`: a wholesale product name is not written for a
                360px screen, and one that overflows would push the card wider
                than the viewport. */}
            <span className="break-words text-[14px] font-semibold leading-snug text-ink">
              {product?.name ??
                (discovering ? (
                  // Honest about what is happening: no catalogue of ours holds
                  // this, so the suppliers are being asked directly. Saying
                  // "unrecognised" while that runs states a verdict we do not
                  // have yet.
                  <span className="font-normal text-ink-soft">Checking suppliers…</span>
                ) : (
                  <span className="font-normal text-ink-soft">Not found</span>
                ))}
            </span>

            {/* WHERE THIS CAME FROM — the same confidence signal the row
                carries. "Cross-referenced across three wholesalers" and "one
                catalogue mentions it" are different degrees of it. */}
            {line.resolvedFrom === "master" && (
              <span
                className="rounded bg-good-50 px-1.5 py-0.5 text-[10.5px] font-medium text-good-600"
                title="Mapped across two or more wholesalers"
              >
                mapped
              </span>
            )}
            {line.resolvedFrom === "catalogue" && (
              <span
                className="rounded bg-canvas px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft"
                title="Found in one wholesaler's own catalogue — no cross-supplier mapping"
              >
                catalogue
              </span>
            )}
          </div>

          <p className="mt-0.5 break-words text-[11.5px] text-ink-faint">
            EAN <span className="nums">{line.gtin14 ?? line.scannedCode}</span>
            {product &&
              ` · ${product.vendorCount} supplier${product.vendorCount === 1 ? "" : "s"}`}
            {product?.sizeText && ` · ${product.sizeText}`}
          </p>
        </div>
      </div>

      {/* ---- The decision, or the reason there isn't one yet --------------- */}
      {line.best ? (
        <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
            {/* A line no catalogue held was found by asking the suppliers
                directly: one price and no comparison, which is the truth about
                it rather than a gap in the answer. Calling that "best price"
                would imply four were weighed. */}
            {line.liveOnly ? "Found live" : "Best price"}
          </p>

          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-[13.5px] font-medium text-emerald-800">
              {cartSupplierLabel(line.best.supplierId)}
              {winner?.isSingle && (
                <span className="ml-1 text-[11px] text-amber-700" title="Break-pack single">
                  single
                </span>
              )}
            </span>
            <span className="shrink-0 nums text-[17px] font-semibold text-emerald-800">
              {eur(line.best.exVatCasePrice)}
            </span>
          </div>

          {/* Three states and the third is blank — a supplier who published no
              stock field must not be drawn as either answer. */}
          <StockLine
            inStock={winner?.inStock}
            {...(winner?.availabilityText
              ? { availabilityText: winner.availabilityText }
              : {})}
            supplierName={cartSupplierLabel(line.best.supplierId)}
          />

          <p className="mt-0.5 nums text-[11px] text-emerald-700/70">
            {line.best.supplierSku}
          </p>
        </div>
      ) : suppliers.length > 0 ? (
        <div className="mt-2.5 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12.5px] text-ink-soft">
          {/* NOT "no price". Scanning contacts no supplier, and a catalogue
              price on screen is indistinguishable from a current one — so
              nothing is shown until somebody asks for live ones. */}
          No live price yet. Press &ldquo;Fetch live prices&rdquo; above to compare{" "}
          {suppliers.length} supplier{suppliers.length === 1 ? "" : "s"}.
        </div>
      ) : null}

      {/* ---- The suppliers that did not win, folded away ------------------- */}
      {others.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowOthers((current) => !current)}
            aria-expanded={showOthers}
            className="flex w-full items-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-medium text-ink-soft hover:text-ink"
          >
            <span
              aria-hidden="true"
              className={`text-[10px] transition-transform ${showOthers ? "rotate-180" : ""}`}
            >
              ▼
            </span>
            {others.length} {line.best ? "other supplier" : "supplier"}
            {others.length === 1 ? "" : "s"}
          </button>

          {showOthers && (
            <ul className="mt-1 space-y-2 rounded-lg border border-line bg-canvas px-3 py-2.5">
              {others.map((offer) => {
                // The gap against the winner, where both are real numbers —
                // the same subtraction the other cards print.
                const delta =
                  line.best && offer.exVatCasePrice !== undefined
                    ? offer.exVatCasePrice - line.best.exVatCasePrice
                    : undefined;

                return (
                  <li key={`${offer.supplierId}:${offer.supplierSku}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words text-[12.5px] text-ink-soft">
                        {cartSupplierLabel(offer.supplierId)}
                        {offer.isSingle && (
                          <span className="ml-1 text-amber-700" title="Break-pack single">
                            single
                          </span>
                        )}
                      </span>

                      <span className="shrink-0 text-right">
                        {offer.exVatCasePrice !== undefined ? (
                          <span className="nums text-[13px] text-ink">
                            {eur(offer.exVatCasePrice)}
                          </span>
                        ) : offer.repriced === false ? (
                          <span
                            className="text-[11.5px] text-red-600"
                            title="The supplier could not be reached"
                          >
                            not found
                          </span>
                        ) : (
                          <span className="text-[13px] text-ink-faint">—</span>
                        )}
                        {delta !== undefined && delta > 0 && (
                          <span className="ml-1 nums text-[11px] text-ink-faint">
                            +{eur(delta)}
                          </span>
                        )}
                        {/* UNDER THE PRICE. A cheaper supplier that did not win
                            is confusing without it — this is the reason. */}
                        <StockLine
                          inStock={offer.inStock}
                          {...(offer.availabilityText
                            ? { availabilityText: offer.availabilityText }
                            : {})}
                          supplierName={cartSupplierLabel(offer.supplierId)}
                        />
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="nums text-[11px] text-ink-faint">
                        {offer.supplierSku}
                      </span>
                      {offer.productUrl && (
                        <a
                          href={offer.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-link hover:underline"
                        >
                          view ↗
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ---- Already on a real order --------------------------------------- */}
      {/* There is no per-line Add here — the button above sends the whole list —
          so this is a status and never a control. It is said out loud because a
          scanner walks the same shelf twice, and "this one is already going to
          O'Reilly" is the only thing standing between that and a second case. */}
      {line.addedToBasket && (
        <div className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-[12.5px] font-medium text-emerald-700">
          <span aria-hidden="true">🟢</span>
          {line.addedSupplierId
            ? `In ${cartSupplierLabel(line.addedSupplierId)} basket`
            : "In a supplier basket"}
        </div>
      )}

      {/* ---- How many ------------------------------------------------------ */}
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink-soft">Qty</span>
        <div className="flex items-center gap-1">
          {/* Never disabled. The change is local and instant; there is nothing
              in flight for a buyer to wait on. At one the minus becomes a bin,
              because "decrement" and "take it off the list" should not be the
              same tap landing at the end of a long press. */}
          <button
            type="button"
            onClick={() => onQuantity(line.quantity - 1)}
            className={`h-9 w-9 rounded-md border border-line text-[15px] leading-none text-ink-soft ${
              line.quantity <= 1 ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-canvas"
            }`}
            aria-label={`Decrease ${line.scannedCode}`}
          >
            {line.quantity <= 1 ? "🗑" : "−"}
          </button>
          <span className="w-9 text-center text-[15px] tabular-nums text-ink">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => onQuantity(line.quantity + 1)}
            className="h-9 w-9 rounded-md border border-line text-[15px] leading-none text-ink-soft hover:bg-canvas"
            aria-label={`Increase ${line.scannedCode}`}
          >
            ＋
          </button>
        </div>
      </div>
    </li>
  );
}

