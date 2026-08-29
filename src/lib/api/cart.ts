/**
 * Supplier basket API.
 *
 * The frontend NEVER talks to Musgrave. Every call here goes to our own
 * backend, which owns the credentials, the session and the REST contract. That
 * is not only a security boundary — it is why adding O'Reilly later changes one
 * backend file and none of this.
 *
 * THE SUPPLIER BASKET IS THE SOURCE OF TRUTH.
 *
 * Nothing here caches. Every mutation returns the basket as the supplier holds
 * it afterwards, and the caller renders that. A local mirror would drift the
 * moment a buyer touched the Musgrave site in another tab, and it would drift
 * silently, which is the worst way for a cart to be wrong.
 */

import { env } from "./env";
import { accessToken } from "../supabase";

/**
 * A supplier basket the app can drive.
 *
 * Barry appears as its TWO baskets, never as the collapsed "barrygroup" the
 * comparison table shows. There is no combined Barry basket at the supplier —
 * ambient and chill hold different lines and arrive on different days — so a
 * cart call naming "barrygroup" would have nowhere to go.
 */
export type CartSupplier =
  | "musgrave"
  | "oreilly"
  | "barrygroup-ambient"
  | "barrygroup-chill"
  | "kadona";

export interface BasketLineItem {
  basketItemId: string;
  sku: string;
  name?: string;
  quantity: number;
  quantityUnit?: string;
  singleBasePrice?: number;
  totalPrice?: number;
}

export interface BasketTotals {
  itemTotal?: number;
  netTotal?: number;
  grossTotal?: number;
  taxTotal?: number;
  currency: string;
}

export interface SupplierBasket {
  basketId?: string;
  isEmpty: boolean;
  lineItems: BasketLineItem[];
  totals: BasketTotals;
  /** sku → line. Join key against a Ready To Order row's selected SKU. */
  bySku: Record<string, BasketLineItem>;
}

export type AddOutcome = "added" | "updated" | "failed" | "skipped";

export interface AddResult {
  sku: string;
  name?: string;
  outcome: AddOutcome;
  basketItemId?: string;
  quantity?: number;
  error?: string;
}

export interface AddProductsResult {
  results: AddResult[];
  added: number;
  updated: number;
  failed: number;
  skipped: number;
  basket: SupplierBasket;
}

export interface ValidationMessage {
  code?: string;
  message: string;
  severity: "error" | "warning" | "info";
  sku?: string;
}

export interface BasketValidation {
  valid: boolean;
  messages: ValidationMessage[];
  basket: SupplierBasket;
}

export interface AddItemRequest {
  sku: string;
  quantity: number;
  unit?: string;
  name?: string;
}

function url(path: string): string {
  return new URL(path, env.apiBaseUrl).toString();
}

/**
 * Every cart request, authenticated.
 *
 * `/api/cart` is authenticated at the backend — a basket spends real money at a
 * real supplier, so it is gated like the rest of the API. These calls used to be
 * bare `fetch`es with no Authorization header, which meant a signed-in buyer saw
 * "Could not read the supplier basket: Sign in to continue" on a dashboard whose
 * uploads and searches were working perfectly, because only those went through
 * clients that attach the token.
 *
 * The header is attached HERE, once, rather than at five call sites, for the
 * same reason `apiFetch` does it: a sixth endpoint added later cannot
 * reintroduce this by forgetting.
 *
 * A missing token is not short-circuited — the request goes out unauthenticated
 * and the backend answers 401 with its own wording, so there is one authority on
 * what "not signed in" means rather than two that can disagree.
 */
