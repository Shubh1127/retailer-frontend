/**
 * Types for the comparison backend at /api/compare/search
 *
 * These mirror the actual backend response shape. The backend prices
 * things as case prices ex-VAT (`exVatCasePrice`) plus a per-base-unit
 * breakdown (`exVatPerBaseUnit`) rather than a generic "price"/"unitPrice"
 * pair, and the allocation object identifies the chosen supplier via
 * `supplierId` (not `chosenSupplierId`) and reports savings via
 * `savingVsMain` (not `savingExVat`).
 *
 * Still loose with an index signature on both, since the backend may add
 * fields (e.g. flagged/inStock/promo) that aren't guaranteed on every
 * response yet.
 */

export interface ProductInfo {
  name: string;
  brand: string;
  unitGtin: string;
  category?: string;
  packSize?: string;
  imageUrl?: string;
}

export interface SupplierOffer {
  supplierId: string;
  supplierSku?: string;
  /** Ex-VAT price for a full case from this supplier. */
  exVatCasePrice: number;
  /** Ex-VAT price per base unit (can, bottle, kg, etc). */
  exVatPerBaseUnit?: number;
  priceSource?: string;
  deliveryFee?: number;
  inStock?: boolean;
  moq?: number;
  lastUpdated?: string;
  flagged?: boolean;
  flagReason?: string;
  promo?: boolean;
  // Catch-all for any extra fields the backend adds later.
  [key: string]: unknown;
}

/** Keyed by supplier id, e.g. "musgrave", "oreilly". A supplier maps to
 * `null` when the backend has no offer for that product from them (e.g.
 * they don't stock it), rather than omitting the key entirely. */
export type SupplierMap = Record<string, SupplierOffer | null>;

export interface Allocation {
  unitGtin?: string;
  cases?: number;
  /** e.g. "allocated", "unallocated", "needs-match" */
  status?: string;
  /** The supplier the allocation engine actually chose for this line. */
  supplierId?: string;
  supplierSku?: string;
  exVatCasePrice?: number;
  exVatPerBaseUnit?: number;
  lineExVatTotal?: number;
  divertedFromMain?: boolean;
  pinned?: boolean;
  reason?: string;
  /** Ex-VAT saving vs. the main/preferred supplier for this line. */
  savingVsMain?: number;
  [key: string]: unknown;
}

export interface CompareRow {
  product: ProductInfo;
  suppliers: SupplierMap;
  allocation: Allocation;
}

export interface CompareSearchResponse {
  query: string;
  rows: CompareRow[];
}