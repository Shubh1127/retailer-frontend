"use client";

/**
 * The order cart — everything the retailer is buying, however they collected it.
 *
 * WHAT THIS PAGE IS
 *
 * One basket, filled from three places today: a spreadsheet import, a barcode
 * scanner, and a product search (the dashboard's quick search and the full
 * product-search page both feed it). Before this it was the Order list, which
 * could only be filled from a file — the store is the same one, extended,
 * rather than a second cart beside it.
 *
 * A PRODUCT IS ONE LINE, WHATEVER FOUND IT
 *
 * Scanning a barcode and later finding the same product in a search does not
 * make two rows. It makes one row with two origins, and the tabs are a filter
 * over those origins rather than over a column on the line. That is why a
 * product can appear under both Scan and Order list and be counted once under
 * All products — and why the origin is read from the database rather than
 * guessed from which screen was open.
 *
 * TWO PRICE ACTIONS, DELIBERATELY
 *
 *   Compare prices      the full pipeline: allocation, savings against the
 *                       retailer's own cost, alternatives. Minutes for a week's
 *                       list, and it leaves the cart exactly as it was.
 *   Fetch live prices   what each wholesaler charges for these exact products
 *                       right now. Seconds, cheapest wins, no allocation.
 *
 * They answer different questions and collapsing them would make one of the
 * two unaskable.
 *
 * COMPARING DOES NOT EMPTY THE CART. The old order list closed itself on
 * submit — it was a file you sent, and it ended at the job it became. A
 * basket collected over a week is not spent by asking a question of it, so
 * nothing here clears, closes or submits anything.
 *
 * NOTHING ON THIS PAGE CONTACTS A SUPPLIER except the two buttons above.
 * Loading, importing, editing a quantity and removing a line are all local.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AppShell from "@/components/AppShell";
import MobileOrderCart from "@/components/MobileOrderCart";
import NavIcon from "@/components/NavIcons";
import { useSupplierGate } from "@/components/SupplierGate";
import Pagination, { PAGE_SIZE } from "@/components/Pagination";
import { ApiError } from "@/lib/api/client";
import ProductResultCard from "@/components/ProductResultCard";
import { viewFromCartLine } from "@/lib/productResult";
import {
  clearOrderList,
  compareOrderCart,
  fetchOrderCartPrices,
  getOrderList,
  importOrderListCsv,
  importOrderListEpos,
  removeOrderListLine,
  setOrderListCases,
  type OrderCartSource,
  type OrderList,
  type OrderListLine,
  type PricedCartLine,
  type SkippedRow,
} from "@/lib/api/orderList";
import { addItems, cartSupplierLabel, supportsCart, type CartSupplier } from "@/lib/api/cart";
import { toBase64 } from "@/lib/fileEncoding";
import { cacheKeys } from "@/lib/sessionCache";
import { useCartEnrichment, withEnrichment } from "@/lib/useCartEnrichment";
import { useCachedResource } from "@/lib/useCachedResource";
import { useIsMobile } from "@/lib/useMediaQuery";

/**
 * The tabs, and what each one asks of a line.
 *
 * THREE, NOT FIVE. All products, and the two ways a retailer actually thinks
 * about where something came from: off their sheet, or off the scanner. The
 * other origins — a product search, the dashboard's search — are stored
 * distinctly and each carries its own chip, but neither has earned a tab: a
 * filter nobody reaches for is a control that costs width.
 */
const QUANTITY_FLUSH_MS = 400;

type TabId = "all" | "order_list" | "scan";

function cartSignature(lines: readonly OrderListLine[]): string {
  return lines.map((line) => `${line.id}:${line.lineKey}:${line.cases}`).sort().join("|");
}

const TABS: { id: TabId; label: string; source?: OrderCartSource }[] = [
  { id: "all", label: "All products" },
  { id: "order_list", label: "Order list", source: "order_list" },
  { id: "scan", label: "Scan", source: "scan" },
];

