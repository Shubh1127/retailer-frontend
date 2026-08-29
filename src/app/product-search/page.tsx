"use client";

/**
 * One product, every supplier side by side — and into a basket.
 *
 * WHY A TABLE AND NOT FOUR BOXES
 *
 * This page used to draw one box per supplier, each paged through its own
 * listings. That answered "what did Musgrave return" well and "which of them is
 * cheapest" badly: the buyer had to hold four numbers in their head while
 * clicking through four independent lists, and the same product appeared in
 * each box under four different names with no way to line them up.
 *
 * A row per product with a column per supplier makes the comparison the shape
 * of the question. It is also the layout the job results and the dashboard
 * search already use, so a buyer learns it once.
 *
 * SEARCHING NO LONGER CONTACTS A SUPPLIER
 *
 * The lookup runs master table -> local catalogues -> live text search, and the
 * first two answer in milliseconds. Nothing is priced until the buyer presses
 * Fetch live prices, and then only the exact (supplier, SKU) pairs our own data
 * already said stock the product. Searching used to re-price every candidate at
 * four logged-in trade accounts before answering, which is why it took seconds.
 *
 * WHY THE BASKET IDS ARE NOT COLLAPSED HERE
 *
 * Everywhere else a retailer sees one "Barry Group". A basket cannot: ambient
 * and chill are separate orders with separate delivery days and separate
 * minimums, and `barrygroup` is not a basket at all. So the columns carry the
 * precise id — otherwise Add would have nowhere real to send the line.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AppShell from "@/components/AppShell";
import ProductPriceTable from "@/components/ProductPriceTable";
import ProductSearchBox from "@/components/ProductSearchBox";
import SupplierNotices from "@/components/SupplierNotices";
import { TableSkeleton } from "@/components/TableSkeleton";
import { ApiError } from "@/lib/api/client";
import { searchSupplierListings, type SupplierSearchResponse } from "@/lib/api/endpoint";

/**
 * `useSearchParams` reads the URL through the router rather than through
 * `window.location`, and it has to: on a client-side navigation React renders
 * the new page BEFORE the browser's address bar is updated, so a first-render
 * read of `window.location.search` saw the URL of the page you came FROM. A
 * barcode typed on the dashboard arrived here as no query at all.
 *
 * The hook opts a route out of static rendering unless it sits under a Suspense
 * boundary, which is what this wrapper is.
 */
export default function ProductSearchPage() {
  return (
    <Suspense
      fallback={
        <AppShell active="Product search">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Product search</h1>
          <div className="mt-5 rounded-xl border border-line bg-surface">
            <TableSkeleton rows={4} columns={6} />
          </div>
        </AppShell>
      }
    >
      <ProductSearch />
    </Suspense>
  );
}

function ProductSearch() {
  /**
   * What is TYPED, and what was actually SEARCHED. Two values, on purpose.
   *
   * This box used to search on a 350ms debounce, which meant typing "birra
   * moretti premium lager" fired several searches on the way — one per pause
   * long enough to look like a finished word. Nothing goes out now until the
   * buyer says so, and `searched` is what the results on screen belong to, so
   * the heading cannot describe them with a query that was never run.
   */
  /**
   * A query handed over in the URL — `/product-search?q=5054267013926`.
   *
   * The dashboard's "Enter a barcode" box sends people here rather than running
   * its own search, so there is one search implementation and one presentation
   * of its results.
   *
   * It is LEFT IN THE URL on purpose: a search that survives a refresh and can
   * be sent to somebody is worth more than a tidy address bar.
   */
  const handedOverQuery = (useSearchParams().get("q") ?? "").trim();
  const router = useRouter();

  const [query, setQuery] = useState(handedOverQuery);
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<SupplierSearchResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // A second search while the first is in flight abandons the first. The
    // buyer changed their mind; its results would arrive to overwrite the ones
    // they actually asked for.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearched(trimmed);
    setStatus("loading");
    setErrorMessage("");

    try {
      const data = await searchSupplierListings(trimmed, controller.signal);
      setResults(data);
      setStatus("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
      setErrorMessage(
        error instanceof ApiError
          ? `Search failed (${error.status}): ${error.message}`
          : "Something went wrong while searching.",
      );
    }
  }, [query]);

  /**
   * Run the handed-over query once, on arrival.
   *
   * Latched, because React's development double-mount would otherwise search
   * twice — and because `runSearch` is rebuilt whenever the buyer edits the
   * field, which would re-run the URL's query over the top of what they typed.
   */
  const ranHandedOver = useRef(false);
  useEffect(() => {
    if (ranHandedOver.current || !handedOverQuery) return;
    ranHandedOver.current = true;
    void runSearch();
  }, [handedOverQuery, runSearch]);

  const clear = () => {
    abortRef.current?.abort();
    // The URL's query goes too, or a refresh would bring back what was cleared.
    // Through the ROUTER, not `history.replaceState`: a bare history call
    // leaves `useSearchParams` still reporting the query it just removed.
    if (handedOverQuery) router.replace("/product-search");
    setQuery("");
    setSearched("");
    setResults(null);
    setStatus("idle");
  };

  const listingCount = results?.products.length ?? 0;

  return (
    <AppShell active="Product search">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Product search</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {status === "done" && listingCount > 0
              ? `${listingCount} listing${listingCount === 1 ? "" : "s"} for "${searched}" · prices ex-VAT per case, fetched when you ask`
              : "Find one product, see who stocks it, then fetch each supplier's live price"}
          </p>
        </div>
      </div>

      {/* Enter submits it — which is also what makes a handheld barcode
          scanner work with no extra handling: those present as a keyboard,
          typing the digits and pressing Enter. */}
      <ProductSearchBox
        value={query}
        onChange={setQuery}
        onSubmit={() => void runSearch()}
        busy={status === "loading"}
        placeholder="Product name, SKU or barcode — e.g. lucozade, 5054267013926"
        className="mt-4"
      >
        {(query || results) && (
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink"
          >
            Clear
          </button>
        )}
      </ProductSearchBox>

      {status === "error" && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-600">
          {errorMessage}
        </p>
      )}

      {/* A supplier that FAILED, reported apart from one that simply had
          nothing — but WITHOUT the backend's diagnosis, which is written for
          whoever fixes it and goes to the console instead. */}
      <SupplierNotices errors={results?.errors} />

      {status === "idle" && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-[13.5px] text-ink-soft">
            Type a product name or scan a barcode, then press Search.
          </p>
        </div>
      )}

      {/* NOTHING USED TO BE HERE, and that was the bug people saw: the idle
          panel disappears the moment a search starts and the results panel only
          arrives when it finishes, so the page went blank in between. A search
          that lands in milliseconds hid it; one arriving from the dashboard,
          with a cold catalogue index behind it, did not. */}
      {status === "loading" && (
        <div className="mt-5 rounded-xl border border-line bg-surface">
          <TableSkeleton rows={4} columns={6} />
        </div>
      )}

      {status === "done" && (
        <div className="mt-5 rounded-xl border border-line bg-surface">
          {/* Re-keyed on the query, so a new search cannot inherit the previous
              one's fetched prices or its quantities. */}
          <ProductPriceTable
            key={searched}
            products={results?.products ?? []}
            emptyMessage={`No supplier catalogue has a product for "${searched}".`}
          />
        </div>
      )}
    </AppShell>
  );
}
