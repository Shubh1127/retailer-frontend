"use client";

/**
 * One product, every supplier side by side — and into a basket.
 *
 * WHY ONE BOX PER SUPPLIER, WALKED ONE LISTING AT A TIME
 *
 * A search returns twenty-odd listings across four wholesalers. As a flat table
 * that is a wall of near-identical rows, and it cannot answer the question a
 * buyer actually has, which is "what is Musgrave's offer versus Barry's". One
 * box per supplier makes that a side-by-side comparison, and paging inside each
 * box gives a single listing the room for a picture, its pack, its RRP and its
 * barcode instead of a truncated line.
 *
 * Each box keeps its OWN position. The suppliers return different numbers of
 * listings and the buyer is comparing independent lists, so advancing Musgrave
 * must not move Kadona.
 *
 * This is deliberately the same layout as the admin's confirm-a-product panel.
 * The two screens answer the same question about the same data, and having
 * them diverge meant an admin and a retailer looking at one product saw two
 * different things.
 *
 * WHY THE BASKET IDS ARE NOT COLLAPSED HERE
 *
 * Everywhere else a retailer sees one "Barry Group". A basket cannot: ambient
 * and chill are separate orders with separate delivery days and separate
 * minimums, and `barrygroup` is not a basket at all. So the boxes carry the
 * precise id and say which one they are — otherwise Add would have nowhere
 * real to send the line.
 */

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";

import AppShell from "@/components/AppShell";
import ProductGlyph from "@/components/ProductGlyph";
import { ApiError } from "@/lib/api/client";
import {
  searchSupplierListings,
  type SupplierSearchProduct,
  type SupplierSearchResponse,
} from "@/lib/api/endpoint";
import {
  addItems,
  cartSupplierLabel,
  supportsCart,
  VerificationRequiredError,
  type CartSupplier,
} from "@/lib/api/cart";
import { eur } from "@/lib/mock-data";

/**
 * The order the boxes appear in, so the layout does not reshuffle between
 * searches. Suppliers the backend returns that are not listed here are appended
 * rather than dropped — a new wholesaler should show up untitled, not vanish.
 */
const SUPPLIER_ORDER = [
  "musgrave",
  "oreilly",
  "barrygroup-ambient",
  "barrygroup-chill",
  "kadona",
];

/** "24 × 38ml", or nothing when the supplier stated no readable pack. */
function packOf(product: SupplierSearchProduct): string {
  if (product.size) return product.size;
  if (product.unitsPerCase === undefined || product.unitSize === undefined) return "—";
  const uom = product.uom === "each" ? "" : (product.uom ?? "");
  return `${product.unitsPerCase} × ${product.unitSize}${uom}`;
}

