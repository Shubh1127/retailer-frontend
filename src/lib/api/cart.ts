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

export type CartSupplier = "musgrave" | "oreilly";

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

/** The basket exactly as the supplier holds it right now. */
export async function getBasket(
  supplier: CartSupplier = "musgrave",
): Promise<SupplierBasket> {
  const res = await request(`/api/cart/${supplier}`);
  return readOrThrow<SupplierBasket>(res, "Could not read the supplier basket");
}

/**
 * Add every item in one call to OUR backend.
 *
 * The backend then issues one request per product to Musgrave, because their
 * add endpoint rejects a batched body. That is deliberately hidden here: the
 * page should not have to know how many HTTP calls a supplier needs.
 */
export async function addItems(
  items: AddItemRequest[],
  supplier: CartSupplier = "musgrave",
): Promise<AddProductsResult> {
  const res = await request(`/api/cart/${supplier}/items`, {
    method: "POST",
    body: { items },
  });
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
// Helpers shared by the Ready To Order views
// ---------------------------------------------------------------------------

/** Suppliers with a working cart integration. Must match the backend's own list. */
export const CART_SUPPLIERS: ReadonlySet<string> = new Set([
  "musgrave",
  "oreilly",
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
};

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
