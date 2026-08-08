import type { SupplierOffer } from "./api/types";

/** Picks the cheapest in-stock supplier id from a suppliers map. */
export function cheapestSupplierId(
  suppliers: Record<string, SupplierOffer | null>
): string | undefined {
  let best: string | undefined;
  let bestPrice = Infinity;
  for (const [id, offer] of Object.entries(suppliers)) {
    if (!offer) continue;
    if (offer.inStock === false) continue;
    if (typeof offer.exVatCasePrice === "number" && offer.exVatCasePrice < bestPrice) {
      bestPrice = offer.exVatCasePrice;
      best = id;
    }
  }
  return best;
}

/** "value-centre" -> "Value Centre" fallback label for suppliers we don't
 * have local metadata (color, short name) for. */
export function supplierLabel(id: string): string {
  return id
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}