export default function ProductSearchPage() {
  /**
   * What is TYPED, and what was actually SEARCHED. Two values, on purpose.
   *
   * This box used to search on a 350ms debounce, which meant typing "birra
   * moretti premium lager" fired several searches on the way — one per pause
   * long enough to look like a finished word. Each of those is a live query to
   * four logged-in trade accounts, and Kadona alone takes 2–4 seconds to answer
   * one, so most of that traffic was spent on prefixes nobody wanted the
   * results for and the useful search queued behind them.
   *
   * Nothing goes out now until the buyer says so. `searched` is what the
   * results on screen belong to, so the heading cannot describe them with a
   * query that was never run.
   */
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<SupplierSearchResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  /**
   * Bumped on every completed search, and mixed into each box's React key.
   *
   * Without it a box that was showing listing 7 of 20 keeps that index when the
   * next search returns three listings for a different product — the box would
   * render nothing and look broken. Re-keying resets each box to its first
   * result, which is what a new search means.
   */
  const [searchRun, setSearchRun] = useState(0);

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
      setSearchRun((run) => run + 1);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const clear = () => {
    abortRef.current?.abort();
    setQuery("");
    setSearched("");
    setResults(null);
    setStatus("idle");
  };

  /**
   * supplierId → that supplier's listings, in the fixed display order.
   *
   * The backend returns one flat array across every supplier — the same shape
   * the admin panel receives — because the grouping a screen wants is a screen
   * decision, and grouping it server-side would have forced this page and the
   * admin's to agree about it for ever.
   */
  const bySupplier = useMemo(() => {
    const grouped = new Map<string, SupplierSearchProduct[]>();
    for (const product of results?.products ?? []) {
      const existing = grouped.get(product.supplier);
      if (existing) existing.push(product);
      else grouped.set(product.supplier, [product]);
    }

    return [...grouped.entries()].sort(([a], [b]) => {
      const ia = SUPPLIER_ORDER.indexOf(a);
      const ib = SUPPLIER_ORDER.indexOf(b);
      return (ia === -1 ? SUPPLIER_ORDER.length : ia) - (ib === -1 ? SUPPLIER_ORDER.length : ib);
    });
  }, [results]);

  const listingCount = results?.products.length ?? 0;

  return (
    <AppShell active="Product search">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Product search</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {status === "done" && listingCount > 0
              ? `${listingCount} listing${listingCount === 1 ? "" : "s"} for "${searched}" across ${bySupplier.length} supplier${bySupplier.length === 1 ? "" : "s"} · prices ex-VAT per case`
              : "Search one product and compare every supplier's live price, ex-VAT per case"}
          </p>
        </div>
      </div>

      {/* A FORM, so Enter submits it.
          That is what makes a handheld barcode scanner work with no extra
          handling: those present as a keyboard, typing the digits and pressing
          Enter, which lands here as an ordinary submit. */}
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Product name, SKU or barcode — e.g. lucozade, 5054267013926"
          aria-label="Product name, SKU or barcode"
          className="w-full max-w-lg rounded-md border border-line bg-surface px-3.5 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <button
          type="submit"
          disabled={!query.trim() || status === "loading"}
          className="rounded-md bg-teal-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-teal-600"
        >
          {status === "loading" ? "Searching…" : "Search"}
        </button>
        {(query || results) && (
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink"
          >
            Clear
          </button>
        )}
        {status === "loading" && (
          <span className="text-[12.5px] text-ink-soft">
            Asking every supplier — Kadona can take a few seconds…
          </span>
        )}
      </form>

      {status === "error" && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-600">
          {errorMessage}
        </p>
      )}

      {/* A supplier that FAILED, reported apart from one that simply had
          nothing. Folded together, a Musgrave outage reads as "Musgrave do not
          stock this" — the one conclusion a buyer must not draw from it. */}
      {results?.errors.map((supplierError) => (
        <div
          key={supplierError.supplierId}
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
        >
          <strong className="font-medium">{cartSupplierLabel(supplierError.supplierId)}</strong>{" "}
          could not be searched — {supplierError.message}. Its products are missing from these
          results, not absent from its catalogue.
        </div>
      ))}

      {status === "idle" && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-[13.5px] text-ink-soft">
            Type a product name or scan a barcode, then press Search to compare live
            supplier prices.
          </p>
        </div>
      )}

      {status === "done" && listingCount === 0 && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-8 text-center">
          <p className="text-[13.5px] text-ink-soft">
            No supplier returned a product for &quot;{searched}&quot;.
          </p>
        </div>
      )}

      {listingCount > 0 && (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {bySupplier.map(([supplier, candidates]) => (
            <SupplierResultBox
              key={`${supplier}-${searchRun}`}
              supplier={supplier}
              candidates={candidates}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

/**
 * One supplier's listings, walked one at a time, with Add to basket.
 *
 * The add sends NO jobId, and that is correct rather than an omission. The
 * backend's price lock applies to adds that name a job, because those carry
 * prices read when the job ran and can be stale by hours. This price was
 * fetched live seconds ago by the search above it, so there is nothing stale to
 * protect against — and the manual add is an explicitly supported path.
 */
function SupplierResultBox({
  supplier,
  candidates,
}: {
  supplier: string;
  candidates: SupplierSearchProduct[];
}) {
  const [index, setIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const candidate = candidates[index];
  if (!candidate) return null;

  const atFirst = index === 0;
  const atLast = index === candidates.length - 1;

  // Two independent reasons Add cannot work, and they need different words: a
  // supplier with no cart integration is never addable, while a listing with no
  // SKU is this one listing being unorderable by anybody.
  const cartable = supportsCart(supplier);
  const hasSku = Boolean(candidate.sku);

  const move = (delta: number) => {
    setIndex((current) => current + delta);
    // The message belonged to the listing that just left the screen.
    setOutcome(null);
  };

  const add = async () => {
    if (!candidate.sku) return;
    setAdding(true);
    setOutcome(null);

    try {
      const result = await addItems(
        [
          {
            sku: candidate.sku,
            quantity,
            ...(candidate.name ? { name: candidate.name } : {}),
          },
        ],
        supplier as CartSupplier,
      );

      const failed = result.results.find((entry) => entry.outcome === "failed");
      setOutcome(
        failed
          ? { ok: false, message: failed.error ?? "The supplier rejected this line." }
          : {
              ok: true,
              message:
                result.updated > 0
                  ? `Quantity set to ${quantity} in the ${cartSupplierLabel(supplier)} basket.`
                  : `Added ${quantity} × to the ${cartSupplierLabel(supplier)} basket.`,
            },
      );
    } catch (error) {
      setOutcome({
        ok: false,
        message:
          error instanceof VerificationRequiredError
            ? "This product needs checking before it can be added."
            : error instanceof ApiError
              ? error.message
              : "Could not reach the basket.",
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[12.5px] font-medium text-ink">{cartSupplierLabel(supplier)}</span>
        <span className="nums text-[11.5px] text-ink-faint">
          {index + 1} of {candidates.length}
        </span>
      </div>

      <div className="flex flex-1 gap-3 p-3">
        <Thumb product={candidate} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] text-ink">{candidate.name}</span>
            {/* A case and its break-pack single share one barcode at very
                different prices. Unlabelled, the cheap one reads as a bargain. */}
            {candidate.isSingle && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">
                Single
              </span>
            )}
            {candidate.inStock === false && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10.5px] font-medium text-red-600">
                Out of stock
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-faint">
            {candidate.brand && `${candidate.brand} · `}
            {candidate.sku && <span className="nums">SKU {candidate.sku}</span>}
            {candidate.ean && <span className="nums"> · EAN {candidate.ean}</span>}
          </div>

          {/* NO PRICE IS NOT A ZERO PRICE. Products come from our synced
              catalogues; only a price re-checked at the supplier just now is
              shown, because a stale one looks identical on screen and this is
              a page for comparing suppliers. */}
          {candidate.exVatCasePrice !== undefined ? (
            <div className="nums mt-2 text-[14px] font-semibold text-ink">
              {eur(candidate.exVatCasePrice)}
              <span className="ml-1 text-[10.5px] font-normal text-ink-faint">
                per case, ex-VAT
              </span>
            </div>
          ) : (
            <div className="mt-2 text-[12px] text-ink-faint">
              Price not checked
              <span className="ml-1 text-[10.5px]">
                — open it at the supplier for today&apos;s price
              </span>
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
            <span>
              <span className="text-ink-faint">Pack: </span>
              <span className="text-ink-soft">{packOf(candidate)}</span>
            </span>
            {candidate.priceText && (
              <span>
                <span className="text-ink-faint">Listed: </span>
                <span className="text-ink-soft">{candidate.priceText}</span>
              </span>
            )}
            {candidate.rrpText && (
              <span>
                <span className="text-ink-faint">RRP: </span>
                <span className="text-ink-soft">{candidate.rrpText}</span>
              </span>
            )}
            {candidate.vatText && (
              <span>
                <span className="text-ink-faint">VAT: </span>
                <span className="text-ink-soft">{candidate.vatText}</span>
              </span>
            )}
            {/* `viewUrl`, not `productUrl` — Musgrave's product URL is an API
                resource path that renders nothing in a browser. */}
            {(candidate.viewUrl ?? candidate.productUrl) && (
              <a
                href={candidate.viewUrl ?? candidate.productUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                View on supplier ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {outcome && (
        <p
          className={`mx-3 mb-2 rounded-md px-2.5 py-1.5 text-[11.5px] ${
            outcome.ok ? "bg-good-50 text-good-600" : "bg-red-50 text-red-600"
          }`}
        >
          {outcome.message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={atFirst}
            onClick={() => move(-1)}
            className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ← Prev
          </button>
          <button
            type="button"
            disabled={atLast}
            onClick={() => move(1)}
            className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Next →
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`qty-${supplier}`}>
            Cases
          </label>
          <input
            id={`qty-${supplier}`}
            type="number"
            min={1}
            value={quantity}
            disabled={!cartable || !hasSku}
            onChange={(event) =>
              setQuantity(Math.max(1, Math.floor(Number(event.target.value) || 1)))
            }
            className="nums w-14 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-ink disabled:opacity-40"
          />
          <button
            type="button"
            disabled={!cartable || !hasSku || adding}
            onClick={add}
            title={
              !cartable
                ? `${cartSupplierLabel(supplier)} has no basket integration yet`
                : !hasSku
                  ? "This listing has no product code, so it cannot be ordered"
                  : undefined
            }
            className="rounded-md bg-teal-600 px-3 py-1 text-[11.5px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-teal-600"
          >
            {adding ? "Adding…" : "Add to basket"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The product picture, with a departmental glyph behind it.
 *
 * Suppliers publish broken image URLs often enough that this must not be an
 * `<img>` alone — a hole in the box reads as the page being broken, which is a
 * worse lie than a placeholder.
 */
function Thumb({ product }: { product: SupplierSearchProduct }) {
  const [failed, setFailed] = useState(false);

  if (!product.imageUrl || failed) {
    return <ProductGlyph department="General" size={56} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={product.imageUrl}
      alt={product.name}
      style={{ width: 56, height: 56 }}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-lg border border-line bg-white object-contain"
      loading="lazy"
    />
  );
}
