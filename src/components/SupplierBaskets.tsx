"use client";

/**
 * What each supplier basket ACTUALLY holds, and how to take this job back out.
 *
 * The price table only ever showed lines it recognised, which is why a Kadona
 * basket of 79 could report "71 ready" and look wrong with nothing to click.
 * This panel shows the live basket whole, split in two:
 *
 *   THIS JOB          lines the current upload put there
 *   OTHER LINES       everything else — stock added at the supplier's own site,
 *                     leftovers from an earlier upload, hand-added products
 *
 * The split matters before an order is submitted: those other lines will be
 * bought too, and until now they were invisible.
 *
 * ONE PANEL PER BASKET, NEVER PER VENDOR. Barry Group Ambient and Barry Group
 * Chill are separate orders with separate delivery dates, so they get separate
 * panels keyed by their exact supplier ids. The collapsed "barrygroup" used in
 * the price comparison is a display label; it is not a basket and cannot be
 * ordered from.
 *
 * There is deliberately NO "clear basket" control. Removal is always scoped to
 * one job, because a basket holds work this app never did and the supplier
 * offers no undo.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  removeJobLines,
  removalStatus,
  cartSupplierLabel as label,
  type CartSupplier,
  type RemovalRun,
  type SupplierBasket,
  type BasketLineItem,
} from "@/lib/api/cart";

// ---------------------------------------------------------------------------
// Pure logic — exported so it can be tested without a browser
// ---------------------------------------------------------------------------

const key = (sku: string): string => sku.trim().toUpperCase();

export interface BasketPartition {
  /** Lines this job put in the basket. */
  jobLines: BasketLineItem[];
  /** Lines that were already there, or came from somewhere else. */
  otherLines: BasketLineItem[];
}

/**
 * Split a live basket by whether the current job owns each line.
 *
 * Driven by the job's SKUs rather than by an activity log: the log says what
 * happened, the basket says what IS, and a buyer deciding whether to submit an
 * order needs the second one. A line the buyer removed by hand is simply absent
 * here, which is correct.
 */
export function partitionBasket(
  basket: SupplierBasket | undefined,
  jobSkus: readonly string[],
): BasketPartition {
  const mine = new Set(jobSkus.map(key));
  const lines = basket?.lineItems ?? [];

  return {
    jobLines: lines.filter((line) => mine.has(key(line.sku))),
    otherLines: lines.filter((line) => !mine.has(key(line.sku))),
  };
}

export interface PollOptions {
  intervalMs?: number;
  /** A ceiling, so a stuck run cannot poll for ever. */
  maxAttempts?: number;
  onProgress?: (run: RemovalRun) => void;
  /** Injected in tests; real callers get setTimeout. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a removal until it stops running.
 *
 * Separated from the component because it is the part with the interesting
 * behaviour and the part worth testing: a component test would have to fight
 * timers to assert what this asserts directly.
 *
 * A failed poll is NOT a failed removal. The work continues on the server, so a
 * dropped request is retried rather than reported as an error — the mistake
 * that would otherwise tell a buyer nothing was removed while the basket was
 * being emptied behind them.
 */
export async function pollRemoval(
  fetchStatus: () => Promise<RemovalRun>,
  options: PollOptions = {},
): Promise<RemovalRun> {
  const { intervalMs = 1500, maxAttempts = 800, onProgress } = options;
  const wait = options.wait ?? sleep;

  let last: RemovalRun | undefined;
  let consecutiveErrors = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const run = await fetchStatus();
      consecutiveErrors = 0;
      last = run;
      onProgress?.(run);
      if (run.status !== "running") return run;
    } catch (error) {
      // Three in a row means the server is gone, not that one request lost a
      // race. Below that, keep asking.
      if (++consecutiveErrors >= 3) throw error;
    }
    await wait(intervalMs);
  }

  if (last) return last;
  throw new Error("The removal did not report a result in time.");
}

