"use client";

/**
 * What is ACTUALLY in each supplier's basket, right now.
 *
 * ── THE BUG THIS EXISTS TO FIX ──────────────────────────────────────────────
 *
 * The search table used to label its Basket column from two things, neither of
 * which is the basket:
 *
 *   `added`        what happened during THIS page's session. Gone on reload.
 *   `basket_adds`  OUR OWN record that we once sent a product. Its comment said
 *                  as much — "we know we sent it and the supplier accepted it;
 *                  we do not know it is still there".
 *
 * So a product deleted at the wholesaler's own site went on reading "added to
 * Musgrave" forever, and a buyer trusting that label would leave it off the
 * order. An audit trail was being shown as current state.
 *
 * `basket_adds` keeps its job — history, and knowing what we sent — but it stops
 * deciding what the column says.
 *
 * ── WHY A CACHE, AND WHY A SHORT ONE ────────────────────────────────────────
 *
 * Reading a basket is a live request to a logged-in trade account. Searching is
 * a screen whose whole design is that it contacts nobody, and a search that fans
 * out to four wholesalers on every keystroke is a search nobody can use.
 *
 * So: fetched lazily, ONLY for the suppliers a result set actually names, and
 * held for a minute. A minute is short enough that deleting a line at the
 * supplier's site shows up while the buyer is still in the same task, and long
 * enough that paging through results does not re-ask.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * Not localStorage, not a session guess, not an optimistic write. Every answer
 * here came from the supplier within the last minute or is openly reported as
 * unknown. A stale "added" is the failure being removed; replacing it with a
 * different stale source would be the same bug wearing a hat.
 */

import { getBasket, supportsCart, type CartSupplier, type SupplierBasket } from "@/lib/api/cart";

/**
 * How long a basket read stands.
 *
 * Short, because the whole point is that removing a line at the supplier
 * eventually shows here. Not zero, because a search screen must not fan out to
 * trade accounts per interaction.
 */
export const BASKET_TTL_MS = 60_000;

interface Entry {
  at: number;
  /** sku → quantity. Absent from the map means absent from the basket. */
  skus: Map<string, number>;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry | null>>();

/** Testing seam, and the thing a sign-out should call. */
export function resetBasketState(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * Forget one supplier's basket, so the next read is live.
 *
 * Called after WE change that basket. Adding a product and then reading a
 * cached basket from fifty seconds ago would show the buyer their own action
 * not having happened.
 */
export function invalidateBasket(supplierId: string): void {
  cache.delete(supplierId.toLowerCase());
  inFlight.delete(supplierId.toLowerCase());
}

function toEntry(basket: SupplierBasket): Entry {
  const skus = new Map<string, number>();
  for (const [sku, line] of Object.entries(basket.bySku ?? {})) {
    if (sku) skus.set(sku, line?.quantity ?? 0);
  }
  return { at: Date.now(), skus };
}

/**
 * One supplier's basket contents, from cache when fresh and from the supplier
 * when not.
 *
 * Returns `null` when it could not be read. NULL IS NOT EMPTY: a basket we
 * could not reach must not render as "this product is not in your basket",
 * which is a claim we have no basis for. Callers show "Add" in that case —
 * offering an action that turns out to be a duplicate is a smaller harm than
 * hiding one the buyer needs — and the reason is surfaced separately.
 */
export async function basketSkus(supplierId: string): Promise<Map<string, number> | null> {
  const id = supplierId.toLowerCase();
  if (!supportsCart(id)) return null;

  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < BASKET_TTL_MS) return cached.skus;

  // One request per supplier however many rows ask at once.
  let pending = inFlight.get(id);
  if (!pending) {
    pending = getBasket(id as CartSupplier)
      .then((basket) => {
        const entry = toEntry(basket);
        cache.set(id, entry);
        return entry;
      })
      .catch(() => null)
      .finally(() => inFlight.delete(id));

    inFlight.set(id, pending);
  }

  const entry = await pending;
  return entry?.skus ?? null;
}

export interface BasketSnapshot {
  /** supplier id → its skus, for the suppliers that answered. */
  baskets: Map<string, Map<string, number>>;
  /** Suppliers asked that could not be read. Reported, never treated as empty. */
  unreadable: string[];
}

/**
 * Read the baskets for exactly the suppliers a result set names.
 *
 * NOT ALL FOUR, EVERY TIME. A page of results where every winner is Musgrave
 * asks Musgrave, and nobody else. Asking speculatively would spend three trade
 * accounts' rate limit to learn nothing about the products on screen.
 */
export async function readBaskets(supplierIds: Iterable<string>): Promise<BasketSnapshot> {
  const wanted = [...new Set([...supplierIds].map((id) => id.toLowerCase()))].filter(supportsCart);

  const baskets = new Map<string, Map<string, number>>();
  const unreadable: string[] = [];

  await Promise.all(
    wanted.map(async (id) => {
      const skus = await basketSkus(id);
      if (skus) baskets.set(id, skus);
      else unreadable.push(id);
    }),
  );

  return { baskets, unreadable };
}

/**
 * Is this exact product in that supplier's basket right now?
 *
 * `undefined` means "we do not know" — the basket has not been read, or could
 * not be. Deliberately three-valued: collapsing unknown into false is what
 * produces a confident wrong answer.
 */
export function inBasket(
  snapshot: BasketSnapshot,
  supplierId: string | undefined,
  sku: string | undefined,
): boolean | undefined {
  if (!supplierId || !sku) return undefined;

  const skus = snapshot.baskets.get(supplierId.toLowerCase());
  if (!skus) return undefined;

  return skus.has(sku);
}

/** How many of it, when it is there and the supplier said. */
export function basketQuantity(
  snapshot: BasketSnapshot,
  supplierId: string | undefined,
  sku: string | undefined,
): number | undefined {
  if (!supplierId || !sku) return undefined;
  return snapshot.baskets.get(supplierId.toLowerCase())?.get(sku);
}
