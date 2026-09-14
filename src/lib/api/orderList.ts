/**
 * The central order cart — everything the retailer is buying, however they
 * collected it.
 *
 * WHY THIS FILE IS STILL CALLED order-list. The backend route is
 * `/api/order-list`, and the cart and the order list are the same store — the
 * list simply grew the ability to be filled from a scanner and a search as
 * well as a file.
 *
 * Everything here is LOCAL except two calls, and both are buttons:
 *
 *   compareOrderCart      starts the full comparison job. Leaves the cart alone.
 *   fetchOrderCartPrices  the light per-line live price fan-out.
 */

import { apiFetch } from "./client";

export interface OrderListLine {
  id: number;
  /** The GTIN-14, or `epos:<article code>` — what the line is identified by. */
  lineKey: string;
  /** The barcode when known. An EPOS listing carries none. */
  gtin14?: string;
  /** The shop's own article code, for a line from an EPOS listing. */
  articleCode?: string;
  description?: string;
  /** Canonical product image resolved from the master catalogue for cart display. */
  imageUrl?: string;
  /** Human-readable variant/size, e.g. 330ml. */
  sizeText?: string;
  /** Quantity in CASES. Always positive — removing a line is a delete. */
  cases: number;
  packRaw?: string;
  unitsPerCase?: number;
  unitSize?: number;
  /** Current cost per case. The savings baseline. */
  mainCost?: number;
  /** Verbatim scanner output, for a line that arrived by beep. */
  scannedCode?: string;
  /** A supplier found by asking, for a barcode no catalogue of ours holds. */
  foundSupplierId?: string;
  foundSupplierSku?: string;
  /** A break-pack single, which shares its case's barcode but not its line. */
  isSingle?: boolean;
  position: number;
  /**
   * Every place this line came from, oldest first.
   *
   * A LINE CAN HAVE SEVERAL. Scanning a product and later finding it in a
   * search does not make two lines — it makes one line with two origins, and
   * the tabs are a filter over these rather than over a column.
   */
  sources?: OrderCartLineSource[];
}

/**
 * Where a cart line came from.
 *
 * These are the database's own values, not UI labels — `order_list` stays
 * correct however the tab is worded. Read from the line rather than inferred
 * from which screen is open, because a line collected somewhere else is
 * exactly the case a guess would get wrong.
 */
export type OrderCartSource =
  | "order_list"
  | "scan"
  | "product_search"
  | "dashboard_search"
  | "job_result";

/**
 * The origin recorded for a product picked off a finished comparison.
 *
 * `jobId` and `sourceRow` are the trace back to the run and the row, and are
 * verified server-side against the jobs this retailer actually owns.
 */
export const JOB_RESULT_SOURCE: OrderCartSource = "job_result";

export interface OrderCartLineSource {
  source: OrderCartSource;
  /** The comparison job a line was taken off, when it was. */
  jobId?: string;
  sourceRow?: number;
  firstSeenAt: string;
}

export interface OrderList {
  id: string;
  status: "draft" | "submitted";
  sourceFileName?: string;
  submittedJobId?: string;
  createdAt: string;
  lines: OrderListLine[];
  /**
   * What is already known about these lines' prices, from a previous fetch.
   *
   * READING THE CART CONTACTS NOBODY. This comes out of the database, and the
   * three-hour rule is applied to it — a stale quote arrives as "not priced"
   * rather than as a number that reads as current.
   */
  pricing?: PricedCartLine[];
  /** Present when the cart screen requests one server-side page. */
  pagination?: { page: number; pageSize: number; total: number };
  /** Tab totals for the whole cart, not merely the loaded page. */
  sourceCounts?: { all: number; order_list: number; scan: number };
}

/** A CSV row whose barcode could not be read. Reported, never dropped. */
export interface SkippedRow {
  barcode: string;
  description?: string;
  reason: string;
}

/**
 * `passive` marks a read caused by ANOTHER device changing the draft, so an
 * unattended screen does not keep its own session alive on somebody else's
 * activity. An ordinary load says nothing and counts as presence.
 */
export async function getOrderList(
  opts: { passive?: boolean; source?: OrderCartSource; page?: number; pageSize?: number } = {},
): Promise<OrderList> {
  const { source, page, pageSize, ...rest } = opts;
  return apiFetch<OrderList>("/api/order-list", {
    ...rest,
    ...(source || page !== undefined || pageSize !== undefined
      ? {
          params: {
            ...(source ? { source } : {}),
            ...(page !== undefined ? { page } : {}),
            ...(pageSize !== undefined ? { pageSize } : {}),
          },
        }
      : {}),
  });
}

/**
 * Parse a CSV and merge it into the draft.
 *
 * Duplicate barcodes SUM rather than stacking — importing the same file twice
 * means twice the quantity, which is what merging means for an order and what
 * the retailer can undo by editing a line.
 */
