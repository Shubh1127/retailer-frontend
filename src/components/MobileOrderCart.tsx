"use client";

/**
 * The order cart, as a phone shows it.
 *
 * ── WHY THIS IS A SEPARATE COMPONENT AND NOT `sm:` CLASSES ──────────────────
 *
 * The desktop cart is a table: a product, four price columns read across, a
 * stepper and a bin, all on one row. Every part of that shape is wrong at
 * 390px — four price columns leave 70px each, and a stepper beside a bin beside
 * a chevron puts three targets inside a thumb's width of each other.
 *
 * The phone answers a different question anyway. At a desk the buyer is
 * comparing; in an aisle they are checking one product and moving on. So the
 * comparison moves into a sheet (`ProductDetailSheet`) and the row keeps only
 * what identifies the product and the one control they actually reach for.
 *
 * ── IT LOADS THE WHOLE CART, DELIBERATELY ───────────────────────────────────
 *
 * `getOrderList()` with no page parameters returns every line — the server only
 * paginates when asked (`orderListRoutes.ts`, which caps an explicit `pageSize`
 * at 50). Search and filters are then honest: typing "nutella" searches the
 * cart, not the ten lines that happen to be on screen. A paginated search that
 * silently ignores pages 2-22 is worse than no search, because it answers
 * "not found" for something that is right there.
 *
 * Two hundred rows is also well inside what a phone renders without
 * virtualisation, so the list stays plain DOM and keeps working with find-in-
 * page and screen readers.
 *
 * ── THE MOTION BUDGET ───────────────────────────────────────────────────────
 *
 * Every animation here is either presence (something arrived or left) or a
 * press response. Nothing animates `layout`, and that is the one rule worth
 * stating: a cart holds a couple of hundred rows, and `layout` on each of them
 * makes every filter change a full measure-and-tween of the whole list, which
 * is exactly the jank it is meant to prevent. Rows therefore fade and slide
 * without reserving or collapsing their own height.
 *
 * `AnimatePresence initial={false}` on the list, so arriving at a cart of 214
 * products does not play 214 entrances. The animation is for the CHANGE, not
 * for the page.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
 *
 * "Move to list" from the mockup's bulk bar has no backend: a line's sources
 * are recorded as a fact about where it came from, not a folder it can be
 * moved between. Selection-scoped "Compare" has none either — `compareOrderCart`
 * takes no arguments and runs the entire cart, so a button on a two-line
 * selection would start a job over all 214 and say nothing about it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";

import ConfirmDialog from "@/components/ConfirmDialog";
import ProductDetailSheet from "@/components/ProductDetailSheet";
import ProductThumb from "@/components/ProductThumb";
import { usePagination } from "@/components/Pagination";
import { useSupplierGate } from "@/components/SupplierGate";
import { ApiError } from "@/lib/api/client";
import { toBase64 } from "@/lib/fileEncoding";
import { cacheKeys } from "@/lib/sessionCache";
import { useCartEnrichment, withEnrichment } from "@/lib/useCartEnrichment";
import { useCachedResource } from "@/lib/useCachedResource";
import {
  compareOrderCart,
  fetchOrderCartPrices,
  getOrderList,
  importOrderListCsv,
  importOrderListEpos,
  removeOrderListLine,
  setOrderListCases,
  type OrderList,
  type OrderListLine,
  type PricedCartLine,
  type SkippedRow,
} from "@/lib/api/orderList";

const QUANTITY_FLUSH_MS = 400;

type FilterId = "all" | "not_priced" | "order_list" | "scan";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "not_priced", label: "Not priced" },
  { id: "order_list", label: "Order list" },
  { id: "scan", label: "Scan" },
];

function titleOf(line: OrderListLine): string {
  return (
    line.description?.trim() ||
    line.gtin14?.trim() ||
    line.articleCode?.trim() ||
    line.scannedCode?.trim() ||
    "Unnamed product"
  );
}

/** The identity worth showing under the name, and what to call it. */
function identityOf(line: OrderListLine): { identity?: string; identityLabel?: string } {
  if (line.gtin14?.trim()) return { identity: line.gtin14.trim(), identityLabel: "EAN" };
  if (line.articleCode?.trim()) return { identity: line.articleCode.trim(), identityLabel: "Article" };
  if (line.scannedCode?.trim()) return { identity: line.scannedCode.trim(), identityLabel: "Scanned" };
  if (line.foundSupplierSku?.trim()) return { identity: line.foundSupplierSku.trim(), identityLabel: "SKU" };
  return {};
}

