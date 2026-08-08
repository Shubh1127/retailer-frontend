"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchCompare } from "@/lib/api/endpoint";
import { ApiError } from "@/lib/api/client";
import type { CompareRow } from "@/lib/api/types";
import { eur } from "@/lib/mock-data";
import { cheapestSupplierId, supplierLabel } from "@/lib/compare-utils";

const DEBOUNCE_MS = 350;

export default function ProductSearch() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
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
              ? "Couldn't reach the comparison backend. Is it running on localhost:8787?"
              : `Request failed (${err.status}): ${err.message}`
            : "Something went wrong while searching."
        );
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const supplierColumns = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r) => Object.keys(r.suppliers).forEach((id) => ids.add(id)));
    return Array.from(ids);
  }, [rows]);

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[14.5px] font-semibold text-ink">Search &amp; compare</h2>
        {status === "loading" && (
          <span className="text-[12px] text-ink-soft">Searching…</span>
        )}
      </div>

      <div className="mt-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products, e.g. coke, milk, kettle chips…"
          className="w-full rounded-md border border-line bg-canvas px-3.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      {status === "error" && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-600">
          {errorMessage}
        </p>
      )}

      {status === "idle" && !query && (
        <p className="mt-4 text-[12.5px] text-ink-soft">
          Start typing to search live prices across suppliers.
        </p>
      )}

      {status === "done" && rows.length === 0 && (
        <p className="mt-4 text-[12.5px] text-ink-soft">No products matched &quot;{query}&quot;.</p>
      )}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
                <th className="pb-2 pr-4 font-medium">Product</th>
                {supplierColumns.map((id) => (
                  <th key={id} className="pb-2 pr-4 font-medium">
                    {supplierLabel(id)}
                  </th>
                ))}
                <th className="pb-2 font-medium">Best pick</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const best = cheapestSupplierId(row.suppliers);
                const chosen = row.allocation.supplierId ?? best;
                return (
                  <tr key={row.product.unitGtin}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-ink">{row.product.name}</p>
                      <p className="text-[11.5px] text-ink-soft">
                        {row.product.brand} · {row.product.unitGtin}
                      </p>
                    </td>
                    {supplierColumns.map((id) => {
                      const offer = row.suppliers[id];
                      if (!offer) {
                        return (
                          <td key={id} className="py-3 pr-4 text-ink-faint">
                            —
                          </td>
                        );
                      }
                      const isBest = id === best;
                      return (
                        <td
                          key={id}
                          className={`nums py-3 pr-4 ${
                            isBest ? "font-semibold text-good-600" : "text-ink"
                          }`}
                        >
                          {eur(offer.exVatCasePrice)}
                          {offer.inStock === false && (
                            <span className="ml-1 text-[11px] text-ink-faint">(out of stock)</span>
                          )}
                          {offer.flagged && (
                            <span className="ml-1 text-[11px] text-warn-600">⚠</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-3">
                      {chosen ? (
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11.5px] font-medium text-teal-600">
                          {supplierLabel(chosen)}
                        </span>
                      ) : (
                        <span className="text-[11.5px] text-ink-faint">—</span>
                      )}
                      {typeof row.allocation.savingVsMain === "number" && (
                        <p className="mt-0.5 text-[11px] text-ink-soft">
                          saves {eur(row.allocation.savingVsMain)}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}