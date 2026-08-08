"use client";

/**
 * Job details — one past run, reopened.
 *
 * Reads the stored rows rather than reprocessing anything: a completed job is a
 * record, not a computation. The same two tables the dashboard shows, so a
 * retailer coming back tomorrow sees exactly what they saw during the run.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { CartBar, CartCell, useCart } from "@/components/Cart";
import { SupplierPriceCell, supplierColumns } from "@/components/SupplierPrices";
import { ProcessingBanner, TableSkeleton } from "@/components/TableSkeleton";
import {
  clockOf,
  downloadReport,
  eur,
  getJobRows,
  settledAsReadyRow,
  type JobRowOverride,
  type JobSummary,
  type NeedsAttentionRow,
  type ReadyToOrderRow,
} from "@/lib/api/jobs";
import { supplierLabel } from "@/lib/api/cart";
import ProductImage from "@/components/ProductImage";

type Tab = "ready" | "attention";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="mt-0.5 text-[16px] font-semibold tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}

export default function JobDetailsPage({
  params,
}: {
  params: { jobId: string };
}) {
  const { jobId } = params;

  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [ready, setReady] = useState<ReadyToOrderRow[]>([]);
  const [attention, setAttention] = useState<NeedsAttentionRow[]>([]);
  const [tab, setTab] = useState<Tab>("ready");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [overrides, setOverrides] = useState<Record<number, JobRowOverride>>({});

  // Synced from the SUPPLIER on mount, so a row shows "In Cart" because
  // Musgrave says so — not because this page remembers adding it.
  const cart = useCart();

  // From ALL ready rows, not the filtered view — columns must not appear and
  // disappear as somebody types in the search box.
  const priceColumns = useMemo(() => supplierColumns(ready), [ready]);

  const load = useCallback(async () => {
    try {
      const data = await getJobRows(jobId);
      setSummary(data.summary);
      setReady(data.readyToOrder ?? []);
      setAttention(data.needsAttention ?? []);
      setOverrides(data.overrides ?? {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this job");
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The lines still genuinely waiting on somebody.
   *
   * An admin settling a line records a decision against it; it does not rewrite
   * the row, because the pipeline's own verdict has to stay inspectable. So the
   * merge happens here — otherwise a line that was sorted out days ago keeps
   * presenting itself as outstanding work every time this page is opened.
   */
  const outstanding = useMemo(
    () => attention.filter((row) => overrides[row.row] === undefined),
    [attention, overrides],
  );

  const visibleAttention = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return outstanding;
    return outstanding.filter(
      (row) =>
        row.product.toLowerCase().includes(needle) ||
        row.status.toLowerCase().includes(needle),
    );
  }, [outstanding, query]);

  /** Attention lines an admin confirmed — shown as settled, with what they chose. */
  const adminSettled = useMemo(
    () =>
      attention
        .map((row) => ({ row, override: overrides[row.row] }))
        .filter(
          (entry): entry is { row: NeedsAttentionRow; override: JobRowOverride } =>
            entry.override?.action === "confirmed",
        ),
    [attention, overrides],
  );

  /**
   * Ready to order = what the pipeline matched, PLUS what an admin settled.
   *
   * An admin confirming a line has already made the decision the retailer would
   * otherwise make, so those lines belong in the orderable table rather than in
   * a panel of their own. Kept separate, every settled product would need its
   * own click to reach a basket — the more work an admin did, the more clicks
   * the retailer inherited. Here they are swept up by "Add All" like any other
   * ready line.
   */
  const orderable = useMemo(() => {
    const promoted = adminSettled
      .map(({ row, override }) =>
        settledAsReadyRow(row, override, supplierLabel(override.supplier ?? "")),
      )
      .filter((row): row is ReadyToOrderRow => row !== null);

    return [...ready, ...promoted].sort((a, b) => a.row - b.row);
  }, [ready, adminSettled]);

  const visibleReady = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orderable;
    return orderable.filter(
      (row) =>
        row.product.toLowerCase().includes(needle) ||
        row.bestSupplierName.toLowerCase().includes(needle),
    );
  }, [orderable, query]);

  const totalSavings = useMemo(
    () => ready.reduce((sum, row) => sum + (row.savings ?? 0) * row.cases, 0),
    [ready],
  );

  const duration = useMemo(() => {
    if (!summary?.startedAt || !summary.completedAt) return "—";
    const ms =
      new Date(summary.completedAt).getTime() -
      new Date(summary.startedAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const seconds = Math.round(ms / 1000);
    return seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }, [summary]);

  return (
    <AppShell active="Dashboard">
      <div className="mb-4">
        <Link
          href="/jobs"
          className="text-[12.5px] text-ink-soft hover:text-ink"
        >
          ← Job history
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        // A skeleton of the real table rather than the word "Loading", so the
        // shape of what is coming is visible before the data arrives.
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <TableSkeleton rows={8} columns={7} />
        </div>
      ) : !summary ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center text-[13px] text-ink-soft">
          This job could not be found.
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">
                {summary.fileName}
              </h1>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                {summary.storeName ? `${summary.storeName} · ` : ""}
                Job {summary.jobId.slice(0, 8)} · {summary.status}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void downloadReport(summary.jobId, summary.fileName);
              }}
              className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700"
            >
              Download report
            </button>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Products" value={String(summary.totalProducts)} />
            <Stat label="Matched" value={String(summary.readyProducts)} />
            <Stat
              label="Needs attention"
              value={String(summary.needsAttentionProducts)}
            />
            <Stat label="Est. saving" value={eur(totalSavings)} />
            <Stat label="Started" value={clockOf(summary.startedAt)} />
            <Stat label="Duration" value={duration} />
          </div>

          {summary.error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {summary.error}
            </div>
          )}

          {/* Lines somebody settled for this retailer.
              They are removed from Needs attention above, so without this they
              would simply vanish — and "my problem row disappeared" is a worse
              outcome than it never having been fixed. This says who fixed it
              and what they chose. */}
          {adminSettled.length > 0 && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-[12px] font-medium text-emerald-900">
                {adminSettled.length} line
                {adminSettled.length === 1 ? " was" : "s were"} settled for you —
                now in Ready to order
              </div>
              <ul className="mt-2 space-y-1">
                {adminSettled.map(({ row, override }) => (
                  <li key={row.row} className="text-[12.5px] text-emerald-900">
                    <span className="tabular-nums text-emerald-700">
                      Row {row.row}
                    </span>{" "}
                    · {row.product} →{" "}
                    <strong className="font-medium">
                      {override.supplierProduct ?? override.supplierSku}
                    </strong>
                    {override.supplier && ` (${override.supplier}`}
                    {override.supplier && override.supplierSku
                      ? ` ${override.supplierSku})`
                      : override.supplier && ")"}
                    {override.priceExVat !== undefined &&
                      ` · ${eur(override.priceExVat)}`}
                    {override.createdByEmail && (
                      <span className="text-emerald-700">
                        {" "}
                        · by {override.createdByEmail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
              {(
                [
                  ["ready", "Ready to order", orderable.length],
                  ["attention", "Needs attention", outstanding.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                    tab === key
                      ? "bg-teal-50 text-link"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {label}
                  <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products…"
              className="w-56 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-faint"
            />
          </div>

          {/* Still processing: say so, with counts, rather than showing a
              partial table that looks finished. */}
          {(summary.status === "running" || summary.status === "queued") && (
            <ProcessingBanner
              processed={summary.processedProducts}
              total={summary.totalProducts}
            />
          )}

          {tab === "ready" && <CartBar rows={orderable} cart={cart} />}

          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="overflow-x-auto">
              {tab === "ready" ? (
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead className="border-b border-line bg-canvas text-[12px] text-ink-soft">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Product</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Selected product
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Supplier</th>
                      {/* One column per supplier; the winner's cell is green. */}
                      {priceColumns.map((column) => (
                        <th
                          key={column.id}
                          className="px-3 py-2 text-right font-medium"
                        >
                          {column.name}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">Savings</th>
                      <th className="px-3 py-2 text-left font-medium">Cart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleReady.map((row) => (
                      <tr
                        key={row.row}
                        className="border-b border-line last:border-0 hover:bg-canvas/60"
                      >
                        <td className="px-3 py-2 tabular-nums text-ink-faint">
                          {row.row}
                        </td>
                        <td className="px-3 py-2 text-ink">{row.product}</td>
                        <td className="px-3 py-2 text-ink-soft">
                          {/* The supplier's own picture of what will actually be
                              ordered, beside the product it belongs to. */}
                          <div className="flex items-start gap-2">
                            <ProductImage
                              {...(row.detail.selected?.imageUrl
                                ? { src: row.detail.selected.imageUrl }
                                : {})}
                              alt={row.detail.selected?.product ?? row.product}
                              size={36}
                            />
                            <div className="min-w-0">
                              {row.detail.selected?.product ?? "—"}
                              {row.detail.selected?.sku && (
                                <span className="ml-1 text-[11.5px] text-ink-faint">
                                  SKU {row.detail.selected.sku}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-ink-soft">
                          {row.bestSupplierName}
                        </td>
                        {priceColumns.map((column) => (
                          <SupplierPriceCell
                            key={column.id}
                            row={row}
                            supplierId={column.id}
                          />
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.savingsStatus === "saving" &&
                          row.savings !== undefined ? (
                            <span className="text-emerald-600">
                              +{eur(row.savings)}
                            </span>
                          ) : row.savingsStatus === "no-saving" ? (
                            <span className="text-ink-soft">No saving</span>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <CartCell row={row} cart={cart} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead className="border-b border-line bg-canvas text-[12px] text-ink-soft">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Requested product
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-left font-medium">Reason</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Suggestion
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAttention.map((row) => (
                      <tr
                        key={row.row}
                        className="border-b border-line align-top last:border-0 hover:bg-canvas/60"
                      >
                        <td className="px-3 py-2 tabular-nums text-ink-faint">
                          {row.row}
                        </td>
                        <td className="px-3 py-2 text-ink">{row.product}</td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-medium text-amber-700">
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-soft">{row.reason}</td>
                        <td className="px-3 py-2 text-ink-soft">
                          {row.suggestion}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {(tab === "ready" ? visibleReady : visibleAttention).length === 0 && (
              <div className="px-4 py-10 text-center text-[13px] text-ink-soft">
                {query ? "No products match this search." : "Nothing here."}
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
