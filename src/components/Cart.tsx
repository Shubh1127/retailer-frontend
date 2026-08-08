"use client";

/**
 * Supplier cart UI for the Ready To Order table.
 *
 * THE SUPPLIER BASKET IS THE SOURCE OF TRUTH.
 *
 * Every control here sends its change to the backend and then renders whatever
 * the basket came back as. Nothing is optimistically applied and nothing is
 * cached across a reload: a buyer who edits their basket on the supplier's own
 * site in another tab must see that here, and a cart that quietly disagrees
 * with the supplier is worse than one that takes a moment to answer.
 *
 * ONE BASKET PER SUPPLIER.
 *
 * This used to hold a single basket and call an API that defaults to Musgrave.
 * That was correct while Musgrave was the only integration and became a real
 * hazard the moment O'Reilly joined `CART_SUPPLIERS`: an O'Reilly row would
 * have had its SKU looked up in the MUSGRAVE basket (so always "not added"),
 * and "add all" would have posted O'Reilly product codes to Musgrave — buying
 * the wrong thing, or failing, at a real supplier.
 *
 * So baskets, errors and busy state are all keyed by supplier, and every call
 * names the supplier it is for. A row is only ever compared against its OWN
 * supplier's basket.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addItems,
  getBasket,
  removeItem,
  setQuantity,
  supportsCart,
  supplierLabel as label,
  validateBasket,
  CART_SUPPLIERS,
  type AddProductsResult,
  type AddResult,
  type BasketValidation,
  type CartSupplier,
  type SupplierBasket,
} from "@/lib/api/cart";
import { eur, type ReadyToOrderRow } from "@/lib/api/jobs";

/** Every supplier with an integration, in a stable order for rendering. */
const SUPPLIERS = [...CART_SUPPLIERS] as CartSupplier[];

const EMPTY_BASKET: SupplierBasket = {
  isEmpty: true,
  lineItems: [],
  totals: { currency: "EUR" },
  bySku: {},
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CartState {
  baskets: Record<string, SupplierBasket | null>;
  isLoading: boolean;
  /** Per supplier, so one supplier being down does not blank the other. */
  errors: Record<string, string | null>;
  /** `supplier:key` currently changing, so only that control shows a spinner. */
  busyKey: string | null;
  refresh: (supplier?: CartSupplier) => Promise<void>;
  changeQuantity: (
    supplier: CartSupplier,
    basketItemId: string,
    quantity: number,
    sku: string,
  ) => Promise<void>;
  /** Add ONE product — what the per-row button calls. */
  addOne: (
    supplier: CartSupplier,
    sku: string,
    quantity: number,
    name?: string,
  ) => Promise<void>;
  lineFor: (supplier: string, sku: string) => SupplierBasket["bySku"][string] | undefined;
}

/**
 * Every supplier's basket, synced on mount.
 *
 * Loaded concurrently and reported independently: a Musgrave outage must not
 * hide the O'Reilly basket, and vice versa. A row is "in cart" because the
 * SUPPLIER says so, not because we remember adding it.
 */
export function useCart(): CartState {
  const [baskets, setBaskets] = useState<Record<string, SupplierBasket | null>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refreshOne = useCallback(async (supplier: CartSupplier) => {
    try {
      const basket = await getBasket(supplier);
      setBaskets((current) => ({ ...current, [supplier]: basket }));
      setErrors((current) => ({ ...current, [supplier]: null }));
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [supplier]:
          err instanceof Error ? err.message : "Could not read the basket",
      }));
    }
  }, []);

  const refresh = useCallback(
    async (supplier?: CartSupplier) => {
      const targets = supplier ? [supplier] : SUPPLIERS;
      await Promise.all(targets.map(refreshOne));
      setIsLoading(false);
    },
    [refreshOne],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeQuantity = useCallback(
    async (
      supplier: CartSupplier,
      basketItemId: string,
      quantity: number,
      sku: string,
    ) => {
      setBusyKey(`${supplier}:${basketItemId}`);
      try {
        // Zero removes. The backend routes it to DELETE, so the rule lives in
        // one place rather than being re-decided by every caller.
        const next =
          quantity <= 0
            ? await removeItem(basketItemId, supplier)
            : await setQuantity(basketItemId, quantity, sku, supplier);
        setBaskets((current) => ({ ...current, [supplier]: next }));
        setErrors((current) => ({ ...current, [supplier]: null }));
      } catch (err) {
        setErrors((current) => ({
          ...current,
          [supplier]:
            err instanceof Error ? err.message : "Could not update the basket",
        }));
        // Re-read rather than assume: a failed write may still have applied.
        await refreshOne(supplier);
      } finally {
        setBusyKey(null);
      }
    },
    [refreshOne],
  );

  const addOne = useCallback(
    async (supplier: CartSupplier, sku: string, quantity: number, name?: string) => {
      // Keyed on the SKU, not a basketItemId — the line does not exist yet.
      setBusyKey(`${supplier}:${sku}`);
      try {
        const outcome = await addItems(
          [{ sku, quantity, ...(name ? { name } : {}) }],
          supplier,
        );
        setBaskets((current) => ({ ...current, [supplier]: outcome.basket }));

        // A per-product failure comes back inside a 200 — the request worked,
        // the add did not. Surfaced rather than swallowed, or the button would
        // look like it did nothing.
        const failure = outcome.results.find((entry) => entry.outcome === "failed");
        setErrors((current) => ({
          ...current,
          [supplier]: failure ? (failure.error ?? "Could not add the product") : null,
        }));
      } catch (err) {
        setErrors((current) => ({
          ...current,
          [supplier]:
            err instanceof Error ? err.message : "Could not add the product",
        }));
        await refreshOne(supplier);
      } finally {
        setBusyKey(null);
      }
    },
    [refreshOne],
  );

  const lineFor = useCallback(
    (supplier: string, sku: string) => baskets[supplier]?.bySku[sku],
    [baskets],
  );

  return { baskets, isLoading, errors, busyKey, refresh, changeQuantity, addOne, lineFor };
}

