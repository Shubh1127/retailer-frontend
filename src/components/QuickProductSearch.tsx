"use client";

/**
 * Find one product from the dashboard, price it, and order it without leaving.
 *
 * The table itself is `ProductPriceTable`, shared with /product-search — the
 * two screens answer the same question about the same data, and having them
 * diverge meant a buyer looking at one product saw two different things
 * depending on where they typed. This file is the search box around it.
 *
 * SEARCHING NO LONGER CONTACTS A SUPPLIER. The lookup goes master table →
 * local catalogues → live text search, and answers in milliseconds from the
 * first two; prices show as "—" until the buyer presses Fetch live prices. That
 * is what took searching here from seconds to instant.
 */

import { useState } from "react";
import Link from "next/link";

import ProductPriceTable from "@/components/ProductPriceTable";
import ProductSearchBox from "@/components/ProductSearchBox";
import { TableSkeleton } from "@/components/TableSkeleton";
import { ApiError } from "@/lib/api/client";
import { searchSupplierListings, type SupplierSearchProduct } from "@/lib/api/endpoint";

export default function QuickProductSearch() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [products, setProducts] = useState<SupplierSearchProduct[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  const submit = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setStatus("loading");
    setMessage("");
    setSearched(trimmed);

    try {
      const result = await searchSupplierListings(trimmed);
      setProducts(result.products);
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof ApiError ? error.message : "Something went wrong.");
    }
  };

  return (
    <section className="mb-5 rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Find  Product</h2>
          {/* <p className="mt-0.5 text-[12.5px] text-ink-soft">
            Who stocks it, and — when you ask — what each of them charges. Prices are ex-VAT
            per case.
          </p> */}
        </div>
        <Link href="/product-search" className="text-[12.5px] text-link hover:underline">
          Full comparison →
        </Link>
      </div>

      <ProductSearchBox
        value={query}
        onChange={setQuery}
        onSubmit={() => void submit()}
        busy={status === "loading"}
        className="px-4 py-3"
        tone="canvas"
      />

      {status === "error" && (
        <p className="mx-4 mb-3 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">
          {message}
        </p>
      )}

      {/* The same gap the full page had: the box shows a spinner, but the area
          below it stays empty until results land, so a slow search looks like a
          search that did nothing. */}
      {status === "loading" && <TableSkeleton rows={3} columns={5} />}

      {status === "done" && (
        // Re-keyed on the query, so a new search cannot inherit the previous
        // one's fetched prices or its quantities.
        <ProductPriceTable
          key={searched}
          products={products ?? []}
          emptyMessage={`Nothing found for "${searched}".`}
        />
      )}
    </section>
  );
}
