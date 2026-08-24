"use client";

/**
 * The supplier baskets, and the only place lines are taken back out of them.
 *
 * This used to sit at the bottom of /jobs/[jobId], underneath a two-hundred-row
 * comparison table. That page answers "what should I buy and from whom"; this
 * one answers "what is actually sitting in each basket right now" — a different
 * question, asked at a different moment, and it was unfindable below all that
 * data.
 *
 * Each basket is shown WHOLE, split into the lines a job put there and the ones
 * that were already in it. The second group is the reason this page exists: it
 * will be ordered too, and until now nothing in the app admitted it was there.
 *
 * Removal is job-scoped, always. There is no clear-basket action here or
 * anywhere else — a basket holds work this app never did, and the suppliers
 * offer no undo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AppShell from "@/components/AppShell";
import { useCart } from "@/components/Cart";
import { SupplierBaskets, SupplierBasketSkeleton } from "@/components/SupplierBaskets";
import { getJobRows, listJobs } from "@/lib/api/jobs";
import type { JobSummary, ReadyToOrderRow } from "@/lib/api/jobs";
import type { CartSupplier } from "@/lib/api/cart";

export default function BasketsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rows, setRows] = useState<ReadyToOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Two separate loads, tracked separately. Collapsing them into one flag is
  // what made the empty state flash: the job list arrives first, and for the
  // moment before its ROWS arrive there are no suppliers yet — which is
  // indistinguishable from a job that selected none.
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);

  const cart = useCart(jobId ?? undefined);

  // The most recent job is the one whose lines are in the baskets, so it is the
  // default. Older jobs stay selectable: a basket can hold more than one.
  useEffect(() => {
    void (async () => {
      try {
        const history = await listJobs();
        setJobs(history);
        setJobId((current) => current ?? history[0]?.jobId ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load your jobs");
      } finally {
        setLoadingJobs(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoadingRows(true);
    // Cleared immediately, so switching jobs shows a skeleton rather than the
    // previous job's baskets under the new job's name.
    setRows([]);
    void (async () => {
      try {
        const loaded = await getJobRows(jobId);
        if (cancelled) return;
        setRows(loaded.readyToOrder ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load that job");
      } finally {
        if (!cancelled) setLoadingRows(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  /**
   * The SKUs this job selected, grouped by the EXACT basket they belong to.
   *
   * Keyed by the precise supplier id — `barrygroup-ambient`, never the
   * collapsed `barrygroup` the price columns use. Ambient and chill are two
   * orders with two delivery dates; a removal aimed at "barrygroup" has no
   * basket to act on.
   */
  const jobSkusBySupplier = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      const selected = row.detail?.selected;
      if (!selected?.sku || !selected.supplier) continue;
      (map[selected.supplier] ??= []).push(selected.sku);
    }
    return map;
  }, [rows]);

  const suppliers = useMemo(
    () => Object.keys(jobSkusBySupplier) as CartSupplier[],
    [jobSkusBySupplier],
  );

  /**
   * Has any basket actually arrived yet?
   *
   * `cart.isLoading` also goes true on every REFRESH — after a removal, for
   * instance — and swapping the panels for skeletons then would throw away the
   * report the retailer is reading. So the skeleton is for the first load only.
   */
  const anyBasketLoaded = suppliers.some((supplier) => cart.baskets[supplier] != null);

  const showSkeleton =
    loadingJobs || loadingRows || (suppliers.length > 0 && !anyBasketLoaded && cart.isLoading);

  const refresh = useCallback(() => cart.refresh(), [cart]);

  return (
    <AppShell active="Baskets">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Baskets</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            What each supplier is holding right now — including anything this app
            did not put there.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* A refresh AFTER the first load: the panels stay, because the
              retailer may be reading a removal report on one of them. */}
          {!showSkeleton && cart.isLoading && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
              Refreshing
            </span>
          )}

        {jobs.length > 0 && (
          <label className="text-[12.5px] text-ink-soft">
            Job{" "}
            <select
              value={jobId ?? ""}
              onChange={(event) => setJobId(event.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink"
            >
              {jobs.map((job) => (
                <option key={job.jobId} value={job.jobId}>
                  {job.fileName} · {new Date(job.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
        )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700"
        >
          {error}
        </div>
      )}

      <div className="mt-6">
        {showSkeleton ? (
          <>
            {/* The bars are decoration; this is what a screen reader hears. */}
            <p role="status" className="sr-only">
              Loading your supplier baskets
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <SupplierBasketSkeleton />
              <SupplierBasketSkeleton />
            </div>
          </>
        ) : suppliers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface py-16 text-center">
            <p className="text-[13.5px] font-medium text-ink">Nothing to show yet</p>
            <p className="max-w-sm text-[12.5px] text-ink-soft">
              Once a comparison has picked suppliers for a job, its baskets appear
              here.
            </p>
            <Link
              href="/orders"
              className="mt-2 rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas"
            >
              Build an order list
            </Link>
          </div>
        ) : (
          <SupplierBaskets
            jobId={jobId!}
            suppliers={suppliers}
            baskets={cart.baskets}
            jobSkusBySupplier={jobSkusBySupplier}
            onRefresh={refresh}
          />
        )}
      </div>
    </AppShell>
  );
}
