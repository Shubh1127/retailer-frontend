/**
 * Per-supplier price columns for the Ready To Order table.
 *
 * Replaces the single "Price" column with one column per supplier, so a buyer
 * can see both quotes side by side and read the gap without opening anything.
 *
 * WHAT THE GREEN MEANS
 *
 * The highlighted cell is the supplier the line will actually be **ordered
 * from** — `bestSupplier` — not merely the smallest number. Those are almost
 * always the same, because allocation takes the lowest ex-VAT price. They can
 * differ by design: within `priceTieToleranceEur` two quotes count as equal and
 * supplier preference breaks the tie. Highlighting the cheapest number in that
 * case would point at a supplier the system is not going to buy from, which is
 * worse than showing nothing.
 *
 * Where a supplier has no price it shows "—". That is not a failure: a supplier
 * only appears in `detail.offers` once it has cleared reconciliation, so a dash
 * means "nothing from them we would be willing to order", which is exactly what
 * a buyer needs to know.
 */

import { eur, type ReadyToOrderRow } from "@/lib/api/jobs";
import {
  displaySupplierId,
  sameDisplaySupplier,
  supplierLabel,
} from "@/lib/api/cart";

export interface SupplierColumn {
  id: string;
  name: string;
}

/**
 * The supplier columns to render, derived from the rows themselves.
 *
 * Not hardcoded to Musgrave and O'Reilly: when a third supplier is added it
 * appears here with no change to this file. `bestSupplier` is included as well
 * as the offers, so the chosen supplier can never be missing a column.
 *
 * Columns are keyed by DISPLAY id, which collapses Barry's ambient and chill
 * suppliers into one "Barry Group". Any given product sits in one department,
 * so keeping them apart would produce two columns that are each blank wherever
 * the other has a price — the same information, twice as wide, and it reads as
 * though Barry failed to quote. The split is real and stays real everywhere
 * that acts on it; this is the table only.
 */
export function supplierColumns(rows: readonly ReadyToOrderRow[]): SupplierColumn[] {
  const byId = new Map<string, string>();

  const remember = (supplierId: string, fallbackName: string) => {
    const id = displaySupplierId(supplierId);
    if (!byId.has(id)) byId.set(id, supplierLabel(id) || fallbackName);
  };

  for (const row of rows) {
    for (const offer of row.detail.offers) remember(offer.supplier, offer.supplierName);
    remember(row.bestSupplier, row.bestSupplierName);
  }

  // Alphabetical by name — a stable order matters more than which order, since
  // columns jumping between renders is worse than any particular arrangement.
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The ex-VAT case price this supplier quoted, or undefined if they had none.
 *
 * Matches on the DISPLAY id so a "Barry Group" column finds a price whichever
 * basket the offer came from. Where a product somehow appears in both, the
 * cheaper wins the cell — the column is a claim about what Barry charges, and
 * showing the dearer of two real prices would understate them.
 */
function priceOf(row: ReadyToOrderRow, supplierId: string): number | undefined {
  const prices = row.detail.offers
    .filter((entry) => sameDisplaySupplier(entry.supplier, supplierId))
    .map((entry) => entry.exVatCasePrice)
    .filter((price): price is number => typeof price === "number");

  return prices.length > 0 ? Math.min(...prices) : undefined;
}

export function SupplierPriceCell({
  row,
  supplierId,
}: {
  row: ReadyToOrderRow;
  supplierId: string;
}) {
  const price = priceOf(row, supplierId);
  // Compared by display id: the row is ordered from barrygroup-chill, the
  // column is "barrygroup", and the highlight has to land on it.
  const isChosen = sameDisplaySupplier(row.bestSupplier, supplierId);

  if (price === undefined) {
    return (
      <td className="px-3 py-2 text-right tabular-nums text-ink-faint">—</td>
    );
  }

  // How much dearer than the winner, so the gap is legible without arithmetic.
  const delta = price - row.price;

  return (
    <td
      className={`px-3 py-2 text-right tabular-nums ${
        isChosen
          ? "bg-emerald-50 font-semibold text-emerald-800"
          : "text-ink-soft"
      }`}
      title={
        isChosen
          ? `Selected — ordering from ${row.bestSupplierName}`
          : delta > 0
            ? `${eur(delta)} more per case than ${row.bestSupplierName}`
            : undefined
      }
    >
      {eur(price)}
      {!isChosen && delta > 0 && (
        <span className="ml-1 text-[11px] text-ink-faint">
          +{eur(delta)}
        </span>
      )}
    </td>
  );
}