export async function importOrderListCsv(
  csv: string,
  fileName?: string,
): Promise<{ list: OrderList; skipped: SkippedRow[] }> {
  return apiFetch<{ list: OrderList; skipped: SkippedRow[] }>("/api/order-list/import", {
    method: "POST",
    body: { csv, ...(fileName ? { fileName } : {}) },
  });
}

/**
 * Import an EPOS Article Order Listing — .xls, .xlsx or .csv.
 *
 * The same parser the dashboard's direct upload always used. The difference is
 * where it lands: a draft to review rather than a job already spending requests
 * at four trade accounts.
 *
 * Sent as base64 rather than multipart because the backend's existing job
 * upload takes base64, and one encoding for one file format beats two.
 */
export async function importOrderListEpos(
  fileBase64: string,
  fileName?: string,
): Promise<{ list: OrderList; skipped: SkippedRow[] }> {
  return apiFetch<{ list: OrderList; skipped: SkippedRow[] }>("/api/order-list/import-epos", {
    method: "POST",
    body: { fileBase64, ...(fileName ? { fileName } : {}) },
  });
}

export async function setOrderListCases(lineId: number, cases: number): Promise<OrderList> {
  return apiFetch<OrderList>(`/api/order-list/lines/${lineId}`, {
    method: "PATCH",
    body: { cases },
  });
}

export async function removeOrderListLine(lineId: number): Promise<OrderList> {
  return apiFetch<OrderList>(`/api/order-list/lines/${lineId}`, { method: "DELETE" });
}

/**
 * Empty the draft.
 *
 * Safe in a way clearing a supplier BASKET is not: nothing has been ordered and
 * no supplier has been told anything, so there is nothing to lose and nothing
 * to undo at the far end.
 */
export async function clearOrderList(): Promise<OrderList> {
  return apiFetch<OrderList>("/api/order-list/lines", { method: "DELETE" });
}

/**
 * Send the list for comparison.
 *
 * THIS is the moment suppliers are contacted, and the only one. Returns the
 * jobId of the run it started — the caller navigates to it.
 */
export async function submitOrderList(): Promise<{ jobId: string }> {
  return apiFetch<{ jobId: string }>("/api/order-list/submit", { method: "POST" });
}

/**
 * A product on its way into the cart, from a search or a comparison result.
 *
 * Every field is optional because the sources genuinely know different things.
 * What matters is that at least one STABLE identity is present — a barcode, or
 * a supplier's own code — because the name is never one. The backend decides
 * which of them wins; nothing here re-implements that.
 */
export interface OrderCartItemInput {
  /** The barcode. Canonicalised server-side, so either spelling is fine. */
  gtin14?: string;
  /** The real product name. Persisted, and what supplier retrieval searches for. */
  description?: string;
  /** The supplier's own code — the identity of last resort, when there is no EAN. */
  supplierId?: string;
  supplierSku?: string;
  /** A break-pack single, which shares its case's barcode but not its line. */
  isSingle?: boolean;
  /** Cases. Defaults to 1 server-side. */
  cases?: number;
  size?: string;
  /**
   * Prices this product already has, and when they were taken.
   *
   * A comparison job asks every wholesaler and keeps the answers; carrying
   * them in means the cart shows what the buyer just watched being priced
   * instead of re-asking the same four trade accounts.
   */
  offers?: unknown[];
  pricedAt?: string;
}

/** What happened to one product. */
export interface AddedCartLine {
  lineKey: string;
  lineId: number;
  outcome: "added" | "increased" | "already-present";
  cases: number;
}

export interface AddToCartResult {
  cart: OrderList;
  lines: AddedCartLine[];
  /** Products with no usable identity. Reported, never silently dropped. */
  skipped: { item: OrderCartItemInput; reason: string }[];
}

/**
 * Put products in the central cart.
 *
 * ENSURE SEMANTICS, decided by the backend and not negotiable from here:
 * pressing Add twice on one search result means one product, not two cases.
 * The quantity-summing behaviour belongs to file imports and scans, which
 * have their own routes and their own reasons.
 *
 * `jobId` and `sourceRow` are VERIFIED server-side against the jobs this
 * retailer actually owns — they are a claim the caller makes, not a fact,
 * until the backend has checked it.
 */
export async function addToOrderCart(
  items: readonly OrderCartItemInput[],
  options: {
    source: OrderCartSource;
    jobId?: string;
    sourceRow?: number;
  },
): Promise<AddToCartResult> {
  return apiFetch<AddToCartResult>("/api/order-list/items", {
    method: "POST",
    body: {
      items,
      source: options.source,
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.sourceRow !== undefined ? { sourceRow: options.sourceRow } : {}),
    },
  });
}

/**
 * One product a caller wants the cart's answer for, tagged with a key it
 * made up itself — a search result's row key, typically.
 *
 * The tag is never the line's own identity: a search result knows a barcode
 * or a supplier's code, never the server's `line_key` encoding, so a match
 * is returned against whatever the caller already had rather than asking it
 * to recompute one.
 */
export interface CartLookupItem extends OrderCartItemInput {
  requestKey: string;
}

export interface CartLookupMatch {
  requestKey: string;
  lineId: number;
  cases: number;
}