/** One line of plain English for a finished run. */
export function summariseRemoval(run: RemovalRun): string {
  const { removed, failed, kept, notInBasket } = run.report;
  const parts = [`${removed.length} removed`];
  if (failed.length > 0) parts.push(`${failed.length} could not be removed`);
  if (notInBasket.length > 0) parts.push(`${notInBasket.length} already gone`);
  // Always stated when there are any, even on a clean run: "we left your other
  // stock alone" is the reassurance the whole feature is built around.
  if (kept.length > 0) parts.push(`${kept.length} other line${kept.length === 1 ? "" : "s"} left untouched`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The line grid
// ---------------------------------------------------------------------------

/** Money, or an em dash where the supplier did not give a figure. */
function money(value: number | undefined, currency = "EUR"): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(value);
}

/**
 * One group of basket lines, as an aligned grid.
 *
 * A table rather than a list of flex rows, because these are four facts about
 * each line — product, code, quantity, line total — and a buyer checking a
 * basket reads DOWN a column: is that quantity right, does that total look
 * wrong. Ragged rows make that scan impossible.
 *
 * The same grid template serves both groups, so this job's lines and the ones
 * that were already there line up with each other rather than forming two
 * tables that happen to sit above one another.
 */
function LineGrid({
  lines,
  currency,
  tone,
}: {
  lines: BasketLineItem[];
  currency: string;
  /** `other` is the amber treatment for lines this job does not own. */
  tone: "job" | "other";
}) {
  const muted = tone === "other" ? "text-amber-900/70" : "text-ink-faint";
  const body = tone === "other" ? "text-amber-900" : "text-ink";
  // Written out rather than derived from the divide class by string surgery:
  // Tailwind scans source text for class names, so a name that only exists
  // after a `.replace()` at runtime is never generated into the stylesheet.
  const divide = tone === "other" ? "divide-amber-200/70" : "divide-line";
  const border = tone === "other" ? "border-amber-200/70" : "border-line";

  return (
    <div className={`mt-2 divide-y border-y ${divide} ${border}`}>
      {/* Column headings, so the numbers on the right are not a guess. */}
      <div
        className={`grid grid-cols-[1fr_5.5rem_3rem_5rem] gap-2 py-1.5 text-[10.5px] font-medium uppercase tracking-wide ${muted}`}
      >
        <span>Product</span>
        <span>Code</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
      </div>

      {lines.map((line) => (
        <div
          key={line.basketItemId}
          className={`grid grid-cols-[1fr_5.5rem_3rem_5rem] items-baseline gap-2 py-1.5 text-[12.5px] ${body}`}
        >
          <span className="truncate" title={line.name ?? line.sku}>
            {line.name ?? line.sku}
          </span>
          <span className={`truncate tabular-nums ${muted}`}>{line.sku}</span>
          {/* Right-aligned and tabular so a column of quantities reads as a
              column of numbers rather than a ragged edge. */}
          <span className="text-right tabular-nums">{line.quantity}</span>
          <span className="text-right tabular-nums">{money(line.totalPrice, currency)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function SupplierBasketPanel({
  supplier,
  jobId,
  basket,
  jobSkus,
  onRefresh,
}: {
  /** The EXACT basket id — barrygroup-ambient, never barrygroup. */
  supplier: CartSupplier;
  jobId: string;
  basket: SupplierBasket | undefined;
  jobSkus: readonly string[];
  onRefresh: () => Promise<void> | void;
}) {
  const [run, setRun] = useState<RemovalRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const { jobLines, otherLines } = partitionBasket(basket, jobSkus);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      const started = await removeJobLines(supplier, jobId);
      const finished = await pollRemoval(
        () => removalStatus(supplier, started.removalId),
        { onProgress: (progress) => !cancelled.current && setRun(progress) },
      );
      if (!cancelled.current) setRun(finished);
      // The basket is re-read from the supplier rather than patched locally:
      // the run's own report is a claim, and the basket is the fact.
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove these lines");
    } finally {
      setBusy(false);
    }
  }, [supplier, jobId, onRefresh]);

  const total = basket?.lineItems.length ?? 0;
  const currency = basket?.totals.currency ?? "EUR";

  return (
    <section
      data-testid={`basket-panel-${supplier}`}
      className="rounded-xl border border-line bg-surface p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">{label(supplier)}</h3>
        <span className="text-[12px] text-ink-faint tabular-nums">
          {total} line{total === 1 ? "" : "s"}
          {basket?.totals.netTotal !== undefined
            ? ` · ${money(basket.totals.netTotal, currency)} ex-VAT`
            : ""}
        </span>
      </header>

      {/* ---- This job ----------------------------------------------------- */}
      <div className="mt-3">
        <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-faint">
          This job · {jobLines.length}
        </p>
        {jobLines.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-soft">
            None of this job&apos;s lines are in this basket.
          </p>
        ) : (
          <LineGrid lines={jobLines} currency={currency} tone="job" />
        )}
      </div>

      {/* ---- Everything else ----------------------------------------------
          Shown in full, with SKU and quantity. These will be bought too if the
          order is submitted, and until now nothing in this app admitted they
          existed. */}
      {otherLines.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-[11.5px] font-medium uppercase tracking-wide text-amber-800">
            Other existing lines · {otherLines.length}
          </p>
          <p className="mt-0.5 text-[11.5px] text-amber-900/80">
            Not from this order file. They will be ordered too unless you remove
            them at {label(supplier)}.
          </p>
          <LineGrid lines={otherLines} currency={currency} tone="other" />
        </div>
      )}

      {/* ---- Remove -------------------------------------------------------- */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy || jobLines.length === 0}
          className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? run
              ? `Removing… ${run.progress.completed}/${run.progress.total}`
              : "Starting…"
            : "Remove this job's lines"}
        </button>
        <span className="text-[11.5px] text-ink-faint">
          {otherLines.length > 0
            ? `Removes only this job's ${jobLines.length}. The other ${otherLines.length} stay.`
            : "Removes only the lines this order file added."}
        </span>
      </div>

      {error && (
        <p className="mt-2 text-[12px] text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* ---- The report ---------------------------------------------------- */}
      {run && run.status !== "running" && (
        <div
          data-testid={`removal-report-${supplier}`}
          className={`mt-3 rounded-lg border p-3 text-[12.5px] ${
            run.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : run.status === "partial"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <p className="font-medium">{summariseRemoval(run)}</p>

          {run.report.failed.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {run.report.failed.map((line) => (
                <li key={line.sku}>
                  Could not remove {line.name ?? line.sku} ({line.sku})
                  {line.error ? ` — ${line.error}` : ""}
                </li>
              ))}
            </ul>
          )}

          {run.report.notInBasket.length > 0 && (
            <p className="mt-1.5">
              Already gone from the basket: {run.report.notInBasket.join(", ")}
            </p>
          )}

          {/* Stated explicitly, not implied by their absence from the removed
              list. "We did not touch your other stock" is the promise this
              feature makes, and a promise kept silently is not reassuring. */}
          {run.report.kept.length > 0 && (
            <p className="mt-1.5">
              Left untouched: {run.report.kept.length} line
              {run.report.kept.length === 1 ? "" : "s"} that did not come from
              this order file.
            </p>
          )}

          {run.report.reconciliation && !run.report.reconciliation.agrees && (
            <p className="mt-1.5 font-medium">
              The basket does not match what was expected — re-read it at{" "}
              {label(supplier)} before ordering.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The shape of a panel before its data lands.
 *
 * Mirrors the real panel's layout — header, a few lines, the action bar — so
 * the page does not reflow when the basket arrives. A spinner in the middle of
 * an empty area would move everything the moment it was replaced.
 *
 * `aria-hidden` with a live status alongside it: the bars are decoration, and a
 * screen reader should hear "loading", not eleven empty list items.
 */
export function SupplierBasketSkeleton() {
  return (
    <section
      data-testid="basket-panel-skeleton"
      aria-hidden="true"
      className="animate-pulse rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="h-3.5 w-32 rounded bg-canvas" />
        <div className="h-3 w-20 rounded bg-canvas" />
      </div>

      <div className="mt-4 h-2.5 w-24 rounded bg-canvas" />
      <div className="mt-2 space-y-2">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex justify-between gap-3">
            <div className="h-3 flex-1 rounded bg-canvas" />
            <div className="h-3 w-8 rounded bg-canvas" />
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-line pt-3">
        <div className="h-7 w-40 rounded-md bg-canvas" />
        <div className="h-3 w-28 rounded bg-canvas" />
      </div>
    </section>
  );
}

/**
 * Every basket this job touches, one panel each.
 *
 * Keyed by the exact supplier id, so Barry's two baskets render as two panels
 * rather than one merged "Barry Group" that could not be ordered from.
 */
export function SupplierBaskets({
  jobId,
  suppliers,
  baskets,
  jobSkusBySupplier,
  onRefresh,
}: {
  jobId: string;
  suppliers: readonly CartSupplier[];
  baskets: Partial<Record<CartSupplier, SupplierBasket | undefined>>;
  jobSkusBySupplier: Partial<Record<CartSupplier, string[]>>;
  onRefresh: () => Promise<void> | void;
}) {
  if (suppliers.length === 0) return null;

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2">
      {suppliers.map((supplier) => (
        <SupplierBasketPanel
          key={supplier}
          supplier={supplier}
          jobId={jobId}
          basket={baskets[supplier]}
          jobSkus={jobSkusBySupplier[supplier] ?? []}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}
