"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ProductGlyph from "@/components/ProductGlyph";
import PreferenceBand from "@/components/PreferenceBand";
import { LineStatusBadge } from "@/components/Badges";
import { suppliers, supplierById, eur } from "@/lib/mock-data";
import { searchCompare } from "@/lib/api/endpoint";
import { ApiError } from "@/lib/api/client";
import { cheapestSupplierId, supplierLabel } from "@/lib/compare-utils";
import type { CompareRow } from "@/lib/api/types";

const DEBOUNCE_MS = 350;

// Assumption: your "default" / previously-used supplier for a diverted-vs-main
// comparison. Swap this for whatever field your backend actually marks as
// the primary supplier (e.g. allocation.mainSupplierId) once it's available.
const MAIN_SUPPLIER_ID = "musgrave";

type Status = "flagged" | "needs-match" | "diverted" | undefined;

function deriveStatus(row: CompareRow, winnerId: string | undefined): Status {
  if (Object.keys(row.suppliers).length === 0) return "needs-match";
  if (Object.values(row.suppliers).some((o) => o?.flagged)) return "flagged";
  if (winnerId && winnerId !== MAIN_SUPPLIER_ID) return "diverted";
  return undefined;
}

export default function ComparePage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      abortRef.current?.abort();
      setRows([]);
      setStatus("idle");
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("loading");
      setErrorMessage("");

      try {
        const data = await searchCompare(trimmed, controller.signal);
        setRows(data.rows ?? []);
        setStatus("done");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setErrorMessage(
          err instanceof ApiError
            ? err.status === 0
            ? `Request failed (${err.status}): ${err.message}`
              : "Couldn't reach the comparison backend. Is it running on localhost:8787?"
            : "Something went wrong while searching."
        );
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Supplier columns for the desktop table: union of every supplier id seen
  // across the current result set, so the table adapts to whatever the
  // backend returns rather than a hardcoded list.
  const supplierColumns = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r) => Object.keys(r.suppliers).forEach((id) => ids.add(id)));
    // Keep known suppliers (from mock-data) in their usual order first, then
    // append any unfamiliar ones the backend returns.
    const known = suppliers.map((s) => s.id).filter((id) => ids.has(id));
    const unknown = Array.from(ids).filter((id) => !known.includes(id));
    return [...known, ...unknown];
  }, [rows]);

  const firstRow = rows[0];
  const firstRowWinner = firstRow ? cheapestSupplierId(firstRow.suppliers) : undefined;
  const firstRowChosen = firstRow?.allocation.supplierId ?? firstRowWinner;

  return (
    <AppShell active="Dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Compare this week's list</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {status === "done"
              ? `${rows.length} result${rows.length === 1 ? "" : "s"} for "${query}" · prices ex-VAT`
              : "Search a product to compare live supplier prices, ex-VAT"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center rounded-md border border-line bg-surface p-0.5 text-[12.5px] sm:flex">
            <span className="rounded px-2.5 py-1 font-medium text-ink bg-canvas">Table</span>
            <span className="rounded px-2.5 py-1 text-ink-soft">Cards</span>
          </div>
          <button className="rounded-md bg-teal-500 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-600">
            Refresh prices
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="mt-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products, e.g. coke, milk, kettle chips…"
          className="w-full max-w-md rounded-md border border-line bg-surface px-3.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        {status === "loading" && <span className="ml-3 text-[12.5px] text-ink-soft">Searching…</span>}
      </div>

      {status === "error" && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-600">{errorMessage}</p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Filters — sidebar on desktop */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-xl border border-line bg-surface p-4">
            <FilterGroup title="Supplier">
              {suppliers.map((s, i) => (
                <FilterCheck key={s.id} label={s.short} defaultChecked={i < 4} swatch={s.color} />
              ))}
            </FilterGroup>
            <FilterGroup title="Status">
              <FilterCheck label="Best deal" defaultChecked />
              <FilterCheck label="Main supplier" defaultChecked />
              {/* <FilterCheck label="Outlier flagged" defaultChecked />
              <FilterCheck label="Needs match" defaultChecked /> */}
            </FilterGroup>
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">In stock only</p>
              <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
                <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-teal-500">
                  <span className="ml-4 h-4 w-4 rounded-full bg-surface shadow" />
                </span>
                {/* Hide unavailable lines */}
                <span className="text-[12.5px] text-ink-soft">Arriving soon*</span>
              </label>
            </div>
          </div>
        </aside>

        {/* Filter chips — mobile */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin lg:hidden">
          {["All suppliers", "In stock only", "Free delivery"].map((c) => (
            <span key={c} className="whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft">
              {c}
            </span>
          ))}
        </div>

        {/* Results */}
        <div>
          {status === "idle" && (
            <div className="rounded-xl border border-line bg-surface p-8 text-center">
              <p className="text-[13.5px] text-ink-soft">Start typing above to compare live prices across suppliers.</p>
            </div>
          )}

          {status === "done" && rows.length === 0 && (
            <div className="rounded-xl border border-line bg-surface p-8 text-center">
              <p className="text-[13.5px] text-ink-soft">No products matched &quot;{query}&quot;.</p>
            </div>
          )}

          {rows.length > 0 && (
            <>
              {/* Mobile / default card view */}
              <div className="grid gap-3 lg:hidden">
                {rows.map((row) => {
                  const winnerId = cheapestSupplierId(row.suppliers);
                  const chosenId = row.allocation.supplierId ?? winnerId;
                  const chosenOffer = chosenId ? row.suppliers[chosenId] : undefined;
                  const storeCount = Object.keys(row.suppliers).length;
                  const lineStatus = deriveStatus(row, chosenId);
                  const cheaperElsewhere =
                    winnerId && winnerId !== chosenId ? row.suppliers[winnerId] : undefined;
                  return (
                    <div key={row.product.unitGtin} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                      <div className="flex gap-3">
                        <ProductGlyph department={row.product.category ?? "General"} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-[13.5px] font-medium text-ink">{row.product.name}</p>
                            {lineStatus && <LineStatusBadge status={lineStatus} />}
                          </div>
                          <p className="text-[12px] text-ink-soft">
                            {row.product.brand} · {row.product.packSize ?? row.product.unitGtin}
                          </p>
                          <div className="mt-2 flex items-end justify-between">
                            <div>
                              <p className="nums text-[18px] font-semibold text-ink">
                                {chosenOffer ? eur(chosenOffer.exVatCasePrice) : "—"}
                              </p>
                              <p className="text-[11.5px] text-ink-soft">
                                from {storeCount} supplier{storeCount === 1 ? "" : "s"}
                                {chosenId ? ` · ${supplierById(chosenId)?.short ?? supplierLabel(chosenId)}` : ""}
                              </p>
                              {cheaperElsewhere && typeof cheaperElsewhere.exVatCasePrice === "number" && (
                                <p
                                  className="mt-0.5 text-[11px] text-ink-faint"
                                  title={row.allocation.reason ?? "Kept the preferred supplier despite a cheaper offer."}
                                >
                                  cheaper at {supplierById(winnerId!)?.short ?? supplierLabel(winnerId!)} ({eur(cheaperElsewhere.exVatCasePrice)}) — kept for now
                                </p>
                              )}
                            </div>
                            <button className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas">
                              Compare
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table view */}
              <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface scrollbar-thin lg:block">
                <table className="w-full min-w-[880px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-canvas/60">
                      <th className="sticky left-0 z-10 bg-canvas/60 px-4 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">
                        Product
                      </th>
                      {supplierColumns.map((id) => {
                        const known = supplierById(id);
                        return (
                          <th key={id} className="min-w-[130px] px-3 py-3 text-[11.5px] font-semibold text-ink-soft">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: known?.color ?? "#94A3B8" }}
                              />
                              {known?.short ?? supplierLabel(id)}
                            </div>
                          </th>
                        );
                      })}
                      <th className="px-3 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const winnerId = cheapestSupplierId(row.suppliers);
                      const chosenId = row.allocation.supplierId ?? winnerId;
                      const lineStatus = deriveStatus(row, chosenId);
                      return (
                        <tr key={row.product.unitGtin} className="border-b border-line last:border-0 hover:bg-canvas/40">
                          <td className="sticky left-0 z-10 bg-surface px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <ProductGlyph department={row.product.category ?? "General"} size={36} />
                              <div>
                                <p className="text-[13px] font-medium text-ink">{row.product.name}</p>
                                <p className="text-[11.5px] text-ink-soft">
                                  {row.product.brand} · {row.product.packSize ?? row.product.unitGtin}
                                </p>
                              </div>
                            </div>
                          </td>
                          {supplierColumns.map((id) => {
                            const offer = row.suppliers[id];
                            const isCheapest = id === winnerId;
                            const isChosen = id === chosenId;
                            if (!offer) {
                              return (
                                <td key={id} className="px-3 py-3.5 text-[12.5px] text-ink-faint">—</td>
                              );
                            }
                            return (
                              <td key={id} className={`px-3 py-3.5 ${isChosen ? "bg-good-50/60" : ""}`}>
                                <p className={`nums text-[13.5px] font-medium ${isChosen ? "text-good-600" : "text-ink"}`}>
                                  {eur(offer.exVatCasePrice)}
                                </p>
                                {typeof offer.exVatPerBaseUnit === "number" && (
                                  <p className="nums text-[11px] text-ink-faint">€{offer.exVatPerBaseUnit.toFixed(4)}/unit</p>
                                )}
                                {offer.inStock === false && (
                                  <p className="text-[10.5px] font-medium text-warn-600">Out of stock</p>
                                )}
                                {offer.promo && <p className="text-[10.5px] font-medium text-teal-600">Promo</p>}
                                {isChosen && (
                                  <p className="text-[10.5px] font-semibold text-good-600">
                                    {isCheapest ? "Best deal" : "Kept — within margin"}
                                  </p>
                                )}
                                {isCheapest && !isChosen && (
                                  <p
                                    className="text-[10.5px] font-medium text-ink-faint"
                                    title={row.allocation.reason ?? "Cheaper here, but not selected by the allocation engine."}
                                  >
                                    Cheaper, not selected
                                  </p>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-3.5">
                            {lineStatus && <LineStatusBadge status={lineStatus} />}
                            {typeof row.allocation.savingVsMain === "number" && row.allocation.savingVsMain > 0 && (
                              <p className="nums mt-1 text-[11.5px] font-medium text-good-600">
                                save {eur(row.allocation.savingVsMain)}/wk
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Product detail drawer for the top result */}
              {firstRow && (
                <div className="mt-8 rounded-xl border border-line bg-surface p-5 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <ProductGlyph department={firstRow.product.category ?? "General"} size={52} />
                      <div>
                        <p className="text-[15px] font-semibold text-ink">{firstRow.product.name}</p>
                        <p className="text-[12.5px] text-ink-soft">
                          GTIN {firstRow.product.unitGtin}
                          {firstRow.product.packSize ? ` · ${firstRow.product.packSize}` : ""}
                          {firstRow.product.category ? ` · ${firstRow.product.category}` : ""}
                        </p>
                      </div>
                    </div>
                    {deriveStatus(firstRow, firstRowChosen) && (
                      <LineStatusBadge status={deriveStatus(firstRow, firstRowChosen)!} />
                    )}
                  </div>

                  <div className="mt-6 grid gap-8 lg:grid-cols-2">
                    <div>
                      <p className="text-[12.5px] font-semibold text-ink-soft">Price spread across suppliers</p>
                      <div className="mt-3">
                        <PreferenceBand
                          mainPrice={
                            firstRow.suppliers[MAIN_SUPPLIER_ID]?.exVatCasePrice ??
                            (firstRowWinner ? firstRow.suppliers[firstRowWinner]?.exVatCasePrice : undefined) ??
                            0
                          }
                          thresholdPct={0.1}
                          offers={Object.entries(firstRow.suppliers)
                            .filter(
                              (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
                                entry[1] !== null &&
                                typeof entry[1].exVatCasePrice === "number" &&
                                Number.isFinite(entry[1].exVatCasePrice)
                            )
                            .map(([id, offer]) => {
                              const known = supplierById(id);
                              return {
                                label: known?.short ?? supplierLabel(id),
                                price: offer.exVatCasePrice,
                                color: known?.color ?? "#94A3B8",
                                isMain: id === MAIN_SUPPLIER_ID,
                              };
                            })}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-[12.5px] font-semibold text-ink-soft">Store-by-store breakdown</p>
                      <div className="mt-3 divide-y divide-line rounded-lg border border-line">
                        {Object.entries(firstRow.suppliers)
                          .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== null)
                          .map(([id, offer]) => {
                          const known = supplierById(id);
                          const isCheapest = id === firstRowWinner;
                          const isChosen = id === firstRowChosen;
                          return (
                            <div key={id} className="flex items-center justify-between px-3.5 py-2.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: known?.color ?? "#94A3B8" }}
                                />
                                <span className="text-[13px] text-ink">{known?.short ?? supplierLabel(id)}</span>
                                {isCheapest && !isChosen && (
                                  <span
                                    className="text-[10.5px] text-ink-faint"
                                    title={firstRow.allocation.reason ?? "Cheaper here, but not selected by the allocation engine."}
                                  >
                                    (cheaper, not selected)
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={`nums text-[13px] font-medium ${isChosen ? "text-good-600" : "text-ink"}`}>
                                  {eur(offer.exVatCasePrice)}
                                </span>
                                <button
                                  disabled={!isChosen}
                                  className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${
                                    isChosen ? "bg-teal-500 text-white hover:bg-teal-600" : "border border-line text-ink-faint"
                                  }`}
                                >
                                  Go to store
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line pb-4 pt-4 first:pt-0">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      <div className="mt-2.5 space-y-2">{children}</div>
    </div>
  );
}

function FilterCheck({ label, defaultChecked, swatch }: { label: string; defaultChecked?: boolean; swatch?: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink">
      <input type="checkbox" readOnly checked={defaultChecked} className="h-3.5 w-3.5 rounded border-line text-teal-500 focus:ring-teal-500" />
      {swatch && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: swatch }} />}
      {label}
    </label>
  );
}