// ---------------------------------------------------------------------------
// Per-row cell
// ---------------------------------------------------------------------------

export function CartCell({
  row,
  cart,
}: {
  row: ReadyToOrderRow;
  cart: CartState;
}) {
  const sku = row.detail.selected?.sku;
  const supplier = row.bestSupplier as CartSupplier;

  if (!supportsCart(supplier) || !sku) {
    return (
      <span
        className="text-[12px] text-ink-faint"
        title={
          sku
            ? `${row.bestSupplierName} has no cart integration yet`
            : "This selection has no supplier product code"
        }
      >
        —
      </span>
    );
  }

  const line = cart.lineFor(supplier, sku);

  // NOT in the basket — an Add button rather than the words "Not Added".
  // The row already knows the supplier and how many cases the file asked for,
  // so adding it is one click and needs no further input.
  if (!line) {
    const isBusy = cart.busyKey === `${supplier}:${sku}`;
    return (
      <button
        type="button"
        disabled={isBusy || cart.isLoading}
        onClick={() => void cart.addOne(supplier, sku, row.cases, row.product)}
        className="rounded-md border border-teal-600 px-2 py-1 text-[11.5px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40"
        title={`Add ${row.cases} × ${row.product} to the ${label(supplier)} basket`}
      >
        {isBusy ? "Adding…" : `＋ Add${row.cases > 1 ? ` ${row.cases}` : ""}`}
      </button>
    );
  }

  const isBusy = cart.busyKey === `${supplier}:${line.basketItemId}`;

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11.5px] font-medium text-emerald-700">
        🟢 In {label(supplier)}
      </span>
      <div className="flex items-center gap-1">
        {/* At one, decrementing means removing — so it says so. The supplier's
            own basket does the same: minus is disabled and a bin appears, which
            makes "this will take it out of the cart" a deliberate click rather
            than an accident at the end of a long press. */}
        {line.quantity <= 1 ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              void cart.changeQuantity(supplier, line.basketItemId, 0, sku)
            }
            className="h-6 w-6 rounded border border-line text-[12px] leading-none text-ink-soft hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            aria-label={`Remove ${row.product} from the basket`}
            title="Remove from basket"
          >
            🗑
          </button>
        ) : (
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              void cart.changeQuantity(
                supplier,
                line.basketItemId,
                line.quantity - 1,
                sku,
              )
            }
            className="h-6 w-6 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
            aria-label={`Decrease ${row.product}`}
          >
            −
          </button>
        )}
        <span className="w-7 text-center text-[13px] tabular-nums text-ink">
          {isBusy ? "…" : line.quantity}
        </span>
        <button
          type="button"
          disabled={isBusy}
          onClick={() =>
            void cart.changeQuantity(
              supplier,
              line.basketItemId,
              line.quantity + 1,
              sku,
            )
          }
          className="h-6 w-6 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
          aria-label={`Increase ${row.product}`}
        >
          ＋
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-all bar, modal and result
// ---------------------------------------------------------------------------

interface Progress {
  completed: number;
  total: number;
}

