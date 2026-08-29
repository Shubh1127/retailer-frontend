import { apiFetch } from "./client";
import type { CompareSearchResponse } from "./types";

/**
 * GET /api/compare/search?q=<query>
 *
 * Pass an AbortSignal so callers (e.g. a debounced search box) can cancel
 * in-flight requests when the query changes again.
 */
export function searchCompare(
  query: string,
  signal?: AbortSignal
): Promise<CompareSearchResponse> {
  return apiFetch<CompareSearchResponse>("/api/compare/search", {
    params: { q: query },
    signal,
  });
}
/** One supplier's listing, exactly as the admin's confirm panel receives it. */
export interface SupplierSearchProduct {
  supplier: string;
  name: string;
  sku?: string;
  ean?: string;
  brand?: string;
  size?: string;
  priceText?: string;
  exVatCasePrice?: number;
  rrpText?: string;
  vatText?: string;
  productUrl?: string;
  /** Where to send a human to SEE it — Musgrave's productUrl is an API path. */
  viewUrl?: string;
  imageUrl?: string;
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  /**
   * Whether this price was re-fetched from the supplier just now.
   *
   * Products are discovered in our own synced catalogues, whose prices are as
   * old as the last sync. Only a re-checked price is shown; a listing whose
   * supplier could not be reached arrives with none, because on screen a stale
   * number is indistinguishable from a current one.
   */
  repriced?: boolean;
  /** A break-pack single sold beside its case — Barry's "/S" codes. */
  isSingle?: boolean;
  /** Whether the supplier says they can supply it. Absent means they did not say. */
  inStock?: boolean;
  /** The supplier's own wording, when it says more than yes or no. */
  availabilityText?: string;
}

export interface SupplierSearchResponse {
  query: string;
  count: number;
  products: SupplierSearchProduct[];
  /**
   * A supplier that FAILED, as opposed to one that had nothing.
   *
   * Rendered separately on purpose: folded together, a Musgrave outage reads as
   * "Musgrave do not stock this", which is the one conclusion a buyer must not
   * draw from it.
   */
  errors: { supplierId: string; message: string }[];
}

/**
 * GET /api/compare/suppliers?q=<query>
 *
 * Flat listings with their supplier attached, for the side-by-side comparison.
 * `searchCompare` above groups by BARCODE instead — right for a shopping list,
 * wrong for one product, because it keeps only the listing that matched and
 * hides the other packs the supplier returned.
 */
export function searchSupplierListings(
  query: string,
  signal?: AbortSignal
): Promise<SupplierSearchResponse> {
  return apiFetch<SupplierSearchResponse>("/api/compare/suppliers", {
    params: { q: query },
    signal,
  });
}

/**
 * Which kind of answer came back, because "no price" has three causes and a
 * screen has to say three different things.
 *
 *  - `priced`      read at the supplier just now.
 *  - `not-found`   the supplier answered and had nothing under this code. A
 *                  real statement about their catalogue.
 *  - `unavailable` the search failed. This says NOTHING about stock — Barry
 *                  behind a Cloudflare block used to arrive as "not found",
 *                  which tells a buyer a wholesaler we could not reach does
 *                  not sell the product.
 */
export type LivePriceStatus = "priced" | "not-found" | "unavailable";

export interface LivePrice {
  supplierId: string;
  sku: string;
  exVatCasePrice?: number;
  /** False means we asked and got nothing — not that we never asked. */
  repriced: boolean;
  status: LivePriceStatus;
  /**
   * Whether the supplier said they can supply it — `undefined` when they did
   * not say.
   *
   * THREE STATES, and the third is not a rounding error. Musgrave and Kadona
   * publish stock; Barry's listing does not, and O'Reilly's search page has no
   * marker either. Rendering "not stated" as in stock would invent an
   * assurance; rendering it as out of stock would stop a buyer ordering
   * something perfectly available.
   */
  inStock?: boolean;
  /** The supplier's own wording — "back order", "discontinued". */
  availabilityText?: string;
  /** Why it was unavailable, for a tooltip. */
  error?: string;
}

/**
 * POST /api/compare/prices
 *
 * THE ONLY CALL HERE THAT CONTACTS A SUPPLIER. Searching answers "who stocks
 * this" from our own tables in milliseconds; this answers "what does it cost",
 * and only when somebody presses the button.
 *
 * Asks exactly the (supplier, sku) pairs it is given — the ones our own data
 * already said stock the product — so a product at three wholesalers costs
 * three requests and one at a single wholesaler costs one.
 */
/**
 * A supplier our own tables never mentioned, found by asking them directly.
 *
 * Our catalogue coverage is not a wholesaler's range — a sync is periodic and
 * incomplete — so "absent from our catalogue" and "they do not stock it" are
 * different claims. A row that showed three suppliers because the fourth was
 * missing from a sync was quietly hiding a price.
 */
export interface DiscoveredOffer {
  /** The barcode it was found under, so the caller knows which row it joins. */
  barcode: string;
  supplierId: string;
  supplierSku: string;
  name: string;
  exVatCasePrice?: number;
  inStock?: boolean;
  availabilityText?: string;
  sizeText?: string;
  imageUrl?: string;
  productUrl?: string;
}

export interface LivePricesResult {
  prices: LivePrice[];
  /** Suppliers found by asking, not by looking them up. */
  discovered: DiscoveredOffer[];
  /** Suppliers that could not be reached while looking. Not an absence. */
  discoveryErrors?: { barcode: string; supplierId: string; message: string }[];
  /** Products whose missing suppliers were not asked about, for budget. */
  discoverySkipped?: number;
  pricedAt: string;
}

export function fetchLivePrices(
  items: { supplierId: string; sku: string }[],
  /**
   * Barcodes whose named suppliers our tables say nothing about.
   *
   * Sent only on this call, never on a search: searching contacts nobody, and
   * this is the moment the buyer has explicitly asked us to go to the
   * suppliers — so it is the honest place to ask the rest of them too.
   */
  discover: { barcode: string; supplierIds: string[] }[] = [],
): Promise<LivePricesResult> {
  return apiFetch("/api/compare/prices", {
    method: "POST",
    body: { items, ...(discover.length > 0 ? { discover } : {}) },
  });
}
