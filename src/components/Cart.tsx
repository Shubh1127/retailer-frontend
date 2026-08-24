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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addItems,
  getBasket,
  removeItem,
  setQuantity,
  supportsCart,
  cartSupplierLabel as label,
  validateBasket,
  CART_SUPPLIERS,
  VerificationRequiredError,
  type AddProductsResult,
  type AddResult,
  type BasketValidation,
  type CartSupplier,
  type NeedsVerificationEntry,
  type SupplierBasket,
} from "@/lib/api/cart";
import { eur, type ReadyToOrderRow, type RowVerification } from "@/lib/api/jobs";

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
  /**
   * Per supplier, so one supplier being down does not blank the other.
   *
   * Set only once retries are EXHAUSTED. While a reconnect is still coming the
   * supplier sits in `status` as "reconnecting" and this stays null — a red
   * error a buyer cannot act on, about a page that is already fixing itself, is
   * noise that teaches them to ignore the next real one.
   */
  errors: Record<string, string | null>;
  /**
   * Whether each supplier's basket is known well enough to add to it.
   *
   * Adding to a basket we could not read risks duplicating lines the buyer
   * already has. O'Reilly's expired session answers with the login page rather
   * than an error, and the backend refuses to report that as an empty basket
   * precisely so this can be decided honestly rather than guessed.
   */
  status: Record<string, BasketStatus>;
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
  /**
   * Products the backend refused until they are re-checked, by supplier.
   *
   * Separate from `errors` because it is not one: the request was fine and the
   * retailer did nothing wrong. It is a list of rows that need an action, and
   * the page offers that action rather than printing a sentence.
   */
  needsVerification: Record<string, NeedsVerificationEntry[]>;
  clearVerificationBlock: (supplier: CartSupplier) => void;
}

/**
 * Every supplier's basket, synced on mount.
 *
 * Loaded concurrently and reported independently: a Musgrave outage must not
 * hide the O'Reilly basket, and vice versa. A row is "in cart" because the
 * SUPPLIER says so, not because we remember adding it.
 */
/**
 * How many times a failed basket read is retried before giving up, and how long
 * the gaps are.
 *
 * O'REILLY'S SESSION IS THE REASON THIS EXISTS. Their site is classic ASP with
 * state in a cookie, and an expired session answers with the login page. The
 * backend re-logs-in and retries once on its own, which handles the ordinary
 * case; these attempts cover the rest — a login that is briefly rate-limited, a
 * cold start racing the first page load, a supplier restarting.
 *
 * Growing gaps, because a supplier that failed twice is not going to be fixed
 * by asking a third time immediately, and hammering a real trade account is how
 * it gets locked.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 12_000];

/**
 * Whether this supplier's basket is known well enough to add to it.
 *
 *   loading       first read in flight
 *   ready         we have a basket and it is current
 *   reconnecting  a read failed and another attempt is scheduled
 *   unavailable   retries exhausted; the basket state is unknown
 *
 * The distinction that matters is `ready` versus everything else. Adding to a
 * basket we could not read risks duplicating lines a buyer already has — the
 * backend refuses to report an unread O'Reilly basket as empty precisely so
 * this decision can be made honestly here.
 */
export type BasketStatus = "loading" | "ready" | "reconnecting" | "unavailable";