/** "24 × 38" — what you get for the money, when the line knows. */
function packOf(line: OrderListLine): string | undefined {
  if (line.sizeText?.trim()) return line.sizeText.trim();
  if (line.unitsPerCase !== undefined && line.unitSize !== undefined) {
    return `${line.unitsPerCase} × ${line.unitSize}`;
  }
  if (line.packRaw?.trim()) return line.packRaw.trim();
  return undefined;
}

/** Everything a search box should be able to find this line by. */
function haystack(line: OrderListLine): string {
  return [line.description, line.gtin14, line.articleCode, line.scannedCode, line.foundSupplierSku]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ---------------------------------------------------------------------------

export default function MobileOrderCart() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const [prices, setPrices] = useState<Record<number, PricedCartLine>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);

  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  /** `null` means ordinary browsing. A Set — even an empty one — means select mode. */
  const [selection, setSelection] = useState<Set<number> | null>(null);
  const [openLineId, setOpenLineId] = useState<number | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<number[] | null>(null);

  /**
   * ── THE CART, REMEMBERED FOR THE LENGTH OF THIS TAB ───────────────────────
   *
   * Coming back from Settings paints the list on the first render from this
   * tab's session cache and checks with the server behind it. A first visit
   * has nothing cached and shows the skeleton as before.
   *
   * `enrich: "none"` — the order now, the pictures after. Enrichment costs a
   * catalogue round trip per barcode and a local search per barcode-less EPOS
   * line; `useCartEnrichment` fills it in behind this, a batch at a time, and
   * keeps its own answers across navigations too.
   */
  const resource = useCachedResource<OrderList>(
    cacheKeys.orderCart("all", 1),
    () => getOrderList({ enrich: "none" }),
    { onError: (message) => setError(message) },
  );

  const cart = resource.data ?? null;
  const loading = resource.loading;

  /**
   * Prices ride along with the cart, so they are cached with it. The server has
   * already applied its three-hour rule before handing these over — anything
   * here is current enough to show, and a refetch is always in flight behind it.
   */
  useEffect(() => {
    if (!cart) return;
    setPrices(Object.fromEntries((cart.pricing ?? []).map((line) => [line.lineId, line])));
  }, [cart]);

  /** Every write answers with the whole cart, and every answer is cacheable. */
  const setCart = resource.commit;

  const storedLines = useMemo(() => cart?.lines ?? [], [cart]);

  /**
   * The pictures, merged on as they arrive.
   *
   * Held apart from `cart` on purpose: every write — a quantity, a removal —
   * replaces the cart with the server's un-enriched reply, and enrichment kept
   * inside that object would blink out on each tap of the stepper. Kept beside
   * it, it survives every write and is re-applied here.
   */
  const enrichment = useCartEnrichment(storedLines);
  const lines = useMemo(
    () => storedLines.map((line) => withEnrichment(line, enrichment[line.id])),
    [storedLines, enrichment],
  );

  /**
   * ── QUANTITY IS OPTIMISTIC ────────────────────────────────────────────────
   *
   * Same three-part rule as the desktop cart: the number moves at once,
   * a run of taps becomes ONE write, and a per-line sequence number means the
   * LAST INTENT wins rather than whichever response happens to land last.
   * On a phone this matters more, not less — taps arrive faster than a mobile
   * connection answers.
   */
  const [draftCases, setDraftCases] = useState<Record<number, number>>({});
  const flushTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const intent = useRef(new Map<number, number>());

  useEffect(() => {
    const timers = flushTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const changeQuantity = useCallback(
    (line: OrderListLine, next: number) => {
      // ZERO IS NOT A QUANTITY. Removing is a separate, confirmed action.
      const cases = Math.max(1, Math.floor(next));
      if (cases === (draftCases[line.id] ?? line.cases)) return;

      setDraftCases((current) => ({ ...current, [line.id]: cases }));

      const seq = (intent.current.get(line.id) ?? 0) + 1;
      intent.current.set(line.id, seq);

      const existing = flushTimers.current.get(line.id);
      if (existing) clearTimeout(existing);

      flushTimers.current.set(
        line.id,
        setTimeout(() => {
          flushTimers.current.delete(line.id);

          void setOrderListCases(line.id, cases)
            .then((updated) => {
              if (intent.current.get(line.id) !== seq) return;
              setCart(updated);
              setDraftCases((current) => {
                const { [line.id]: _settled, ...rest } = current;
                return rest;
              });
            })
            .catch((err) => {
              if (intent.current.get(line.id) !== seq) return;
              setDraftCases((current) => {
                const { [line.id]: _failed, ...rest } = current;
                return rest;
              });
              setError(
                err instanceof Error && err.message
                  ? `Couldn't update quantity: ${err.message}`
                  : "Couldn't update quantity. Please try again.",
              );
            });
        }, QUANTITY_FLUSH_MS),
      );
    },
    [draftCases],
  );

  const removeLines = useCallback(
    async (ids: readonly number[]) => {
      setBusy("remove");
      setError(null);
      try {
        // Sequential, not `Promise.all`: each DELETE returns the whole cart and
        // the last response is the one kept. Racing them means keeping whichever
        // reply happened to be slowest, which can be a cart still holding a line
        // a later call removed.
        let latest: OrderList | null = null;
        for (const id of ids) latest = await removeOrderListLine(id);
        if (latest) setCart(latest);

        setPrices((current) => {
          const next = { ...current };
          for (const id of ids) delete next[id];
          return next;
        });
        setOpenLineId(null);
        setSelection(null);
        setNotice(ids.length === 1 ? "Product removed" : `${ids.length} products removed`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove that");
      } finally {
        setBusy(null);
        setPendingRemoval(null);
      }
    },
    [],
  );

  const onFile = useCallback(async (file: File) => {
    setBusy("import");
    setError(null);
    try {
      const isSpreadsheet = /\.xlsx?$/i.test(file.name);
      const result = isSpreadsheet
        ? await importOrderListEpos(await toBase64(file), file.name)
        : await importOrderListCsv(await file.text(), file.name);
      setCart(result.list);
      setSkipped(result.skipped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(null);
    }
  }, []);

  const gate = useSupplierGate();

  const compare = useCallback(async () => {
    if (!gate.guard()) return;
    setBusy("compare");
    setError(null);
    try {
      const { jobId } = await compareOrderCart();
      router.push(`/jobs/${encodeURIComponent(jobId)}`);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Could not start the comparison",
      );
      setBusy(null);
    }
  }, [gate, router]);

  const fetchPrices = useCallback(async () => {
    if (!gate.guard()) return;
    setBusy("prices");
    setError(null);
    setNotice(null);
    try {
      const { prices: result } = await fetchOrderCartPrices();
      setPrices((current) => {
        const next = { ...current };
        for (const line of result.lines) next[line.lineId] = line;
        return next;
      });
      setNotice(
        `${result.pricedSkus} of ${result.requestedSkus} supplier products quoted` +
          (result.skippedLines > 0 ? ` · ${result.skippedLines} already up to date` : ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch prices");
    } finally {
      setBusy(null);
    }
  }, [gate]);

  // ── What the chips count, and what the list shows ────────────────────────

  const matchesFilter = useCallback(
    (line: OrderListLine, id: FilterId): boolean => {
      if (id === "all") return true;
      if (id === "not_priced") return !prices[line.id]?.pricedAt;
      return Boolean(line.sources?.some((entry) => entry.source === id));
    },
    [prices],
  );

  const counts = useMemo(() => {
    const result: Record<FilterId, number> = { all: 0, not_priced: 0, order_list: 0, scan: 0 };
    for (const line of lines) {
      for (const entry of FILTERS) {
        if (matchesFilter(line, entry.id)) result[entry.id] += 1;
      }
    }
    return result;
  }, [lines, matchesFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter(
      (line) => matchesFilter(line, filter) && (needle === "" || haystack(line).includes(needle)),
    );
  }, [lines, filter, query, matchesFilter]);

  /**
   * ── TEN AT A TIME, SLICED HERE RATHER THAN ASKED FOR ──────────────────────
   *
   * The cart is still fetched whole — that is what lets the search and the
   * chips cover all 214 products rather than the ten on screen. Paginating the
   * REQUEST would undo that: typing "nutella" would answer "nothing matches"
   * for a product sitting on page nine.
   *
   * So the list is sliced after filtering. Ten matches the desktop's page size
   * and the batch size a job emits, so one batch is one screen everywhere.
   *
   * `resetKey` returns to page one whenever the list changes MEANING — a new
   * search, a different chip. Without it, searching while on page four shows
   * page four of the new results, which reads as the search having found
   * something unrelated.
   */
  const paged = usePagination(visible, { resetKey: `${filter}:${query.trim()}` });

  const openLine = openLineId === null ? undefined : lines.find((line) => line.id === openLineId);

  const selected = selection ?? new Set<number>();
  const toggleSelected = (id: number) => {
    setSelection((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalCases = lines.reduce((sum, line) => sum + (draftCases[line.id] ?? line.cases), 0);

  return (
    <div className="lg:hidden">
      {gate.modal}

      {/* ── Header ──────────────────────────────────────────────────────────
          In select mode the title becomes the count and the only way out is
          Cancel, so a half-made selection can never be lost to a stray tap. */}
      <div className="flex min-h-9 items-center justify-between gap-3">
        {selection ? (
          <>
            <p className="text-[16px] font-semibold text-ink">
              {selected.size} selected
            </p>
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="text-[13.5px] font-medium text-link"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <h1 className="text-[18px] font-semibold tracking-tight text-ink">
              Order cart{" "}
              <span className="tabular-nums text-ink-faint">
                ({loading ? "…" : lines.length})
              </span>
            </h1>
            {lines.length > 0 && (
              <button
                type="button"
                onClick={() => setSelection(new Set())}
                className="text-[13.5px] font-medium text-link"
              >
                Select
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Search ──────────────────────────────────────────────────────────
          Cancel appears only once the box is in use. A permanent Cancel beside
          an empty search box is a control that undoes nothing. */}
      {lines.length > 0 && !selection && !loading && (
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
              <SearchGlyph />
            </span>
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearching(true)}
              placeholder="Search products…"
              aria-label="Search products in your cart"
              // text-[16px]: anything smaller makes iOS Safari zoom the page on
              // focus, and it never zooms back out.
              className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-[16px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  searchInput.current?.focus();
                }}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint hover:bg-canvas"
              >
                ✕
              </button>
            )}
          </div>

          {(searching || query) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSearching(false);
                searchInput.current?.blur();
              }}
              className="shrink-0 text-[13.5px] font-medium text-link"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* ── Filter chips ────────────────────────────────────────────────────
          Horizontally scrollable rather than wrapped: four chips fit a phone
          at most sizes, and a wrapped second row moves the list down the screen
          every time a count grows a digit. */}
      {lines.length > 0 && !selection && !loading && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((entry) => {
            const active = filter === entry.id;
            return (
              <motion.button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                aria-pressed={active}
                whileTap={{ scale: 0.94 }}
                transition={{ duration: 0.12 }}
                className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-ink text-canvas"
                    : "border border-line bg-surface text-ink-soft hover:bg-canvas"
                }`}
              >
                {entry.label}{" "}
                <span className="tabular-nums opacity-70">{counts[entry.id]}</span>
              </motion.button>
            );
          })}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-[12.5px] text-link">
          {notice}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-900">
          <p className="font-medium">
            {skipped.length} row{skipped.length === 1 ? "" : "s"} could not be read
          </p>
          <ul className="mt-1 space-y-0.5">
            {skipped.slice(0, 5).map((row, index) => (
              <li key={`${row.barcode}-${index}`}>
                {row.barcode || "(blank barcode)"} — {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── The list ────────────────────────────────────────────────────── */}
      {loading ? (
        <MobileCartSkeleton />
      ) : lines.length === 0 ? (
        <EmptyCart onImport={() => fileInput.current?.click()} busy={busy === "import"} />
      ) : visible.length === 0 ? (
        <div className="py-14 text-center">
          <p className="text-[13.5px] font-medium text-ink">Nothing matches</p>
          <p className="mx-auto mt-1 max-w-[260px] text-[12.5px] text-ink-soft">
            {query
              ? `No product in your cart matches “${query.trim()}”.`
              : "No product in your cart is in this filter."}
          </p>
        </div>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
          {/*
            ── WHAT ANIMATES, AND WHAT DOES NOT ─────────────────────────────
            
            The exit animation means "this product is gone". A page change, a
            new search or a different chip is not that: it replaces the whole
            set, and animating it would slide ten rows out while ten slide in —
            twenty rows in the list at once, so the page jumps to twice its
            height and back on every Next.
            
            Keying the AnimatePresence on what the set MEANS therefore swaps it
            instantly, because changing the key unmounts the whole presence
            rather than exiting its children one by one. Within one page of one
            search, removing a row still animates — which is the only case the
            animation was ever for.
          */}
          <AnimatePresence
            initial={false}
            key={`${paged.page}:${filter}:${query.trim()}`}
          >
            {paged.items.map((line) => (
              <CartRow
                key={line.id}
                line={line}
                {...(prices[line.id] ? { priced: prices[line.id]! } : {})}
                cases={draftCases[line.id] ?? line.cases}
                pending={draftCases[line.id] !== undefined}
                selectable={selection !== null}
                checked={selected.has(line.id)}
                onToggle={() => toggleSelected(line.id)}
                onOpen={() => setOpenLineId(line.id)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {/* ── The pager ──────────────────────────────────────────────────────
          Its own row, with 44px targets: the desktop control's buttons are
          about 30px tall, which is under what a thumb can hit reliably. Hidden
          entirely on a single page — a control that can only be disabled is
          furniture. */}
      {!loading && paged.pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <motion.button
            type="button"
            onClick={paged.prev}
            disabled={!paged.hasPrev}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface text-[13.5px] font-medium text-ink disabled:opacity-40"
          >
            ← Prev
          </motion.button>

          <span className="shrink-0 px-2 text-center text-[12px] text-ink-soft">
            <span className="nums font-medium text-ink">
              {paged.from}–{paged.to}
            </span>
            <br />
            <span className="nums text-ink-faint">of {paged.total}</span>
          </span>

          <motion.button
            type="button"
            onClick={paged.next}
            disabled={!paged.hasNext}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface text-[13.5px] font-medium text-ink disabled:opacity-40"
          >
            Next →
          </motion.button>
        </div>
      )}

      {/* ── The two price actions ───────────────────────────────────────────
          Not sticky: the bottom of a phone already belongs to the tab bar, and
          a second fixed bar above it eats a third of the list. */}
      {!loading && lines.length > 0 && !selection && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void fetchPrices()}
              disabled={busy !== null}
              className="min-h-11 rounded-xl border border-line bg-surface px-3 text-[13.5px] font-medium text-ink hover:bg-canvas disabled:opacity-50"
            >
              {busy === "prices" ? "Fetching…" : "Fetch live prices"}
            </button>
            <button
              type="button"
              onClick={() => void compare()}
              disabled={busy !== null}
              className="min-h-11 rounded-xl bg-teal-600 px-3 text-[13.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {busy === "compare" ? "Starting…" : "Compare prices"}
            </button>
          </div>

          <p className="mt-2.5 text-center text-[11.5px] text-ink-faint">
            {visible.length === lines.length
              ? `${lines.length} product${lines.length === 1 ? "" : "s"} · ${totalCases} case${totalCases === 1 ? "" : "s"}`
              : `${visible.length} of ${lines.length} products match · ${totalCases} case${totalCases === 1 ? "" : "s"} in the cart`}
          </p>

          <p className="mt-1 text-center text-[11.5px] leading-snug text-ink-faint">
            Both run over the whole cart, not just what is filtered here, and neither puts
            anything into a supplier&apos;s basket.
          </p>
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".xls,.xlsx,.csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
          event.target.value = "";
        }}
      />

      {/* ── Bulk action bar ─────────────────────────────────────────────────
          Fixed above the tab bar, because a selection made at the top of a
          200-line list must stay actionable without scrolling back down. */}
      <AnimatePresence>
        {selection && selected.size > 0 && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.24 }}
            className="fixed inset-x-0 bottom-14 z-40 border-t border-line bg-surface/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur"
          >
            <motion.button
              type="button"
              onClick={() => setPendingRemoval([...selected])}
              disabled={busy !== null}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="mx-auto flex min-h-11 w-full max-w-lg items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 text-[13.5px] font-semibold text-red-600 disabled:opacity-50"
            >
              Delete ({selected.size})
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AnimatePresence is what makes the exit animations run at all — without
          it React unmounts the sheet the instant `openLine` goes away and the
          slide-down never plays. */}
      <AnimatePresence>
        {openLine && (
          <ProductDetailSheet
            line={openLine}
            {...(prices[openLine.id] ? { priced: prices[openLine.id]! } : {})}
            cases={draftCases[openLine.id] ?? openLine.cases}
            pending={draftCases[openLine.id] !== undefined}
            title={titleOf(openLine)}
            {...identityOf(openLine)}
            {...(packOf(openLine) ? { packText: packOf(openLine) } : {})}
            badges={<PriceState priced={prices[openLine.id]} />}
            onQuantity={(cases) => changeQuantity(openLine, cases)}
            onRemove={() => setPendingRemoval([openLine.id])}
            onClose={() => setOpenLineId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingRemoval && (
          <ConfirmDialog
            title={pendingRemoval.length === 1 ? "Remove this item?" : `Remove ${pendingRemoval.length} items?`}
            body={
            pendingRemoval.length === 1 ? (
              <>
                This will remove{" "}
                <span className="font-medium text-ink">
                  {titleOf(lines.find((line) => line.id === pendingRemoval[0]) ?? ({} as OrderListLine))}
                </span>{" "}
                from your cart.
              </>
            ) : (
              "They will be removed from your cart."
            )
          }
            confirmLabel="Remove"
            busy={busy === "remove"}
            onConfirm={() => void removeLines(pendingRemoval)}
            onCancel={() => setPendingRemoval(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CartRow({
  line,
  priced,
  cases,
  pending,
  selectable,
  checked,
  onToggle,
  onOpen,
}: {
  line: OrderListLine;
  priced?: PricedCartLine;
  cases: number;
  pending: boolean;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const title = titleOf(line);
  const { identity, identityLabel } = identityOf(line);
  const pack = packOf(line);

  /**
   * THE WHOLE ROW IS THE TARGET, not a chevron at the end of it. On a phone the
   * chevron is a 24px target inside a 76px row, and missing it does nothing —
   * which reads as the app having ignored the tap.
   *
   * In select mode the same row toggles the checkbox instead. Two meanings for
   * one tap is a real cost, but the alternative — a separate hit area for
   * selection — puts two targets a few millimetres apart.
   */
  return (
    <motion.li
      /**
       * Exit is the one that earns its keep: a removed product slides out to
       * the left, which is the difference between "it is gone" and "did that
       * tap do anything?". Entry is a plain fade, because rows appear in
       * batches when a filter changes and a batch of sliding rows is noise.
       */
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -32, transition: { duration: 0.18, ease: "easeIn" } }}
      transition={{ duration: 0.18 }}
      className="border-b border-line last:border-b-0"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={selectable ? onToggle : onOpen}
          aria-label={selectable ? `Select ${title}` : `Open ${title}`}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left active:bg-canvas"
        >
          {selectable && (
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                checked ? "border-teal-600 bg-teal-600 text-white" : "border-line bg-surface"
              }`}
            >
              {checked && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </span>
          )}

          {/* The picture arrives after the list does, so the box is reserved
              at its final size and the image fades in when it lands. */}
          <ProductThumb {...(line.imageUrl ? { src: line.imageUrl } : {})} size={52} />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-snug text-ink">
              {title}
            </span>
            {identity && (
              <span className="mt-0.5 block truncate text-[11px] tabular-nums text-ink-soft">
                {identityLabel} {identity}
              </span>
            )}
            {pack && <span className="mt-0.5 block truncate text-[11px] text-ink-faint">{pack}</span>}
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <PriceState priced={priced} />
              {line.sources?.slice(0, 1).map((source) => (
                <span
                  key={source.source}
                  className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-soft"
                >
                  {source.source === "scan"
                    ? "Scan"
                    : source.source === "order_list"
                      ? "Order list"
                      : "Search"}
                </span>
              ))}
            </span>
          </span>
        </button>

        {/* The quantity, tappable on its own. Opens the sheet, where there is
            room for a proper stepper — a −/+ pair here would sit 8px from the
            row's own tap target. */}
        {!selectable && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${cases} case${cases === 1 ? "" : "s"} of ${title}. Change quantity`}
            className="flex shrink-0 items-center gap-1 pr-3 active:bg-canvas"
          >
            <span
              aria-hidden="true"
              className={`flex h-8 min-w-[34px] items-center justify-center rounded-lg border px-1.5 text-[13px] font-semibold tabular-nums ${
                pending ? "border-line text-ink-soft opacity-70" : "border-line text-ink"
              }`}
            >
              {cases}
            </span>
            <span aria-hidden="true" className="text-ink-faint">
              <ChevronGlyph />
            </span>
          </button>
        )}
      </div>
    </motion.li>
  );
}

/** Where this line stands, in one word a retailer can act on. */
function PriceState({ priced }: { priced?: PricedCartLine }) {
  if (priced && !priced.priceable) return <Chip tone="quiet">Cannot be priced</Chip>;
  if (!priced?.pricedAt) return <Chip tone="quiet">Not priced</Chip>;
  if (priced.offers.length === 0) return <Chip tone="quiet">No offer</Chip>;
  if (priced.coverage && priced.coverage.priced === 0) return <Chip tone="warn">Pricing failed</Chip>;

  return (
    <Chip tone="good">
      Priced {new Date(priced.pricedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </Chip>
  );
}

function Chip({ tone, children }: { tone: "good" | "warn" | "quiet"; children: React.ReactNode }) {
  const styles = {
    good: "bg-good-50 text-good-600",
    warn: "bg-amber-50 text-amber-800",
    quiet: "bg-canvas text-ink-faint",
  } as const;

  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[tone]}`}>{children}</span>;
}

/**
 * What the cart looks like while it is still arriving.
 *
 * ── A SHAPE, NOT A WORD ─────────────────────────────────────────────────────
 *
 * "Loading…" tells a retailer that something is happening and nothing about
 * what. Bars in the shape of the real rows say "a list of products is coming",
 * and — because they occupy the same height as the rows that replace them —
 * the screen does not jump when it lands. A page that reflows on arrival reads
 * as a glitch even when it was fast.
 *
 * IT INCLUDES THE SEARCH BOX AND THE CHIPS, which is the part that is easy to
 * miss: both are hidden until there are lines, so a load used to paint an empty
 * band above the list and then push everything down by about 90px the moment
 * the cart arrived. Standing in for them here is what keeps that still.
 *
 * ── HOW MANY ROWS ───────────────────────────────────────────────────────────
 *
 * Six: roughly a phone's worth. Filling the viewport exactly would mean
 * measuring it, and a skeleton that scrolls is a skeleton pretending to be
 * content.
 *
 * `aria-hidden` on the bars with a live status beside them: a screen reader
 * should hear "loading your cart", not six empty list items. The pulse sits on
 * the wrapper so every bar breathes in time — independently pulsing blocks read
 * as noise.
 */
function MobileCartSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading your cart…
      </span>

      <div aria-hidden="true" className="animate-pulse">
        {/* The search row. */}
        <div className="mt-3 h-11 rounded-xl bg-canvas" />

        {/* The filter chips, at the widths the real four sit at. */}
        <div className="mt-3 flex gap-2">
          {[64, 92, 84, 62].map((width) => (
            <div key={width} className="h-9 rounded-full bg-canvas" style={{ width }} />
          ))}
        </div>

        <ul className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <li key={row} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
              {/* The thumbnail, at the size the real one reserves. */}
              <div className="h-[52px] w-[52px] shrink-0 rounded-lg bg-canvas" />

              <div className="min-w-0 flex-1">
                {/* Uneven title widths, so it reads as product names rather
                    than as a bar chart. */}
                <div
                  className="h-3 rounded bg-canvas"
                  style={{ width: `${[72, 58, 66, 48, 63, 55][row]}%` }}
                />
                <div className="mt-1.5 h-2.5 w-28 rounded bg-canvas" />
                <div className="mt-1.5 h-2.5 w-16 rounded bg-canvas" />
                <div className="mt-2 h-4 w-20 rounded bg-canvas" />
              </div>

              {/* The quantity box and its chevron. */}
              <div className="flex shrink-0 items-center gap-1">
                <div className="h-8 w-[34px] rounded-lg bg-canvas" />
                <div className="h-4 w-3 rounded bg-canvas" />
              </div>
            </li>
          ))}
        </ul>

        {/* The two price buttons. */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="h-11 rounded-xl bg-canvas" />
          <div className="h-11 rounded-xl bg-canvas" />
        </div>
      </div>
    </>
  );
}

function EmptyCart({ onImport, busy }: { onImport: () => void; busy: boolean }) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-12 text-center">
      <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-canvas text-ink-faint">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="20" r="1.4" />
          <circle cx="18" cy="20" r="1.4" />
          <path d="M2 3h3l2.4 12.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.3L21 7H6" />
        </svg>
      </span>

      <p className="mt-4 text-[15px] font-semibold text-ink">Your cart is empty</p>
      <p className="mt-1 max-w-[250px] text-[12.5px] leading-snug text-ink-soft">
        Scan products or import a file to get started.
      </p>

      <Link
        href="/scan?camera=1"
        className="mt-5 flex min-h-11 w-full max-w-[260px] items-center justify-center rounded-xl bg-emerald-600 px-4 text-[14px] font-semibold text-white hover:bg-emerald-700"
      >
        Scan products
      </Link>
      <button
        type="button"
        onClick={onImport}
        disabled={busy}
        className="mt-2 flex min-h-11 w-full max-w-[260px] items-center justify-center rounded-xl border border-line bg-surface px-4 text-[14px] font-medium text-ink hover:bg-canvas disabled:opacity-50"
      >
        {busy ? "Reading…" : "Import file"}
      </button>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
