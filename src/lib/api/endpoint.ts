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
  inStock?: boolean;
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
