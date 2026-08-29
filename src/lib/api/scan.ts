import { apiFetch } from "./client";

/**
 * The shop-floor scanner's API.
 *
 * Everything except `fetchScanPrices` is a database read or write and returns
 * in milliseconds. Only that one contacts suppliers, and only because somebody
 * pressed a button saying they had finished walking the shop.
 */

export interface MasterSupplierSku {
  supplierId: string;
  supplierSku: string;
  name?: string;
  /** From the last catalogue sync. Context only — never an ordering price. */
  cataloguePrice?: number;
  /** Fetched from the supplier just now. Only present after pricing. */
  exVatCasePrice?: number;
  repriced?: boolean;
  sizeText?: string;
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  isSingle: boolean;
  /**
   * Whether the supplier said they can supply it — absent when they did not say.
   *
   * OPTIONAL, and it was not before. The catalogue always had a value because
   * the sync wrote one; a LIVE answer replaces it, and a live answer from Barry
   * or O'Reilly is "no information" — neither publishes a stock field. A
   * required boolean here would have forced that into `false`, which reads as
   * a refusal they never made.
   */
  inStock?: boolean;
  /** The supplier's own wording — "back order", "discontinued". */
  availabilityText?: string;
  imageUrl?: string;
  productUrl?: string;
}

export interface MasterProduct {
  gtin14: string;
  name?: string;
  brand?: string;
  sizeText?: string;
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  imageUrl?: string;
  /** Independent wholesalers. Barry's two baskets count once. */
  vendorCount: number;
  suppliers: MasterSupplierSku[];
}

export interface ScanLine {
  id: number;
  lineKey: string;
  gtin14?: string;
  scannedCode: string;
  quantity: number;
  name?: string;
  position: number;
  product?: MasterProduct;
  /** Which local table answered. Shown, because it is a confidence signal. */
  resolvedFrom?: ResolutionSource;
  /** The cheapest supplier once prices have been fetched. */
  best?: { supplierId: string; supplierSku: string; exVatCasePrice: number };
  /**
   * Found by asking suppliers directly, because no catalogue held this barcode.
   *
   * One supplier, no comparison — which is the truth about it, not a gap in the
   * answer. The master table covers every barcode our catalogues carry,
   * including products only one wholesaler stocks, so a miss means the barcode
   * is outside all four.
   */
  liveOnly?: boolean;
  /** The buyer already sent this line to a real supplier basket. */
  addedToBasket?: boolean;
  addedSupplierId?: string;
  /** When the prices on this line were fetched. Absent means never. */
  pricedAt?: string;
}

export interface ScanCart {
  id: string;
  status: "open" | "submitted" | "abandoned";
  lines: ScanLine[];
  /** Lines nothing in our catalogues recognises. Reported, never hidden. */
  unrecognised: number;
  pricedSkus?: number;
  requestedSkus?: number;
}

export type LookupSource = "barcode" | "supplier-code" | "unknown";

/**
 * Which of OUR tables answered. Never a supplier — scanning contacts none.
 *
 *   master     mapped across two or more wholesalers
 *   catalogue  found in one wholesaler's own catalogue, unmapped
 *   none       no table holds this barcode
 */
export type ResolutionSource = "master" | "catalogue" | "none";

export function getScanCart(): Promise<{ cart: ScanCart }> {
  return apiFetch<{ cart: ScanCart }>("/api/scan/cart");
}

/**
 * Record one scan.
 *
 * Returns the resolved product WITH the line, so the scanner can show what it
 * just read without a second round trip — at a beep a second, one extra request
 * per scan is the whole latency budget spent twice.
 */
export function recordScan(
  code: string,
  quantity = 1,
): Promise<{ line: ScanLine; source: LookupSource }> {
  return apiFetch<{ line: ScanLine; source: LookupSource }>("/api/scan/cart/lines", {
    method: "POST",
    body: { code, quantity },
  });
}

/**
 * Change a line's quantity.
 *
 * Answers with an acknowledgement, NOT the cart. A quantity cannot change which
 * suppliers stock a product, so there is nothing to re-resolve — and the caller
 * has already applied the change on screen. See the route for what this used to
 * cost.
 */
export function setScanQuantity(
  lineId: number,
  quantity: number,
): Promise<{ ok: true; id: number; quantity: number }> {
  return apiFetch(`/api/scan/cart/lines/${lineId}`, {
    method: "PATCH",
    body: { quantity },
  });
}

export function removeScanLine(lineId: number): Promise<{ ok: true; id: number }> {
  return apiFetch(`/api/scan/cart/lines/${lineId}`, { method: "DELETE" });
}

export function clearScanCart(): Promise<{ cart: ScanCart }> {
  return apiFetch<{ cart: ScanCart }>("/api/scan/cart/lines", { method: "DELETE" });
}

/**
 * Ask the suppliers about ONE unrecognised barcode, in the background.
 *
 * Fired and forgotten by the scanner: it takes seconds — up to four live
 * searches, main supplier first — so nothing waits on it and the answer turns
 * up on a later refresh. Idempotent by row, so calling it twice for the same
 * line costs one lookup.
 */
export function discoverScanLine(lineId: number): Promise<{
  discovered: boolean;
  supplierId?: string;
  name?: string;
  reason?: string;
}> {
  return apiFetch(`/api/scan/cart/lines/${lineId}/discover`, { method: "POST" });
}

/**
 * Record that a line went into a real supplier basket.
 *
 * The basket write itself goes through /api/cart, which owns every supplier
 * mutation. This only stores the DECISION — which is what stops the background
 * refresh re-pricing a line whose money is already agreed.
 */
export function markScanLineAdded(
  lineId: number,
  supplierId: string,
  sku: string,
): Promise<{ ok: true }> {
  return apiFetch(`/api/scan/cart/lines/${lineId}/added`, {
    method: "POST",
    body: { supplierId, sku },
  });
}

/**
 * THE ONE CALL THAT CONTACTS SUPPLIERS.
 *
 * Fetches a live price for every supplier SKU behind everything in the cart.
 * Slow by nature — several seconds per supplier — which is exactly why it is a
 * button rather than something a scan triggers.
 */
export function fetchScanPrices(): Promise<{ cart: ScanCart }> {
  return apiFetch<{ cart: ScanCart }>("/api/scan/cart/prices", { method: "POST" });
}
