"use client";

/**
 * Price one product, from wherever you already are.
 *
 * The dashboard is where a buyer lands, and most of the time they are not
 * uploading anything — they want to know what one thing costs before deciding
 * whether it belongs in this week's order at all. Making them navigate to
 * another page to ask is what turns a ten-second question into a task.
 *
 * DELIBERATELY A SUMMARY, NOT THE FULL COMPARISON. One line per supplier,
 * cheapest listing, and a link through to `/product-search` for the pack sizes,
 * pictures and Add buttons. Reproducing that here would be a second copy of a
 * screen that already exists, and the two would drift.
 *
 * Nothing runs until Search is pressed — the same rule as the full page. Typing
 * "birra moretti premium lager" on a debounce fires several live searches
 * against four trade accounts on the way to the one you meant.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { ApiError } from "@/lib/api/client";
import { cartSupplierLabel } from "@/lib/api/cart";
import { eur } from "@/lib/mock-data";
import {
  searchSupplierListings,
  type SupplierSearchProduct,
} from "@/lib/api/endpoint";

interface Best {
  supplier: string;
  product: SupplierSearchProduct;
}

export default function QuickProductSearch() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [best, setBest] = useState<Best[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setStatus("loading");
    setMessage("");
    setSearched(trimmed);

    try {
      const result = await searchSupplierListings(trimmed);

      // The cheapest PRICED listing per supplier. A listing whose price could
      // not be re-checked is not a candidate for "cheapest" — comparing a
      // fetched price against a missing one is not a comparison.
      const bySupplier = new Map<string, SupplierSearchProduct>();
      for (const product of result.products) {
        if (product.exVatCasePrice === undefined) continue;
        const current = bySupplier.get(product.supplier);
        if (!current || product.exVatCasePrice < current.exVatCasePrice!) {
          bySupplier.set(product.supplier, product);
        }
      }

      setBest(
        [...bySupplier.entries()]
          .map(([supplier, product]) => ({ supplier, product }))
          .sort((a, b) => a.product.exVatCasePrice! - b.product.exVatCasePrice!),
      );
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof ApiError ? error.message : "Something went wrong while searching.",
      );
    }
  };

  const cheapest = best?.[0];

  return (
    <section className="mb-5 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-ink">Find one product</h2>
        <Link href="/product-search" className="text-[12.5px] text-link hover:underline">
          Full comparison →
        </Link>
      </div>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">
        Check what a single product costs across every supplier, without starting a job.
      </p>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Product name, SKU or barcode"
          aria-label="Product name, SKU or barcode"
          className="w-full max-w-sm rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <button
          type="submit"
          disabled={!query.trim() || status === "loading"}
          className="rounded-md bg-teal-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal-700 disabled:opacity-40"
        >
          {status === "loading" ? "Searching…" : "Search"}
        </button>
      </form>

      {status === "error" && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">{message}</p>
      )}

      {status === "done" && best && best.length === 0 && (
        <p className="mt-3 text-[12.5px] text-ink-soft">
          No supplier returned a priced product for &quot;{searched}&quot;.
        </p>
      )}

      {best && best.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {best.map(({ supplier, product }) => (
            <li key={supplier} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[12.5px] text-ink">{product.name}</p>
                <p className="text-[11px] text-ink-faint">
                  {cartSupplierLabel(supplier)}
                  {product.size && ` · ${product.size}`}
                  {product.sku && <span className="nums"> · {product.sku}</span>}
                </p>
              </div>
              <span
                className={`nums shrink-0 text-[13px] font-medium ${
                  supplier === cheapest?.supplier ? "text-good-600" : "text-ink"
                }`}
              >
                {eur(product.exVatCasePrice)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