/**
 * Which of these products are already on the cart, and at what quantity.
 *
 * READ ONLY — nothing here adds, removes or changes a line. A search table
 * calls this for a page of results so its "Order cart" column can say
 * "already there, quantity 3" instead of always offering a bare Add, the
 * same distinction the real supplier basket column already draws.
 *
 * Items with no computable identity, or that simply are not on the cart,
 * are left out of the answer — this is a background check a screen runs on
 * every search, not a refusal that needs explaining.
 */
export async function lookupOrderCartLines(
  items: readonly CartLookupItem[],
): Promise<CartLookupMatch[]> {
  if (items.length === 0) return [];
  const { matches } = await apiFetch<{ matches: CartLookupMatch[] }>("/api/order-list/lookup", {
    method: "POST",
    body: { items },
  });
  return matches;
}

/**
 * Compare prices for everything in the cart — and KEEP THE CART.
 *
 * The difference from `submitOrderList` is the only thing that matters here.
 * Submitting closes the draft: the retailer comes back to an empty one. This
 * starts the same job through the same pipeline and does not touch a single
 * line, because a cart collected over a week is not spent by asking a
 * question of it.
 *
 * Returns the jobId to navigate to. A 409 means a comparison of this cart is
 * already running and carries the jobId of the one that is.
 */
export async function compareOrderCart(): Promise<{ jobId: string }> {
  return apiFetch<{ jobId: string }>("/api/order-list/compare", { method: "POST" });
}

/** One supplier's answer about one cart line — a price, or why there is none. */
export interface CartOffer {
  supplierId: string;
  supplierSku: string;
  exVatCasePrice?: number;
  /** False means we asked and got nothing — not that we never asked. */
  repriced: boolean;
  /** Which kind of absence: not-connected, unavailable, not-found, priced. */
  status?: "priced" | "not-found" | "unavailable" | "not-connected";
  /** Whether the supplier said they can supply it. Absent means they did not say. */
  inStock?: boolean;
  availabilityText?: string;
  error?: string;
  /**
   * A break-pack single, sold beside its own case under the SAME barcode.
   *
   * Shown because a price is meaningless without it: Barry publish one
   * product at EUR 16.40 the case and EUR 1.50 the bottle, and a screen
   * listing both as "the price" invites the second to be read as a bargain.
   */
  isSingle?: boolean;
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  /** The supplier's own name for it, which is what their site will show. */
  name?: string;
}

/**
 * How completely the suppliers answered.
 *
 * "Cheapest" is a claim about a field, and the field is only as complete as
 * the answers — three quoting and a fourth timing out is not the same
 * evidence as four quoting.
 */
export interface OfferCoverage {
  asked: number;
  priced: number;
  /** Answered, and had nothing under that code. A real fact about their range. */
  notFound: number;
  /** Could not be reached. Says NOTHING about stock. */
  unreachable: number;
  /** No account connected there. A setting, not an outage. */
  notConnected: number;
}

/** Why a line has no prices, when it has none. */
export type NoOfferReason = "no-barcode" | "unknown" | "no-suppliers";

export interface PricedCartLine {
  lineId: number;
  offers: CartOffer[];
  /** The cheapest supplier that can actually supply it. */
  best?: { supplierId: string; supplierSku: string; exVatCasePrice: number };
  /** When these were read. A price without its age is not a price. */
  pricedAt?: string;
  /** Which of our tables identified it: master, catalogue, or none. */
  resolvedFrom?: string;
  /** False when there is nothing to look the product up by. */
  priceable: boolean;
  noOfferReason?: NoOfferReason;
  coverage?: OfferCoverage;
}

export interface CartPrices {
  lines: PricedCartLine[];
  pricedSkus: number;
  requestedSkus: number;
  /** Lines not re-asked about: still fresh, or already sent to a basket. */
  skippedLines: number;
  /** Lines with nothing to look them up by. */
  unpriceableLines: number;
  /**
   * Of those, the ones a COMPARISON could still price.
   *
   * "No barcode to look up" is true of an imported EPOS line and reads as a
   * dead end, when it is exactly what Compare prices searches on — supplier
   * retrieval is text-first.
   */
  needsComparisonLines?: number;
  /** Of those, the ones with nothing to search on at all. */
  unidentifiableLines?: number;
}

/**
 * Fetch live prices for the cart — the SECONDARY price action.
 *
 * THE ONLY CALL IN THIS FILE THAT CONTACTS A WHOLESALER, and only when the
 * button is pressed. It asks a different question from Compare: what does
 * each supplier charge for these exact products right now, cheapest wins, no
 * allocation and no savings baseline.
 *
 * Prices inside the three-hour window are not re-asked unless `force` says
 * so, so pressing the button twice does not fan out twice.
 */
export async function fetchOrderCartPrices(force = false): Promise<{ prices: CartPrices }> {
  return apiFetch<{ prices: CartPrices }>("/api/order-list/prices", {
    method: "POST",
    body: { force },
  });
}