/** Rows that can be acted on, grouped by the supplier that will receive them. */
function groupBySupplier(rows: ReadyToOrderRow[]): Map<CartSupplier, ReadyToOrderRow[]> {
  const grouped = new Map<CartSupplier, ReadyToOrderRow[]>();

  for (const row of rows) {
    const supplier = row.bestSupplier as CartSupplier;
    if (!supportsCart(supplier) || !row.detail.selected?.sku) continue;
    const existing = grouped.get(supplier);
    if (existing) existing.push(row);
    else grouped.set(supplier, [row]);
  }

  return grouped;
}

export function CartBar({
  rows,
  cart,
}: {
  rows: ReadyToOrderRow[];
  cart: CartState;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<AddProductsResult | null>(null);
  const [validations, setValidations] = useState<Record<string, BasketValidation>>({});

  /**
   * Rows this button can act on, per supplier.
   *
   * Counting rows it cannot add would make the modal promise more than the run
   * delivers, and mixing suppliers would send a product to the wrong basket.
   */
  const bySupplier = useMemo(() => groupBySupplier(rows), [rows]);

  const eligible = useMemo(
    () => [...bySupplier.values()].flat(),
    [bySupplier],
  );

  const notInCart = useMemo(
    () =>
      eligible.filter(
        (row) => !cart.lineFor(row.bestSupplier, row.detail.selected!.sku!),
      ),
    [eligible, cart],
  );

  const estimatedExVat = useMemo(
    () => notInCart.reduce((sum, row) => sum + row.price * row.cases, 0),
    [notInCart],
  );

  const isRunning = progress !== null;

  const run = useCallback(async () => {
    setIsConfirming(false);
    setResult(null);
    setValidations({});
    setProgress({ completed: 0, total: notInCart.length });

    const merged: AddResult[] = [];
    let completed = 0;

    // One call PER SUPPLIER. Each backend fans out to its own supplier and
    // reports per product, so the page never needs to know how many HTTP
    // requests that took — only which basket each row belongs in.
    for (const [supplier, supplierRows] of bySupplier) {
      const pending = supplierRows.filter(
        (row) => !cart.lineFor(supplier, row.detail.selected!.sku!),
      );
      if (pending.length === 0) continue;

      try {
        const outcome = await addItems(
          pending.map((row) => ({
            sku: row.detail.selected!.sku!,
            quantity: row.cases,
            name: row.product,
          })),
          supplier,
        );
        merged.push(...outcome.results);
      } catch (err) {
        // One supplier failing must not lose the other's results.
        merged.push(
          ...pending.map((row) => ({
            sku: row.detail.selected!.sku!,
            name: row.product,
            outcome: "failed" as const,
            error: err instanceof Error ? err.message : "Request failed",
          })),
        );
      }

      completed += pending.length;
      setProgress({ completed, total: notInCart.length });
    }

    await cart.refresh();

    const count = (outcome: AddResult["outcome"]) =>
      merged.filter((entry) => entry.outcome === outcome).length;

    setResult({
      results: merged,
      added: count("added"),
      updated: count("updated"),
      failed: count("failed"),
      skipped: count("skipped"),
      basket: EMPTY_BASKET,
    });

    // Validate once everything is in, so a minimum-order warning reflects the
    // finished basket rather than a half-filled one.
    for (const supplier of bySupplier.keys()) {
      try {
        const validation = await validateBasket(supplier);
        setValidations((current) => ({ ...current, [supplier]: validation }));
      } catch {
        /* advisory only; a failure here must not hide the add result */
      }
    }

    setProgress(null);
  }, [notInCart, bySupplier, cart]);

  const activeSuppliers = [...bySupplier.keys()];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12.5px]">
          {/* Stated per supplier. One combined number would hide which basket a
              buyer still has to deal with. */}
          {activeSuppliers.map((supplier) => {
            const basket = cart.baskets[supplier];
            const ready = bySupplier.get(supplier)?.length ?? 0;
            return (
              <div key={supplier}>
                <span className="text-ink-faint">{label(supplier)}</span>{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {cart.isLoading ? "…" : basket?.lineItems.length ?? 0}
                </span>
                <span className="text-ink-faint"> / {ready} ready</span>
                {basket?.totals.netTotal !== undefined && (
                  <span className="text-ink-faint">
                    {" "}
                    · {eur(basket.totals.netTotal)} ex-VAT
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          disabled={isRunning || cart.isLoading || notInCart.length === 0}
          onClick={() => setIsConfirming(true)}
          className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning
            ? `Adding products… ${progress.completed} / ${progress.total}`
            : notInCart.length === 0
              ? eligible.length > 0
                ? "🛒 All ready items in cart"
                : "🛒 Nothing to add"
              : `🛒 Add All Ready Items to Cart (${notInCart.length})`}
        </button>
      </div>

      {/* Reported per supplier and named, so "the cart is broken" is never the
          takeaway when only one of two is. */}
      {SUPPLIERS.filter((supplier) => cart.errors[supplier]).map((supplier) => (
        <div
          key={supplier}
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-700"
        >
          <strong className="font-medium">{label(supplier)}</strong>:{" "}
          {cart.errors[supplier]}
        </div>
      ))}

      {isConfirming && (
        <ConfirmModal
          bySupplier={bySupplier}
          cart={cart}
          count={notInCart.length}
          exVat={estimatedExVat}
          onCancel={() => setIsConfirming(false)}
          onConfirm={() => void run()}
        />
      )}

      {result && (
        <AddSummary
          result={result}
          validations={validations}
          onDismiss={() => setResult(null)}
        />
      )}
    </>
  );
}

function ConfirmModal({
  bySupplier,
  cart,
  count,
  exVat,
  onCancel,
  onConfirm,
}: {
  bySupplier: Map<CartSupplier, ReadyToOrderRow[]>;
  cart: CartState;
  count: number;
  exVat: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-lg">
        <h2 className="text-[15px] font-semibold text-ink">
          Add to supplier baskets
        </h2>

        <dl className="mt-4 space-y-2 text-[13px]">
          {/* Broken down by supplier: this spends money at each one separately,
              and a buyer confirming should see which. */}
          {[...bySupplier.entries()].map(([supplier, supplierRows]) => {
            const pending = supplierRows.filter(
              (row) => !cart.lineFor(supplier, row.detail.selected!.sku!),
            );
            return (
              <div key={supplier} className="flex justify-between">
                <dt className="text-ink-soft">{label(supplier)}</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {pending.length} product{pending.length === 1 ? "" : "s"}
                </dd>
              </div>
            );
          })}
          <div className="flex justify-between border-t border-line pt-2">
            <dt className="text-ink-soft">Total products</dt>
            <dd className="font-medium tabular-nums text-ink">{count}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Estimated ex-VAT total</dt>
            <dd className="font-medium tabular-nums text-ink">{eur(exVat)}</dd>
          </div>
        </dl>

        <p className="mt-3 text-[12px] text-ink-faint">
          Quantities come from the order file. Products already in a basket are
          left as they are. Gross totals are confirmed by each supplier once the
          basket is priced.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-teal-700"
          >
            Confirm Add
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What happened, per product.
 *
 * Failures are listed by NAME rather than counted, because "3 failed" is not
 * something a buyer can act on and "Kinder Bueno — delisted" is.
 */
function AddSummary({
  result,
  validations,
  onDismiss,
}: {
  result: AddProductsResult;
  validations: Record<string, BasketValidation>;
  onDismiss: () => void;
}) {
  const failed = result.results.filter((entry) => entry.outcome === "failed");
  const skipped = result.results.filter((entry) => entry.outcome === "skipped");

  return (
    <div className="mb-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13px]">
          <span className="font-semibold text-emerald-700">
            {result.added + result.updated} added
          </span>
          {result.skipped > 0 && (
            <span className="text-ink-soft"> · {result.skipped} already in cart</span>
          )}
          {result.failed > 0 && (
            <span className="text-red-600"> · {result.failed} failed</span>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[12px] text-ink-faint hover:text-ink"
        >
          Dismiss
        </button>
      </div>

      {failed.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="text-[12px] font-medium text-red-700">Failed</div>
          <ul className="mt-1 space-y-0.5">
            {failed.map((entry) => (
              <li key={entry.sku} className="text-[12px] text-ink-soft">
                {entry.name ?? entry.sku}
                <span className="text-ink-faint"> — {entry.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="text-[12px] font-medium text-ink-soft">Skipped</div>
          <ul className="mt-1 space-y-0.5">
            {skipped.map((entry) => (
              <li key={entry.sku} className="text-[12px] text-ink-faint">
                {entry.name ?? entry.sku} — {entry.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.entries(validations).map(([supplier, validation]) =>
        validation.messages.length > 0 ? (
          <div key={supplier} className="mt-2 border-t border-line pt-2">
            <div className="text-[12px] font-medium text-ink-soft">
              {label(supplier)} basket validation
            </div>
            <ul className="mt-1 space-y-0.5">
              {validation.messages.map((message, index) => (
                <li
                  key={`${message.code ?? index}`}
                  className={`text-[12px] ${
                    message.severity === "error" ? "text-red-600" : "text-ink-soft"
                  }`}
                >
                  {message.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