function titleOf(line: OrderListLine): string {
  return (
    line.description?.trim() ||
    line.gtin14 ||
    line.articleCode ||
    line.scannedCode ||
    "Unnamed product"
  );
}

// ---------------------------------------------------------------------------

export default function OrderCartPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * WHICH CART THIS IS, and only ever one of them.
   *
   * Rendering both and letting `lg:hidden` choose would mount two carts, and
   * each owns its own fetch, its own optimistic quantity drafts and its own
   * debounce timers. Two writers for one quantity is a race nobody can debug
   * from a phone, so the viewport decides which one exists.
   */
  const isMobile = useIsMobile();

  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  const [page, setPage] = useState(1);

  /**
   * `/order-cart?tab=order_list` — arriving from elsewhere with a tab already
   * chosen. The flag is consumed and stripped, so coming back to
   * `/order-cart` from the nav lands on All products rather than reopening a
   * tab somebody had left.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("tab");
    if (!wanted) return;

    if (TABS.some((entry) => entry.id === wanted)) setTab(wanted as TabId);
    window.history.replaceState(null, "", "/order-cart");
  }, []);

  /** Live prices, by line id. Empty until somebody presses the button. */
  const [prices, setPrices] = useState<Record<number, PricedCartLine>>({});
  const [addedQuantities, setAddedQuantities] = useState<Record<number, number>>({});
  const [comparedSignature, setComparedSignature] = useState<string | null>(null);

  /**
   * ── THIS PAGE OF THE CART, REMEMBERED FOR THE LENGTH OF THIS TAB ──────────
   *
   * Keyed by tab AND page, so switching either shows that view's own rows
   * rather than the last one's while the new ones load.
   *
   * `enabled` is the guard that used to be an early `return` inside the effect:
   * the desktop tree's hooks still run on a phone — hooks cannot be conditional
   * — and without it every phone load would fetch a page of a cart that
   * `MobileOrderCart` is already fetching in full. `matchMedia` is read as well
   * as `isMobile` because the hook starts false on the first commit by design,
   * and the dependency keeps a desktop window resized narrow and back working.
   */
  const onDesktop =
    !isMobile &&
    (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches);

  /**
   * One reader for this page of the cart.
   *
   * `passive` travels because it is not decoration: it marks a read caused by
   * something OTHER than the person at this screen, so an unattended iPad does
   * not keep its own session alive on another device's activity. Both the
   * background revalidation and the re-read after a basket write go through
   * here, so neither can drift from the other's parameters.
   *
   * The order now, the pictures after — see `useCartEnrichment`. A page is only
   * ten lines, but those ten still cost ten catalogue lookups before anything
   * could be drawn.
   */
  const fetchCartPage = useCallback(
    (opts: { passive?: boolean } = {}) => {
      const source = TABS.find((entry) => entry.id === tab)?.source;
      return getOrderList({
        ...opts,
        ...(source ? { source } : {}),
        page,
        pageSize: PAGE_SIZE,
        enrich: "none",
      });
    },
    [tab, page],
  );

  const resource = useCachedResource<OrderList>(
    cacheKeys.orderCart(tab, page),
    () => fetchCartPage(),
    { enabled: onDesktop, onError: (message) => setError(message) },
  );

  const cart = resource.data ?? null;
  const loading = resource.loading;
  /** Every write answers with the whole cart, and every answer is cacheable. */
  const setCart = resource.commit;

  /**
   * PRICES RIDE ALONG WITH THE CART, so they are cached with it. The server
   * applies the three-hour rule before handing these over, so anything here is
   * current enough to show and a refetch is always in flight behind it.
   */
  useEffect(() => {
    if (!cart) return;
    setPrices(Object.fromEntries((cart.pricing ?? []).map((line) => [line.lineId, line])));
  }, [cart]);

  const run = useCallback(async (key: string, work: () => Promise<OrderList>) => {
    setBusy(key);
    setError(null);
    try {
      setCart(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
    } finally {
      setBusy(null);
    }
  }, []);

  /**
   * ── QUANTITY IS OPTIMISTIC ────────────────────────────────────────────────
   *
   * The number changes immediately and the write follows.
   *
   *   `draftCases`   the quantity the buyer has ASKED for, per line.
   *   `flushTimers`  a run of presses is ONE write.
   *   `intent`       a per-line sequence number so the LAST INTENT wins
   *                  rather than the last response.
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
      // ZERO IS NOT A QUANTITY. The cart refuses it everywhere.
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

  /**
   * GATED AT COMPARE, NOT AT IMPORT.
   */
  const gate = useSupplierGate();
  const storedLines = useMemo(() => cart?.lines ?? [], [cart]);

  /** Merged on as it arrives, and kept outside `cart` so writes cannot clear it. */
  const enrichment = useCartEnrichment(storedLines);
  const lines = useMemo(
    () => storedLines.map((line) => withEnrichment(line, enrichment[line.id])),
    [storedLines, enrichment],
  );
  const currentSignature = useMemo(() => cartSignature(lines), [lines]);

  useEffect(() => {
    if (!currentSignature) {
      setComparedSignature(null);
      return;
    }
    setComparedSignature(
      window.localStorage.getItem("retailcompare:compared-cart") === currentSignature
        ? currentSignature
        : null,
    );
  }, [currentSignature]);

  const compare = useCallback(async () => {
    if (!gate.guard()) return;

    setBusy("compare");
    setError(null);
    try {
      const { jobId } = await compareOrderCart();
      window.localStorage.setItem("retailcompare:compared-cart", currentSignature);
      setComparedSignature(currentSignature);
      router.push(`/jobs/${encodeURIComponent(jobId)}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not start the comparison",
      );
      setBusy(null);
    }
  }, [router, gate, currentSignature]);

  const addAllToBaskets = useCallback(async () => {
    const bySupplier = new Map<
      string,
      { sku: string; quantity: number; name?: string; gtin14?: string; articleCode?: string; scannedCode?: string; isSingle?: boolean }[]
    >();
    // Only the rows currently loaded are actionable here — the button is
    // explicitly page-scoped.
    const targetLines = lines;

    for (const line of targetLines) {
      const priced = prices[line.id];
      if (!priced?.best || !supportsCart(priced.best.supplierId)) continue;
      const alreadyAdded = addedQuantities[line.id] ?? 0;
      const quantity = line.cases - alreadyAdded;
      if (quantity <= 0) continue;
      const items = bySupplier.get(priced.best.supplierId) ?? [];
      items.push({
        sku: priced.best.supplierSku,
        quantity,
        ...(line.description ? { name: line.description } : {}),
        // The line's OWN identity, so the backend can find and remove this
        // same line from the central cart once the add succeeds.
        ...(line.gtin14 ? { gtin14: line.gtin14 } : {}),
        ...(line.articleCode ? { articleCode: line.articleCode } : {}),
        ...(line.scannedCode ? { scannedCode: line.scannedCode } : {}),
        ...(line.isSingle ? { isSingle: true } : {}),
      });
      bySupplier.set(priced.best.supplierId, items);
    }

    setBusy("add");
    setError(null);
    try {
      let added = 0;
      let failed = 0;
      const acceptedLineIds = new Set<number>();
      for (const [supplierId, items] of bySupplier) {
        const result = await addItems(items, supplierId as CartSupplier);
        added += result.added + result.updated;
        failed += result.failed;
        const acceptedSkus = new Set(
          result.results
            .filter((entry) => entry.outcome === "added" || entry.outcome === "updated")
            .map((entry) => entry.sku),
        );
        for (const line of targetLines) {
          const best = prices[line.id]?.best;
          if (best?.supplierId === supplierId && acceptedSkus.has(best.supplierSku)) {
            acceptedLineIds.add(line.id);
          }
        }
      }
      for (const lineId of acceptedLineIds) {
        await removeOrderListLine(lineId);
      }
      if (acceptedLineIds.size > 0) {
        setCart(await fetchCartPage({ passive: true }));
      }
      setNotice(
        `${added} line${added === 1 ? "" : "s"} sent to supplier baskets${failed ? `, ${failed} failed` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the baskets");
    } finally {
      setBusy(null);
    }
  }, [lines, prices, addedQuantities, fetchCartPage, setCart]);

  const addLineToBasket = useCallback(
    async (line: OrderListLine) => {
      const priced = prices[line.id];
      if (!priced?.best || !supportsCart(priced.best.supplierId)) return;
      const alreadyAdded = addedQuantities[line.id] ?? 0;
      const quantity = line.cases - alreadyAdded;
      if (quantity <= 0) return;

      setBusy(`add-${line.id}`);
      setError(null);
      try {
        const result = await addItems(
          [
            {
              sku: priced.best.supplierSku,
              quantity,
              ...(line.description ? { name: line.description } : {}),
              ...(line.gtin14 ? { gtin14: line.gtin14 } : {}),
              ...(line.articleCode ? { articleCode: line.articleCode } : {}),
              ...(line.scannedCode ? { scannedCode: line.scannedCode } : {}),
              ...(line.isSingle ? { isSingle: true } : {}),
            },
          ],
          priced.best.supplierId as CartSupplier,
        );
        const accepted = result.results.some(
          (entry) => entry.outcome === "added" || entry.outcome === "updated",
        );
        if (accepted) {
          await removeOrderListLine(line.id);
          setCart(await fetchCartPage({ passive: true }));
        }
        setNotice(
          `${result.added + result.updated} line${result.added + result.updated === 1 ? "" : "s"} added to ${cartSupplierLabel(priced.best!.supplierId)}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add to the basket");
      } finally {
        setBusy(null);
      }
    },
    [prices, addedQuantities, fetchCartPage, setCart],
  );

  const price = useCallback(async () => {
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

      const needsComparison = result.needsComparisonLines ?? 0;
      const unidentifiable = result.unidentifiableLines ?? Math.max(0, result.unpriceableLines - needsComparison);

      setNotice(
        `Live prices: ${result.pricedSkus} of ${result.requestedSkus} supplier products quoted` +
          (result.skippedLines > 0 ? ` · ${result.skippedLines} already up to date` : "") +
          (needsComparison > 0
            ? ` · ${needsComparison} need Compare prices (no barcode, so they are matched by description)`
            : "") +
          (unidentifiable > 0 ? ` · ${unidentifiable} with nothing to look up` : ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch prices");
    } finally {
      setBusy(null);
    }
  }, [gate]);

  const counts = cart?.sourceCounts ?? { all: lines.length, order_list: 0, scan: 0 };
  const visible = lines;

  const pageInfo = cart?.pagination ?? { page, pageSize: PAGE_SIZE, total: visible.length };
  const pageCount = Math.max(1, Math.ceil(pageInfo.total / pageInfo.pageSize));
  const paged = {
    items: visible,
    page: pageInfo.page,
    pageCount,
    from: pageInfo.total === 0 ? 0 : (pageInfo.page - 1) * pageInfo.pageSize + 1,
    to: Math.min(pageInfo.page * pageInfo.pageSize, pageInfo.total),
    total: pageInfo.total,
    hasPrev: pageInfo.page > 1,
    hasNext: pageInfo.page < pageCount,
    prev: () => setPage((current) => Math.max(1, current - 1)),
    next: () => setPage((current) => Math.min(pageCount, current + 1)),
  };
  const totalCases = visible.reduce((sum, line) => sum + line.cases, 0);
  const compareComplete = Boolean(currentSignature && comparedSignature === currentSignature);
  const basketReady = visible.some((line) => {
    const best = prices[line.id]?.best;
    return Boolean(best && supportsCart(best.supplierId) && line.cases > (addedQuantities[line.id] ?? 0));
  });

  /**
   * Everything above this line is hooks, so the early return cannot change how
   * many of them run. Everything below is the desktop cart.
   */
  if (isMobile) {
    return (
      <AppShell active="Order cart">
        <MobileOrderCart />
      </AppShell>
    );
  }

  return (
    <AppShell active="Order cart">
      {gate.modal}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Order cart</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Everything you&apos;re buying, however you collected it. Nothing is priced until
            you ask.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab !== "scan" && (
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-canvas ${
                busy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {busy === "import" ? "Reading…" : "Import file"}
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
            </label>
          )}

          {tab === "scan" && (
            <Link
              href="/scan"
              className="rounded-md border border-line px-3.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink"
            >
              Search barcode
            </Link>
          )}

          {tab === "scan" && (
            <button
              type="button"
              onClick={() => void price()}
              disabled={busy !== null || lines.length === 0}
              title="Ask each wholesaler what these exact products cost right now. Seconds, no allocation, no savings figures."
              className="rounded-md border border-line px-3.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "prices" ? "Fetching…" : "Fetch live prices"}
            </button>
          )}

          {tab !== "scan" && (
            <button
              type="button"
              onClick={() => void compare()}
              disabled={busy !== null || lines.length === 0 || compareComplete}
              title="Run the full comparison: allocation, savings against your current cost, and alternatives. Your cart stays exactly as it is."
              className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "compare" ? "Starting…" : compareComplete ? "Compared" : "Compare prices"}
            </button>
          )}

          <button
            type="button"
            onClick={() => void addAllToBaskets()}
            disabled={busy !== null || !basketReady}
            className="rounded-md border border-teal-600 px-3.5 py-2 text-[13px] font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "add" ? "Adding…" : "Add all to baskets"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-[13px] text-link">
          {notice}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <p className="font-medium">
            {skipped.length} row{skipped.length === 1 ? "" : "s"} could not be read and{" "}
            {skipped.length === 1 ? "was" : "were"} left out
          </p>
          <ul className="mt-1 space-y-0.5">
            {skipped.slice(0, 8).map((row, index) => (
              <li key={`${row.barcode}-${index}`}>
                {row.barcode || "(blank barcode)"}
                {row.description ? ` · ${row.description}` : ""} — {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Tabs ---- */}
      <div className="mt-5 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface p-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setPage(1);
              setTab(entry.id);
            }}
            aria-current={tab === entry.id ? "true" : undefined}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
              tab === entry.id ? "bg-teal-50 text-link" : "text-ink-soft hover:text-ink"
            }`}
          >
            {entry.label}{" "}
            <span className="tabular-nums opacity-70">{counts[entry.id]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <p className="text-[13.5px] font-medium text-ink">
            {loading
              ? "Loading…"
              : `${paged.total} product${paged.total === 1 ? "" : "s"} · ${totalCases} case${
                  totalCases === 1 ? "" : "s"
                } on this page`}
          </p>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPrices({});
                setAddedQuantities({});
                window.localStorage.removeItem("retailcompare:compared-cart");
                setComparedSignature(null);
                void run("clear", clearOrderList);
              }}
              disabled={busy !== null}
              title="Empty the whole cart, not just this view"
              className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-canvas disabled:opacity-50"
            >
              {busy === "clear" ? "Clearing…" : "Clear cart"}
            </button>
          )}
        </div>

        {loading ? (
          <CartSkeleton />
        ) : visible.length === 0 ? (
          <EmptyView tab={tab} onImport={() => fileInput.current?.click()} />
        ) : (
          <ul className="divide-y divide-line">
            {paged.items.map((line) => (
              <CartRow
                key={line.id}
                line={line}
                {...(prices[line.id] ? { priced: prices[line.id]! } : {})}
                cases={draftCases[line.id] ?? line.cases}
                pending={draftCases[line.id] !== undefined}
                busy={busy !== null}
                fetching={busy === "prices"}
                onQuantity={(cases) => changeQuantity(line, cases)}
                basketMode={Boolean(prices[line.id]?.best)}
                addedQuantity={addedQuantities[line.id] ?? 0}
                onAdd={() => void addLineToBasket(line)}
                onRemove={() => void run(`del-${line.id}`, () => removeOrderListLine(line.id))}
              />
            ))}
          </ul>
        )}

        <Pagination paged={paged} label="products" />
      </div>

      {tab !== "scan" && (
        <dl className="mt-4 grid gap-2 text-[11.5px] text-ink-faint sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink-soft">Compare prices</dt>
            <dd className="mt-0.5">
              The full run: every connected supplier, allocation, and savings against your
              current cost. Takes minutes on a big cart and opens as a job you can come back
              to. Its result is the one to order from.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-soft">Fetch live prices</dt>
            <dd className="mt-0.5">
              A quick look: what each wholesaler charges for these exact products right now,
              cheapest first. No allocation and no savings figures — useful for checking a
              price, not for placing the week&apos;s order.
            </dd>
          </div>
        </dl>
      )}

      {tab !== "scan" && (
        <p className="mt-3 text-[11.5px] text-ink-faint">
          Both leave this cart exactly as it is. Until you press one, nothing here has been
          shown to any supplier — and neither puts anything into a supplier&apos;s basket.
        </p>
      )}
    </AppShell>
  );
}

/**
 * The cart's shape while it is still arriving.
 *
 * A skeleton of the REAL row rather than the word "Loading": the 76px
 * thumbnail, the identity block, and the four supplier columns that
 * `ProductResultCard` draws. Matching the height is the point — this card used
 * to render as an empty bordered box that filled in all at once, which moved
 * everything below it.
 *
 * Four rows rather than the ten a page holds. Ten screenfuls of grey bars
 * overstates how long this takes and turns a fast load into something that
 * looks broken.
 */
function CartSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading your order cart…
      </span>

      <div aria-hidden="true" className="animate-pulse divide-y divide-line">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-start gap-3 p-3">
            <div className="h-[76px] w-[76px] shrink-0 rounded-lg bg-canvas" />

            <div className="min-w-0 flex-1">
              <div
                className="h-3.5 rounded bg-canvas"
                style={{ width: `${[78, 62, 70, 55][row]}%` }}
              />
              <div className="mt-2 h-2.5 w-32 rounded bg-canvas" />
              <div className="mt-1.5 h-2.5 w-20 rounded bg-canvas" />
              <div className="mt-2 h-4 w-24 rounded bg-canvas" />
            </div>

            {/* The four supplier columns. */}
            <div className="grid min-w-0 flex-[2.6] grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((column) => (
                <div key={column} className="rounded-md border border-line bg-canvas/40 px-2 py-1.5">
                  <div className="h-2.5 w-12 rounded bg-canvas" />
                  <div className="mt-2 h-3 w-10 rounded bg-canvas" />
                </div>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <div className="h-7 w-7 rounded-md bg-canvas" />
              <div className="h-7 w-10 rounded-md bg-canvas" />
              <div className="h-7 w-7 rounded-md bg-canvas" />
              <div className="ml-2 h-8 w-8 rounded-lg bg-canvas" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * What an empty view says, which depends on WHY it is empty.
 */
function EmptyView({ tab, onImport }: { tab: TabId; onImport: () => void }) {
  if (tab === "scan") {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-[13.5px] font-medium text-ink">Nothing scanned yet</p>
        <p className="max-w-sm text-[12.5px] text-ink-soft">
          Products you scan on the shop floor land here. Everything else in the cart is
          still under All products.
        </p>
      </div>
    );
  }

  if (tab === "order_list") {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-[13.5px] font-medium text-ink">Nothing imported yet</p>
        <p className="max-w-sm text-[12.5px] text-ink-soft">
          Import your EPOS Article Order Listing (.xls or .xlsx), or a CSV with a barcode
          column and a case-quantity column.
        </p>
        <button
          type="button"
          onClick={onImport}
          className="mt-2 rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas"
        >
          Import file
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-[13.5px] font-medium text-ink">This cart is empty</p>
      <p className="max-w-sm text-[12.5px] text-ink-soft">
        Scan a product, search for one, or import your order file. Importing twice adds the
        quantities together.
      </p>
      <button
        type="button"
        onClick={onImport}
        className="mt-2 rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas"
      >
        Import file
      </button>
    </div>
  );
}