export function useCart(jobId?: string): CartState {
  const [baskets, setBaskets] = useState<Record<string, SupplierBasket | null>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<Record<string, BasketStatus>>(() =>
    Object.fromEntries(SUPPLIERS.map((supplier) => [supplier, "loading"])),
  );
  const [needsVerification, setNeedsVerification] = useState<
    Record<string, NeedsVerificationEntry[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /**
   * Timers for scheduled retries, so unmounting cancels them.
   *
   * Without this a page closed during a twelve-second backoff still wakes up
   * and calls `setState` on a component that is gone.
   */
  const retryTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(
    () => () => {
      for (const timer of Object.values(retryTimers.current)) clearTimeout(timer);
    },
    [],
  );

  /**
   * Read one basket, retrying a failure on a growing delay.
   *
   * `attempt` counts from zero and indexes `RETRY_DELAYS_MS`. It is threaded
   * through rather than held in state because two refreshes can legitimately
   * overlap — a manual one and a scheduled one — and a shared counter would
   * have them consume each other's attempts.
   */
  const refreshOne = useCallback(async (supplier: CartSupplier, attempt = 0) => {
    clearTimeout(retryTimers.current[supplier]);

    try {
      const basket = await getBasket(supplier);
      setBaskets((current) => ({ ...current, [supplier]: basket }));
      setErrors((current) => ({ ...current, [supplier]: null }));
      setStatus((current) => ({ ...current, [supplier]: "ready" }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not read the basket";
      const delay = RETRY_DELAYS_MS[attempt];

      // A retry is still coming, so this is not yet a failure to report. The
      // buyer sees "Reconnecting…", which is true and is not their problem to
      // solve; a red error they cannot act on invites them to reload a page
      // that is already fixing itself.
      if (delay !== undefined) {
        setStatus((current) => ({ ...current, [supplier]: "reconnecting" }));
        setErrors((current) => ({ ...current, [supplier]: null }));
        retryTimers.current[supplier] = setTimeout(() => {
          void refreshOne(supplier, attempt + 1);
        }, delay);
        return;
      }

      // Out of attempts. NOW it is worth saying, because nothing further is
      // going to happen on its own.
      setStatus((current) => ({ ...current, [supplier]: "unavailable" }));
      setErrors((current) => ({ ...current, [supplier]: message }));
    }
  }, []);

  const refresh = useCallback(
    async (supplier?: CartSupplier) => {
      const targets = supplier ? [supplier] : SUPPLIERS;
      await Promise.all(targets.map((target) => refreshOne(target)));
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
          jobId,
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
        // A refusal pending verification is NOT an error. The retailer did
        // nothing wrong and there is a specific action that fixes it, so it
        // goes somewhere the page can offer that action from.
        if (err instanceof VerificationRequiredError) {
          setNeedsVerification((current) => ({
            ...current,
            [supplier]: err.needsVerification,
          }));
          setErrors((current) => ({ ...current, [supplier]: null }));
        } else {
          setErrors((current) => ({
            ...current,
            [supplier]:
              err instanceof Error ? err.message : "Could not add the product",
          }));
          await refreshOne(supplier);
        }
      } finally {
        setBusyKey(null);
      }
    },
    [refreshOne, jobId],
  );

  const lineFor = useCallback(
    (supplier: string, sku: string) => baskets[supplier]?.bySku[sku],
    [baskets],
  );

  const clearVerificationBlock = useCallback((supplier: CartSupplier) => {
    setNeedsVerification((current) => {
      if (!current[supplier]) return current;
      const next = { ...current };
      delete next[supplier];
      return next;
    });
  }, []);

  return {
    baskets,
    isLoading,
    errors,
    status,
    busyKey,
    refresh,
    changeQuantity,
    addOne,
    lineFor,
    needsVerification,
    clearVerificationBlock,
  };
}

// ---------------------------------------------------------------------------
// Per-row cell
// ---------------------------------------------------------------------------

/**
 * Does this row still need checking before it can be bought?
 *
 * Exported because the bar needs the same answer as the cell — the bar to
 * count and check them, the cell to say so — and two implementations of this
 * would eventually offer to check a row the cell showed as cleared.
 *
 * The conditions are the ones the BACKEND enforces on: the check must cover
 * this exact supplier product, have passed, and still be inside its window.
 */
export function rowNeedsCheck(
  row: ReadyToOrderRow,
  verification: RowVerification | undefined,
  cartLocked: boolean,
): boolean {
  if (!cartLocked) return false;

  const sku = row.detail.selected?.sku;
  if (!sku) return false;

  const covers =
    verification !== undefined &&
    verification.supplierSku.trim().toUpperCase() === sku.trim().toUpperCase() &&
    verification.supplier.trim().toLowerCase() ===
      row.bestSupplier.trim().toLowerCase();

  return !(covers && verification.passed && verification.fresh);
}

export function CartCell({
  row,
  cart,
  verification,
  cartLocked,
  isRecord,
  isVerifying,
}: {
  row: ReadyToOrderRow;
  cart: CartState;
  /** This line's standing check, if it has one. */
  verification?: RowVerification;
  /** Whether the job's prices are old enough for a check to be required. */
  cartLocked?: boolean;
  /**
   * The job is more than a day old and is kept as a record.
   *
   * Nothing on this row is actionable then — not adding, not checking. The
   * answer to wanting these products is a fresh upload, which re-reads every
   * price properly rather than re-checking a stale list one line at a time.
   */
  isRecord?: boolean;
  isVerifying?: boolean;
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

    // A JOB KEPT AS A RECORD OFFERS NOTHING TO CLICK.
    //
    // Past a day these prices are not worth re-checking one line at a time —
    // the answer is a fresh upload, which re-reads all of them properly. An
    // Add button here would either be refused or would buy on a figure nobody
    // has stood behind for four days.
    if (isRecord) {
      return (
        <span
          className="text-[11.5px] text-ink-faint"
          title="This job is more than a day old and is kept as a record. Upload the file again to order these products at current prices."
        >
          —
        </span>
      );
    }

    const covers =
      verification !== undefined &&
      verification.supplierSku.trim().toUpperCase() === sku.trim().toUpperCase() &&
      verification.supplier.trim().toLowerCase() === supplier.trim().toLowerCase();

    const needsCheck = rowNeedsCheck(row, verification, cartLocked === true);

    // NOT A BUTTON — a status.
    //
    // Checking one line at a time is the wrong unit of work: a retailer is
    // ordering a shopping list, not auditing a product, and a table of 200
    // rows each with its own ⟳ button asks them to click 200 times to reach
    // the thing they actually wanted. The single control on the bar above
    // checks everything that needs it in one go. This cell's job is only to
    // say why this row is not orderable yet, and what moved if anything did.
    if (needsCheck) {
      const why = !covers
        ? "These prices are more than three hours old and have not been re-checked."
        : verification.invalidatedAt
          ? (verification.invalidatedReason ?? "This line changed after it was checked.")
          : !verification.passed
            ? "The last check did not pass."
            : "The last check is more than three hours old.";

      return (
        <div className="flex flex-col items-start gap-0.5">
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-medium text-amber-700"
            title={`${why} Use “Check prices” above before ordering.`}
          >
            {isVerifying ? "⟳ Checking…" : "⏱ Needs check"}
          </span>

          {/* What the failed check found, on the row itself. Sending the
              retailer to a panel elsewhere to learn why one line is blocked
              is how a table of 200 rows becomes unusable. */}
          {covers && !verification.passed && verification.changes?.length ? (
            <span className="text-[10.5px] text-amber-700">
              {verification.changes
                .map(
                  (change) =>
                    `${change.field} ${String(change.previous ?? "—")} → ${String(change.next ?? "—")}`,
                )
                .join(" · ")}
            </span>
          ) : null}
        </div>
      );
    }

    const cleared = covers && verification.passed && verification.fresh;

    // THE BASKET HAS TO BE KNOWN BEFORE ANYTHING GOES IN IT.
    //
    // O'Reilly's session expires into a login page, not an error. The backend
    // refuses to read that as "the basket is empty" — the single most dangerous
    // wrong answer available, because empty invites re-adding everything — so
    // until a real basket comes back we do not know whether this product is
    // already in it. Adding anyway risks a duplicate line in a real order.
    const basketStatus = cart.status[supplier] ?? "loading";
    const basketReady = basketStatus === "ready";

    return (
      <div className="flex flex-col items-start gap-0.5">
        <button
          type="button"
          disabled={isBusy || cart.isLoading || !basketReady}
          onClick={() => void cart.addOne(supplier, sku, row.cases, row.product)}
          className="rounded-md border border-teal-600 px-2 py-1 text-[11.5px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40"
          title={
            basketReady
              ? `Add ${row.cases} × ${row.product} to the ${label(supplier)} basket`
              : basketStatus === "unavailable"
                ? `The ${label(supplier)} basket could not be read, so its contents are unknown. Adding now could duplicate a line you already have.`
                : `Connecting to ${label(supplier)}. The basket has to be read before anything can be added to it.`
          }
        >
          {isBusy
            ? "Adding…"
            : !basketReady
              ? basketStatus === "unavailable"
                ? "Unavailable"
                : "Connecting…"
              : `＋ Add${row.cases > 1 ? ` ${row.cases}` : ""}`}
        </button>

        {/* Shown only where it means something: on a job fresh enough not to
            need checking, a "checked" badge would imply the others are
            suspect when nothing here needs checking at all. */}
        {cleared && cartLocked ? (
          <span
            className="text-[10.5px] text-emerald-700"
            title={`Checked against ${label(supplier)} at ${new Date(
              verification.verifiedAt,
            ).toLocaleTimeString()}`}
          >
            ✓ checked{" "}
            {new Date(verification.verifiedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {verification.result === "price-decreased" && verification.priceExVat !== undefined
              ? ` · now ${eur(verification.priceExVat)}`
              : ""}
          </span>
        ) : null}
      </div>
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
  jobId,
  onVerify,
  isVerifying,
  verifyProgress,
  verifications,
  cartLocked,
  isRecord,
}: {
  rows: ReadyToOrderRow[];
  cart: CartState;
  /**
   * Which job these lines came from. Sent with every add so the backend's
   * price lock applies — without it an add from the results table is
   * indistinguishable from a manual one and the lock never fires.
   */
  jobId?: string;
  /** Re-check these rows. Provided by the page, which owns verification state. */
  onVerify?: (rows: number[]) => Promise<void>;
  isVerifying?: boolean;
  /** How far through a run of checks we are. Each row is a live supplier call. */
  verifyProgress?: { completed: number; total: number } | null;
  /** Standing checks, keyed by row number. */
  verifications?: Record<number, RowVerification>;
  /** The job is past three hours, so its lines need checking before ordering. */
  cartLocked?: boolean;
  /**
   * The job is more than a day old and is kept as a record.
   *
   * BOTH controls disappear. Neither is the right answer to a four-day-old
   * list: checking it re-prices products the retailer chose against a
   * catalogue that has moved on, and ordering it buys on figures nobody has
   * stood behind since. A fresh upload does the whole thing properly in the
   * time it takes to check a handful of lines here.
   */
  isRecord?: boolean;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<AddProductsResult | null>(null);
  const [validations, setValidations] = useState<Record<string, BasketValidation>>({});
  /**
   * Lines the backend refused pending a re-check.
   *
   * Held here rather than merged into `result` because they are not a failed
   * add — nothing was attempted. They need an action ("check them now"), and
   * listing them among failures would invite the retailer to retry an add that
   * will be refused identically.
   */
  const [blocked, setBlocked] = useState<
    { row: ReadyToOrderRow; entry: NeedsVerificationEntry }[]
  >([]);

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

  /**
   * Rows that are not orderable yet — the exact set the check button acts on.
   *
   * Drawn from `notInCart` rather than every ready row: re-pricing something
   * already sitting in a supplier basket changes nothing about the basket, and
   * counting it would have the button promise work it does not do.
   */
  const needingCheck = useMemo(
    () =>
      cartLocked
        ? notInCart.filter((row) =>
            rowNeedsCheck(row, verifications?.[row.row], true),
          )
        : [],
    [notInCart, verifications, cartLocked],
  );

  const isRunning = progress !== null;

  /** Row numbers this run must leave out. Recomputed per render, read in `run`. */
  const skipRows = useMemo(
    () => new Set(needingCheck.map((row) => row.row)),
    [needingCheck],
  );

  /**
   * Suppliers this run would touch whose basket we cannot currently read.
   *
   * "Add All" spans both baskets, so it waits for both — adding to O'Reilly
   * while Musgrave is still connecting would leave the buyer with a half-done
   * run and no clear record of which half.
   */
  const notReady = useMemo(
    () =>
      [...bySupplier.keys()].filter(
        (supplier) => (cart.status[supplier] ?? "loading") !== "ready",
      ),
    [bySupplier, cart.status],
  );

  /** What "Add All" will ACTUALLY put in a basket. */
  const addable = useMemo(
    () => notInCart.filter((row) => !skipRows.has(row.row)),
    [notInCart, skipRows],
  );

  /**
   * The estimate covers what will be added, not what is on screen.
   *
   * Totalling every not-in-cart row would quote a figure including products
   * the run is about to leave behind, and the confirmation dialog is the last
   * thing the buyer reads before spending money.
   */
  const estimatedExVat = useMemo(
    () => addable.reduce((sum, row) => sum + row.price * row.cases, 0),
    [addable],
  );

  const run = useCallback(async () => {
    setIsConfirming(false);
    setResult(null);
    setValidations({});
    setBlocked([]);
    setProgress({ completed: 0, total: addable.length });

    const merged: AddResult[] = [];
    const blockedRows: { row: ReadyToOrderRow; entry: NeedsVerificationEntry }[] = [];
    let completed = 0;

    // One call PER SUPPLIER. Each backend fans out to its own supplier and
    // reports per product, so the page never needs to know how many HTTP
    // requests that took — only which basket each row belongs in.
    for (const [supplier, supplierRows] of bySupplier) {
      const pending = supplierRows.filter(
        (row) =>
          !cart.lineFor(supplier, row.detail.selected!.sku!) &&
          // UNCHECKED ROWS ARE LEFT OUT, not sent and refused.
          //
          // The backend refuses an add ALL OR NOTHING per request: one stale
          // line in a batch of ten and none of the ten are added. Sending them
          // together would mean a job with five cleared lines and five stale
          // ones adds nothing at all, while the button promised five — which
          // reads as the button being broken rather than as a price check
          // being outstanding.
          !skipRows.has(row.row),
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
          jobId,
        );
        merged.push(...outcome.results);
      } catch (err) {
        // A refusal pending verification is reported per product, because it
        // IS per product: some of this supplier's lines may be checked and
        // current while others are not, and one sentence over the whole batch
        // would tell the retailer to re-check lines that are already fine.
        if (err instanceof VerificationRequiredError) {
          const bySku = new Map(
            err.needsVerification.map((entry) => [entry.sku, entry]),
          );
          blockedRows.push(
            ...pending
              .filter((row) => bySku.has(row.detail.selected!.sku!))
              .map((row) => ({
                row,
                entry: bySku.get(row.detail.selected!.sku!)!,
              })),
          );
        } else {
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
      }

      completed += pending.length;
      setProgress({ completed, total: addable.length });
    }

    await cart.refresh();

    setBlocked(blockedRows);

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
  }, [addable, skipRows, bySupplier, cart, jobId]);

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

        {/* PAST A DAY, NEITHER CONTROL APPEARS.

            The counts above stay — a buyer still wants to know what is in
            their baskets — but there is nothing to press. Both actions would
            be working from prices four days stale, and the honest answer is
            the one stated beside it: upload the file again. */}
        {isRecord ? (
          <span className="text-[12.5px] text-ink-soft">
            Kept as a record — upload the file again to order these products.
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {/* ONE CONTROL FOR THE WHOLE LIST, not one per row.

                A retailer is ordering a shopping list, not auditing a product.
                Per-row buttons made them click once per line to reach the
                thing they actually wanted, which on a 200-line file is not a
                workflow. Shown only when something genuinely needs checking —
                under three hours the count is zero and a button offering to
                check nothing is worse than no button. */}
            {needingCheck.length > 0 && onVerify && (
              <button
                type="button"
                disabled={isVerifying || isRunning}
                onClick={() => void onVerify(needingCheck.map((row) => row.row))}
                className="rounded-md border border-amber-500 bg-amber-50 px-3.5 py-2 text-[13px] font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                title={`Ask each supplier what these ${needingCheck.length} products cost right now`}
              >
                {isVerifying
                  ? // Each row is a live request to a trade account, so a
                    // 40-line check is genuinely slow. A spinner with no
                    // numbers on it reads as a hang.
                    `⟳ Checking prices… ${verifyProgress?.completed ?? 0} / ${
                      verifyProgress?.total ?? needingCheck.length
                    }`
                  : `⟳ Check prices (${needingCheck.length})`}
              </button>
            )}

            <button
              type="button"
              disabled={
                isRunning ||
                cart.isLoading ||
                isVerifying ||
                // A basket we could not read is a basket whose contents are
                // unknown, and this run decides what to add by comparing
                // against them. Running blind risks duplicating lines.
                notReady.length > 0 ||
                // Nothing this run could add — either everything is already in
                // a basket, or everything left is waiting on a price check.
                // Offering it in the second case would teach the retailer that
                // the button does not work.
                addable.length === 0
              }
              onClick={() => setIsConfirming(true)}
              className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                notReady.length > 0
                  ? `Waiting for ${notReady.map(label).join(" and ")}. A basket has to be read before anything can be added to it.`
                  : addable.length === 0 && needingCheck.length > 0
                    ? "Check these prices first — they are more than three hours old."
                    : undefined
              }
            >
              {isRunning
                ? `Adding products… ${progress.completed} / ${progress.total}`
                : notReady.length > 0
                  ? // Named, not "please wait". A buyer who knows it is
                    // O'Reilly can judge whether to keep waiting; "please
                    // wait" gives them nothing and no end to it.
                    `⏳ Connecting to ${notReady.map(label).join(" and ")}…`
                  : addable.length === 0
                    ? needingCheck.length > 0
                      ? `🛒 ${needingCheck.length} waiting on a price check`
                      : eligible.length > 0
                        ? "🛒 All ready items in cart"
                        : "🛒 Nothing to add"
                    : // The count is what will ACTUALLY go in. Saying "Add all
                      // (40)" when 12 are waiting on a check promises work the
                      // run will not do, and the summary afterwards would read
                      // as a failure rather than as 12 outstanding checks.
                      `🛒 Add All Ready Items to Cart (${addable.length})`}
            </button>
          </div>
        )}
      </div>

      {/* NOT an error panel, deliberately.

          Nothing went wrong and the retailer did nothing wrong: these prices
          are simply older than the system is willing to order from. Styled as
          a prompt with the action attached, because the whole point of
          per-product verification is that the answer is one click rather than
          re-uploading the file. */}
      {blocked.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <strong className="font-medium">
                {blocked.length} {blocked.length === 1 ? "product needs" : "products need"}{" "}
                checking before {blocked.length === 1 ? "it" : "they"} can be added
              </strong>
              <p className="mt-0.5 text-amber-800">
                These prices were read more than three hours ago. Checking asks each
                supplier what the product costs right now — the rest of the job is left
                alone.
              </p>
            </div>

            {onVerify && (
              <button
                type="button"
                disabled={isVerifying}
                onClick={() => void onVerify(blocked.map(({ row }) => row.row))}
                className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {isVerifying ? "Checking…" : `Check ${blocked.length} now`}
              </button>
            )}
          </div>

          <ul className="mt-2.5 space-y-1 border-t border-amber-200 pt-2">
            {blocked.map(({ row, entry }) => (
              <li key={`${row.row}-${entry.sku}`} className="flex flex-wrap gap-x-2">
                <span className="text-amber-700 tabular-nums">Row {row.row}</span>
                <span className="font-medium">{row.product}</span>
                <span className="text-amber-700">— {entry.reason}</span>
                {/* What actually moved, when a check already ran and found it.
                    "The price changed" invites a shrug; "€15.39 → €16.20" is a
                    decision the retailer can take. */}
                {entry.changes?.map((change) => (
                  <span key={change.field} className="text-amber-800">
                    {change.field}: {String(change.previous ?? "—")} →{" "}
                    {String(change.next ?? "—")}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A RECONNECT IN PROGRESS IS NOT AN ERROR.

          O'Reilly's session expires into a login page, and the backend logs in
          again and retries on its own. While that is happening the buyer is
          told what is happening and that it is being handled — not shown a red
          box about a problem they cannot fix on a page that is already fixing
          itself. The red box below is for when the retries have run out. */}
      {SUPPLIERS.filter((supplier) => cart.status[supplier] === "reconnecting").map(
        (supplier) => (
          <div
            key={supplier}
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900"
          >
            <strong className="font-medium">{label(supplier)}</strong>: the session
            expired and is being reconnected. Add to Cart is paused for this supplier
            until the basket can be read — adding to a basket we cannot see risks
            ordering something twice.
          </div>
        ),
      )}

      {/* Reported per supplier and named, so "the cart is broken" is never the
          takeaway when only one of two is. */}
      {SUPPLIERS.filter((supplier) => cart.errors[supplier]).map((supplier) => (
        <div
          key={supplier}
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-700"
        >
          <strong className="font-medium">{label(supplier)}</strong>:{" "}
          {cart.errors[supplier]}
          {/* Retries are exhausted, so nothing further happens on its own.
              A way to try again beats telling the buyer to reload the page. */}
          <button
            type="button"
            onClick={() => void cart.refresh(supplier)}
            className="ml-2 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      ))}

      {isConfirming && (
        <ConfirmModal
          bySupplier={bySupplier}
          cart={cart}
          // What the run will do, not what is on screen. This dialog is the
          // last thing read before money is spent, so its count and its total
          // must both exclude the lines waiting on a price check.
          count={addable.length}
          exVat={estimatedExVat}
          skipRows={skipRows}
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
  skipRows,
  onCancel,
  onConfirm,
}: {
  bySupplier: Map<CartSupplier, ReadyToOrderRow[]>;
  cart: CartState;
  count: number;
  exVat: number;
  /** Rows the run will leave behind, waiting on a price check. */
  skipRows: Set<number>;
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
            // The same filter `run` applies, for the same reason: a per-supplier
            // count that included lines waiting on a price check would not add
            // up to the total below it.
            const pending = supplierRows.filter(
              (row) =>
                !cart.lineFor(supplier, row.detail.selected!.sku!) &&
                !skipRows.has(row.row),
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