async function request(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const token = await accessToken();

  return fetch(url(path), {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Read the body once, and prefer the backend's `error` over a bare status. */
async function readOrThrow<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let message = text || res.statusText;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* the raw text is the best we have */
    }
    throw new Error(`${what}: ${message}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * A line this buyer has already sent to a supplier basket.
 *
 * A RECORD OF AN ACTION, not a mirror of the basket. We know we sent it and the
 * supplier accepted it; we do not know whether somebody has since deleted the
 * line on the supplier's own site. Screens say "added", in the past tense.
 */
export interface BasketAdd {
  supplierId: string;
  sku: string;
  /** What the supplier reported holding after the add, when it said. */
  quantity?: number;
  addedAt: string;
  firstAddedAt: string;
}

/**
 * POST /api/cart/adds — which of these lines are already on an order.
 *
 * ASKED OF OUR OWN DATABASE. The obvious implementation is to read each
 * supplier's basket, but that is a live request to a logged-in trade account
 * per supplier, and this is called by a search screen whose whole design is
 * that searching contacts nobody.
 */
export async function fetchBasketAdds(
  items: { supplierId: string; sku: string }[],
): Promise<BasketAdd[]> {
  if (items.length === 0) return [];

  const res = await request("/api/cart/adds", { method: "POST", body: { items } });
  const body = await readOrThrow<{ adds: BasketAdd[] }>(
    res,
    "Could not check what is already in your baskets",
  );
  return body.adds ?? [];
}

/** The basket exactly as the supplier holds it right now. */
export async function getBasket(
  supplier: CartSupplier = "musgrave",
): Promise<SupplierBasket> {
  const res = await request(`/api/cart/${supplier}`);
  return readOrThrow<SupplierBasket>(res, "Could not read the supplier basket");
}

/** Why one product was refused. Mirrors the backend's codes exactly. */
export type CartBlockCode =
  | "verification-required"
  | "verification-stale"
  | "verification-invalidated"
  | "verification-failed"
  | "verification-other-product";

export interface NeedsVerificationEntry {
  sku: string;
  /** The job line, when a standing verification could name one. */
  row?: number;
  code: CartBlockCode;
  reason: string;
  changes?: { field: string; previous?: string | number; next?: string | number }[];
}

/**
 * The basket refused these products until they are re-checked.
 *
 * A DISTINCT ERROR TYPE, not a message. The caller does not want to print this
 * — it wants to offer the retailer a "Check them now" button for exactly these
 * rows, and it cannot do that from a sentence. Everything else the cart can
 * fail with stays an ordinary Error.
 */
export class VerificationRequiredError extends Error {
  readonly needsVerification: NeedsVerificationEntry[];

  constructor(message: string, needsVerification: NeedsVerificationEntry[]) {
    super(message);
    this.name = "VerificationRequiredError";
    this.needsVerification = needsVerification;
  }
}

/**
 * Add every item in one call to OUR backend.
 *
 * The backend then issues one request per product to Musgrave, because their
 * add endpoint rejects a batched body. That is deliberately hidden here: the
 * page should not have to know how many HTTP calls a supplier needs.
 *
 * `jobId` IS NOT OPTIONAL DECORATION. The backend's three-hour price lock only
 * applies to an add that says which job it came from — a bare {sku, quantity}
 * has no prices behind it to be stale, and the manual-add path legitimately
 * sends none. This call previously omitted it, which meant every add from the
 * results table looked like a manual one and the lock never fired on the exact
 * path it exists to protect.
 */
export async function addItems(
  items: AddItemRequest[],
  supplier: CartSupplier = "musgrave",
  jobId?: string,
): Promise<AddProductsResult> {
  const res = await request(`/api/cart/${supplier}/items`, {
    method: "POST",
    body: { items, ...(jobId ? { jobId } : {}) },
  });

  // Read before `readOrThrow`, which collapses every failure into a sentence.
  // This one carries a list the caller has to act on.
  if (res.status === 409) {
    const body = (await res.clone().json().catch(() => null)) as {
      error?: string;
      lock?: string;
      needsVerification?: NeedsVerificationEntry[];
    } | null;

    if (body?.lock === "verification-required") {
      throw new VerificationRequiredError(
        body.error ?? "These products need checking before they can be added.",
        body.needsVerification ?? [],
      );
    }
  }

  return readOrThrow<AddProductsResult>(res, "Could not add products to the basket");
}

/** Set a line's quantity. Zero removes it — the backend handles that. */
export async function setQuantity(
  basketItemId: string,
  quantity: number,
  sku: string,
  supplier: CartSupplier = "musgrave",
): Promise<SupplierBasket> {
  const res = await request(`/api/cart/${supplier}/items/${basketItemId}`, {
    method: "PATCH",
    body: { quantity, sku },
  });
  return readOrThrow<SupplierBasket>(res, "Could not update the quantity");
}

export async function removeItem(
  basketItemId: string,
  supplier: CartSupplier = "musgrave",
): Promise<SupplierBasket> {
  const res = await request(`/api/cart/${supplier}/items/${basketItemId}`, {
    method: "DELETE",
  });
  return readOrThrow<SupplierBasket>(res, "Could not remove the product");
}

export async function validateBasket(
  supplier: CartSupplier = "musgrave",
): Promise<BasketValidation> {
  const res = await request(`/api/cart/${supplier}/validate`, { method: "POST" });
  return readOrThrow<BasketValidation>(res, "Could not validate the basket");
}

// ---------------------------------------------------------------------------
// Removing one job's lines
// ---------------------------------------------------------------------------

/** One line the removal acted on, or failed to. */
export interface RemovalLine {
  sku: string;
  name?: string;
  basketItemId?: string;
  outcome: "removed" | "failed" | "already-absent";
  error?: string;
}

/** A basket line this job never owned, and which was therefore left alone. */
export interface KeptLine {
  sku: string;
  name?: string;
  quantity: number;
}

export interface RemovalReport {
  removed: RemovalLine[];
  failed: RemovalLine[];
  kept: KeptLine[];
  notInBasket: string[];
  reconciliation?: {
    stillPresent: string[];
    keptLost: string[];
    linesBefore: number;
    linesAfter: number;
    agrees: boolean;
  };
}

export interface RemovalRun {
  id: string;
  jobId: string;
  supplier: string;
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt?: string;
  progress: { completed: number; total: number };
  report: RemovalReport;
  error?: string;
}

/**
 * Ask the supplier to give back the lines THIS job put in the basket.
 *
 * Scoped by jobId, always. There is no whole-basket clear and there must never
 * be one: a basket holds stock added at the supplier's own site and leftovers
 * from earlier uploads, and there is no undo at the far end.
 *
 * The supplier id must be the EXACT one — `barrygroup-ambient`, never the
 * collapsed `barrygroup` the price table displays. Ambient and chill are two
 * separate baskets arriving on different days; "barrygroup" is not a basket at
 * all and the route would reject it.
 *
 * Returns as soon as the run has STARTED. Removal is one request per line and
 * Kadona re-reads its whole cart around each one, so this is minutes of work —
 * the caller polls `removalStatus`.
 */
export async function removeJobLines(
  supplier: CartSupplier,
  jobId: string,
): Promise<{ removalId: string; supplier: string; jobId: string; poll: string }> {
  const res = await request(`/api/cart/${supplier}/remove-job-lines`, {
    method: "POST",
    body: { jobId },
  });
  return readOrThrow(res, "Could not start removing these lines");
}

export async function removalStatus(
  supplier: CartSupplier,
  removalId: string,
): Promise<RemovalRun> {
  const res = await request(`/api/cart/${supplier}/removals/${removalId}`);
  return readOrThrow<RemovalRun>(res, "Could not read the removal status");
}

// ---------------------------------------------------------------------------
// Helpers shared by the Ready To Order views
// ---------------------------------------------------------------------------

/** Suppliers with a working cart integration. Must match the backend's own list. */
export const CART_SUPPLIERS: ReadonlySet<string> = new Set([
  "musgrave",
  "oreilly",
  // Two entries, matching the two baskets the backend routes expose at
  // /api/cart/barrygroup-ambient and /api/cart/barrygroup-chill.
  "barrygroup-ambient",
  "barrygroup-chill",
  "kadona",
]);

export function supportsCart(supplierId: string): boolean {
  return CART_SUPPLIERS.has(supplierId.toLowerCase());
}

/**
 * Display names for supplier ids, so "oreilly" never reaches a buyer's screen.
 * Falls back to the id — a new supplier appearing untitled beats it appearing
 * as nothing.
 */
export const SUPPLIER_LABELS: Record<string, string> = {
  musgrave: "Musgrave",
  oreilly: "O'Reilly",
  // Barry is ONE supplier to a retailer. The backend keeps ambient and chill as
  // separate suppliers because they are separate baskets with their own
  // delivery dates and minimums, and allocation genuinely needs that — but a
  // buyer comparing prices does not, and two mostly-empty "Barry" columns is
  // worse than one. The split stays visible in the admin app.
  barrygroup: "Barry Group",
  "barrygroup-ambient": "Barry Group",
  "barrygroup-chill": "Barry Group",
  kadona: "Kadona",
};

/**
 * The supplier id a RETAILER sees, which is not always the one the system
 * orders from.
 *
 * Barry's ambient and chill baskets collapse to a single "barrygroup" for
 * display. This is presentation ONLY — it must never be used to place an order,
 * add to a basket, or decide a threshold, because the two baskets have
 * different commercial terms and `barrygroup` is not a real basket at all.
 * Anything touching the supplier's site keeps the precise id.
 */
export function displaySupplierId(supplierId: string): string {
  return supplierId.startsWith("barrygroup") ? "barrygroup" : supplierId;
}

/** True when two supplier ids are the same supplier as far as a buyer cares. */
export function sameDisplaySupplier(a: string, b: string): boolean {
  return displaySupplierId(a) === displaySupplierId(b);
}

/**
 * The name to show on a BASKET, where the collapse must not apply.
 *
 * Comparing prices, a buyer wants one "Barry Group". Looking at baskets they
 * need the opposite: these are two orders, delivered on different days, each
 * with its own minimum. Two panels both labelled "Barry Group" would look like
 * a bug and hide the fact that the order has been split in two.
 */
export function cartSupplierLabel(id: string): string {
  if (id === "barrygroup-ambient") return "Barry Group · Ambient";
  if (id === "barrygroup-chill") return "Barry Group · Chill";
  return supplierLabel(id);
}

export function supplierLabel(id: string): string {
  return SUPPLIER_LABELS[id.toLowerCase()] ?? id;
}

/**
 * The Ready To Order rows that can actually be sent to a basket.
 *
 * A row qualifies only when its chosen supplier has an integration AND the
 * selection carries a SKU — a line without one cannot be ordered by anybody,
 * and offering to add it would produce a failure the buyer cannot act on.
 */
export function cartEligible<
  T extends { bestSupplier: string; detail: { selected?: { sku?: string } } },
>(rows: readonly T[]): T[] {
  return rows.filter(
    (row) => supportsCart(row.bestSupplier) && Boolean(row.detail.selected?.sku),
  );
}