function CartRow({
  line,
  priced,
  cases,
  pending,
  busy,
  fetching,
  onQuantity,
  onRemove,
  basketMode,
  addedQuantity,
  onAdd,
}: {
  line: OrderListLine;
  priced?: PricedCartLine;
  cases: number;
  pending: boolean;
  busy: boolean;
  fetching: boolean;
  onQuantity: (cases: number) => void;
  onRemove: () => void;
  basketMode: boolean;
  addedQuantity: number;
  onAdd: () => void;
}) {
  const view = viewFromCartLine(line, priced);
  const bestSupplier = priced?.best ? cartSupplierLabel(priced.best.supplierId) : undefined;

  return (
    <li className="p-3">
      <ProductResultCard
        view={view}
        badge={<PriceState priced={priced} fetching={fetching} />}
        quantity={
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`Fewer cases of ${titleOf(line)}`}
                disabled={cases <= 1}
                onClick={() => onQuantity(cases - 1)}
                className="h-7 w-7 rounded-md border border-line text-ink-soft hover:bg-canvas disabled:opacity-40"
              >
                −
              </button>
              <span
                aria-busy={pending || undefined}
                title={pending ? "Saving…" : undefined}
                className={`w-10 text-center text-[13px] tabular-nums transition-opacity ${
                  pending ? "text-ink-soft opacity-70" : "text-ink"
                }`}
              >
                {cases}
              </span>
              <button
                type="button"
                aria-label={`More cases of ${titleOf(line)}`}
                onClick={() => onQuantity(cases + 1)}
                className="h-7 w-7 rounded-md border border-line text-ink-soft hover:bg-canvas disabled:opacity-40"
              >
                +
              </button>
            </div>
            {basketMode && bestSupplier && (
              <button
                type="button"
                onClick={onAdd}
                disabled={!priced?.best || !supportsCart(priced.best.supplierId) || busy || cases <= addedQuantity}
                className="w-full rounded-md border border-teal-600 px-2 py-1 text-[11.5px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40"
              >
                {cases > addedQuantity ? `Add ${cases - addedQuantity} to ${bestSupplier}` : `In ${bestSupplier}`}
              </button>
            )}
          </div>
        }
        actions={
          <button
            type="button"
            aria-label={`Remove ${titleOf(line)}`}
            disabled={busy}
            onClick={onRemove}
            title={`Remove ${titleOf(line)}`}
            className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 shadow-sm transition-all duration-150 hover:border-red-600 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <NavIcon name="delete" size={15} strokeWidth={2} />
          </button>
        }
      />
    </li>
  );
}

/**
 * Where this line stands, in one word a retailer can act on.
 */
function PriceState({ priced, fetching }: { priced: PricedCartLine | undefined; fetching: boolean }) {
  if (fetching) {
    return <Badge tone="busy">Fetching prices…</Badge>;
  }

  if (priced && !priced.priceable) {
    return <Badge tone="quiet">Cannot be priced</Badge>;
  }

  if (!priced?.pricedAt) {
    return <Badge tone="quiet">Not priced</Badge>;
  }

  if (priced.offers.length === 0) {
    return <Badge tone="quiet">No offer</Badge>;
  }

  if (priced.coverage && priced.coverage.priced === 0) {
    return <Badge tone="warn">Pricing failed</Badge>;
  }

  return (
    <Badge tone="good">
      Priced{" "}
      {new Date(priced.pricedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </Badge>
  );
}

function Badge({ tone, children }: { tone: "good" | "warn" | "quiet" | "busy"; children: React.ReactNode }) {
  const styles = {
    good: "bg-good-50 text-good-600",
    warn: "bg-amber-50 text-amber-800",
    quiet: "bg-canvas text-ink-faint",
    busy: "bg-teal-50 text-link",
  } as const;

  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${styles[tone]}`}>
      {children}
    </span>
  );
}
