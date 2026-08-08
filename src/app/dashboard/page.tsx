"use client";

/**
 * Procurement dashboard — the main RetailCompare experience.
 *
 *   upload → job starts → batches stream in → rows append → decisions in seconds
 *
 * The retailer is looking at purchasing decisions for the first 50 products
 * while the remaining 1950 are still being searched. Nothing here waits for the
 * whole file.
 *
 * Two invariants drive the whole component:
 *
 *   1. ONE Excel row is ONE dashboard row. Rows are keyed on the Excel row
 *      number and merged into a Map, so a replayed SSE batch (reconnect) can
 *      never duplicate a product.
 *   2. Rejected supplier candidates are NEVER rows. They appear only inside one
 *      product's popup, and only when they are genuine commercial alternatives.
 *
 * Sorting, searching and tab switching are pure client-side derivations of
 * already-received rows, so they stay responsive while batches keep arriving.
 *
 * The previous single-product search UI that lived here is preserved at
 * /product-search.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { CartBar, CartCell, useCart } from "@/components/Cart";
import { SupplierPriceCell, supplierColumns } from "@/components/SupplierPrices";
// The dashboard already shows live progress counts of its own, so only the
// skeleton is needed here.
import { TableSkeleton } from "@/components/TableSkeleton";
import ProductImage from "@/components/ProductImage";
import {
  createJob,
  downloadReport,
  eur,
  packOf,
  subscribeToJob,
  type CommercialAlternative,
  type JobSummary,
  type NeedsAttentionRow,
  type ReadyToOrderRow,
  type RowDecision,
} from "@/lib/api/jobs";

/**
 * What the parser accepts, in ONE place.
 *
 * The file input's `accept` is only a filter on the picker — it is advisory, and
 * a drag and drop bypasses it completely, so a dropped `.pdf` arrives exactly
 * like a spreadsheet would. Both paths therefore check against this same list
 * rather than trusting the attribute.
 */
const ACCEPTED_EXTENSIONS = [".xls", ".xlsx", ".csv"] as const;
const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",");

function hasAcceptedExtension(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * True only for a drag carrying files.
 *
 * Dragging selected text or a link across the panel also fires the drag events,
 * and lighting the dropzone up for those promises something a drop cannot
 * deliver.
 */
function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

type Tab = "ready" | "attention";
/**
 * `price:<supplierId>` sorts by ONE supplier's quote.
 *
 * Now that each supplier has its own column, a single "price" key would be
 * ambiguous — the buyer clicking Musgrave's header means "cheapest at
 * Musgrave", which is not the same question as "cheapest overall". Rows where
 * that supplier quoted nothing sort last in both directions, because a missing
 * price is not a cheap one.
 */
type SortKey = "row" | "product" | "supplier" | "savings" | `price:${string}`;

// ---- Small building blocks -------------------------------------------------

function InfoIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5-5 5 5M12 5v12" />
    </svg>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-line"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-teal-500 transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: 1 | -1;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = active === sortKey;
  return (
    <th
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-ink ${
          isActive ? "text-ink" : ""
        }`}
      >
        {label}
        <span className={isActive ? "opacity-100" : "opacity-0"}>
          {direction === 1 ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

/**
 * Savings against the retailer's CURRENT cost — never supplier-versus-supplier.
 *
 * A dearer supplier says "No saving" and shows what it would cost extra, rather
 * than rendering a negative number in a column the eye reads as a discount.
 */
function SavingsCell({ row }: { row: ReadyToOrderRow }) {
  if (row.savingsStatus === "saving" && row.savings !== undefined) {
    return (
      <span className="text-emerald-600">
        +{eur(row.savings)}
        {row.savingsPct !== undefined && (
          <span className="ml-1 text-[11px] opacity-70">
            {Math.round(row.savingsPct * 100)}%
          </span>
        )}
      </span>
    );
  }

  if (row.savingsStatus === "no-saving") {
    return (
      <span
        className="text-ink-soft"
        title={
          row.costDelta !== undefined
            ? `${eur(Math.abs(row.costDelta))} dearer than your current cost of ${eur(row.baselineCost)}`
            : undefined
        }
      >
        No saving
        {row.costDelta !== undefined && row.costDelta < 0 && (
          <span className="ml-1 text-[11px] text-amber-700">
            +{eur(Math.abs(row.costDelta))}
          </span>
        )}
      </span>
    );
  }

  // No cost in the file, so no saving can honestly be claimed.
  return (
    <span className="text-ink-faint" title="No current cost in the uploaded file">
      —
    </span>
  );
}

// ---- Product detail popup --------------------------------------------------

function AlternativeCard({
  alternative,
  selectedPrice,
}: {
  alternative: CommercialAlternative;
  selectedPrice?: number;
}) {
  const delta =
    selectedPrice !== undefined && alternative.exVatCasePrice !== undefined
      ? alternative.exVatCasePrice - selectedPrice
      : undefined;

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink">
            {alternative.product}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-soft">
            {packOf(alternative)} · {alternative.supplierName}
            {alternative.sku ? ` · SKU ${alternative.sku}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[13px] font-semibold text-ink">
            {eur(alternative.exVatCasePrice)}
          </div>
          {delta !== undefined && (
            <div
              className={`text-[11px] ${delta < 0 ? "text-emerald-600" : "text-ink-soft"}`}
            >
              {delta < 0 ? "−" : "+"}
              {eur(Math.abs(delta))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
        Difference: {alternative.difference}
      </div>
    </div>
  );
}

function ProductDetailModal({
  row,
  onClose,
}: {
  row: ReadyToOrderRow;
  onClose: () => void;
}) {
  // Escape closes, and focus moves into the dialog so keyboard users are not
  // stranded behind a table of 2000 rows.
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = row.detail.selected;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${row.product}`}
        className="w-full max-w-2xl rounded-xl border border-line bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-faint">
              Requested product · Excel row {row.row}
            </div>
            <div className="mt-0.5 text-[15px] font-semibold text-ink">
              {row.detail.requestedProduct}
            </div>
            {row.detail.requestedPack && (
              <div className="text-[12.5px] text-ink-soft">
                {row.detail.requestedPack}
              </div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-ink-soft hover:bg-canvas hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">
            Selected product
          </div>
          <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ProductImage
                  {...(selected?.imageUrl ? { src: selected.imageUrl } : {})}
                  alt={selected?.product ?? row.product}
                  size={64}
                />
                <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-ink">
                  {selected?.product ?? row.product}
                </div>
                <div className="mt-0.5 text-[12px] text-ink-soft">
                  {selected ? packOf(selected) : "—"} · {row.bestSupplierName}
                  {selected?.sku ? ` · SKU ${selected.sku}` : ""}
                </div>
                {selected?.ean && (
                  <div className="text-[11.5px] text-ink-faint">
                    EAN {selected.ean}
                  </div>
                )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[15px] font-semibold text-ink">
                  {eur(row.price)}
                </div>
                <div className="text-[11px] text-ink-soft">per case, ex-VAT</div>
              </div>
            </div>
          </div>

          {row.detail.offers.length > 1 && (
            <>
              <div className="mt-5 text-[11px] uppercase tracking-wide text-ink-faint">
                Also available from
              </div>
              <div className="mt-2 space-y-1.5">
                {row.detail.offers
                  .filter((offer) => offer.supplier !== row.bestSupplier)
                  .map((offer) => (
                    <div
                      key={`${offer.supplier}-${offer.sku ?? offer.product}`}
                      className="flex items-center justify-between rounded-lg border border-line px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] text-ink">
                          {offer.product}
                        </div>
                        <div className="text-[11.5px] text-ink-soft">
                          {packOf(offer)} · {offer.supplierName}
                        </div>
                      </div>
                      <div className="shrink-0 text-[13px] font-medium text-ink">
                        {eur(offer.exVatCasePrice)}
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}

          <div className="mt-5 text-[11px] uppercase tracking-wide text-ink-faint">
            Other available variants
          </div>
          {row.detail.alternatives.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-soft">
              No comparable variants — suppliers list this product in one form at
              this pack size.
            </p>
          ) : (
            <>
              <p className="mt-1 text-[11.5px] text-ink-faint">
                Same commercial family and pack size. Products at a different
                pack, unit or container are not shown.
              </p>
              <div className="mt-2 space-y-2">
                {row.detail.alternatives.map((alternative) => (
                  <AlternativeCard
                    key={`${alternative.supplier}-${alternative.sku ?? alternative.product}`}
                    alternative={alternative}
                    selectedPrice={row.price}
                  />
                ))}
              </div>
              <div className="mt-3 rounded-md bg-canvas px-3 py-2 text-[11.5px] text-ink-soft">
                Selecting a variant here will re-run allocation and update the
                cart — not enabled yet.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------

export default function DashboardPage() {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // The header's picker, reused so the empty-state panel opens the same one
  // rather than mounting a second input that could drift out of step with it.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * Drag depth, not a boolean.
   *
   * `dragleave` fires on the panel every time the pointer crosses into one of
   * its children, so a boolean switches the highlight off while the file is
   * still very much over the dropzone — it reads as flicker. Counting enter and
   * leave means the highlight clears only when the pointer has genuinely left.
   */
  const dragDepthRef = useRef(0);

  // Keyed by Excel row: one row per retailer product, replay-safe.
  const [ready, setReady] = useState<Map<number, ReadyToOrderRow>>(new Map());
  const [attention, setAttention] = useState<Map<number, NeedsAttentionRow>>(
    new Map(),
  );

  /**
   * Lines an admin has settled for us, keyed by Excel row.
   *
   * Arrives over the same stream as the results, while this page is open. Kept
   * beside the pipeline's rows rather than merged into them, so the screen can
   * show both what the matcher decided and what a person decided instead —
   * which is the only way an override reads as an override.
   */
  const [decisions, setDecisions] = useState<Map<number, RowDecision>>(new Map());

  const [tab, setTab] = useState<Tab>("ready");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("row");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);
  const [openRow, setOpenRow] = useState<ReadyToOrderRow | null>(null);

  // The supplier basket, read on mount. A row says "In Cart" because Musgrave
  // holds it, never because this page remembers putting it there.
  const cart = useCart();

  // Derived from ALL ready rows, not the filtered view — the columns must not
  // appear and disappear as somebody types in the search box.
  const priceColumns = useMemo(() => supplierColumns([...ready.values()]), [ready]);

  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => unsubscribeRef.current?.(), []);

  const handleUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    setNotice(null);
    setReady(new Map());
    setAttention(new Map());
    setDecisions(new Map());
    unsubscribeRef.current?.();

    try {
      const created = await createJob(file);
      setJob(created);

      if (created.warning) setNotice(created.warning);
      else if (created.aiService && !created.aiService.reachable) {
        setNotice(
          "The AI matching service is not reachable — matching will fall back to the deterministic rules only.",
        );
      } else if (created.persistence === "memory-only") {
        setNotice(
          "Supabase is not configured — this run will not appear in job history.",
        );
      }

      unsubscribeRef.current = subscribeToJob(created.jobId, {
        onStatus: (summary) => setJob(summary),
        // An admin settled one of these lines while we were watching.
        onOverride: (decision) => {
          setDecisions((current) => {
            const next = new Map(current);
            // "Restored" means the admin withdrew their decision, so the line
            // goes back to whatever the pipeline said — which is exactly what
            // dropping the entry does.
            if (decision.type === "row-restored") next.delete(decision.row);
            else next.set(decision.row, decision);
            return next;
          });
        },
        onBatch: (event) => {
          // Append, never replace. Keyed by Excel row so a replayed batch after
          // a reconnect updates in place instead of duplicating a product.
          if (event.readyToOrder.length > 0) {
            setReady((current) => {
              const next = new Map(current);
              for (const row of event.readyToOrder) next.set(row.row, row);
              return next;
            });
          }
          if (event.needsAttention.length > 0) {
            setAttention((current) => {
              const next = new Map(current);
              for (const row of event.needsAttention) next.set(row.row, row);
              return next;
            });
          }
          setJob((current) =>
            current
              ? {
                  ...current,
                  processedProducts: event.processedProducts,
                  totalProducts: event.totalProducts,
                  progress: event.progress,
                  status: event.status,
                }
              : current,
          );
        },
        onDone: (summary) => setJob(summary),
        onError: (message) => setNotice(message),
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }, []);

  const openFilePicker = useCallback(() => {
    if (isUploading) return;
    fileInputRef.current?.click();
  }, [isUploading]);

  const handleDragEnter = useCallback((event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!isFileDrag(event)) return;
    // Without this the browser handles the drop itself and navigates away to
    // the file, discarding the page and any job in progress with it.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      // A completed drop ends the drag outright — no matching `dragleave`
      // arrives, so the depth is reset rather than decremented.
      dragDepthRef.current = 0;
      setIsDraggingFile(false);

      if (isUploading) return;

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;

      // One job is one file. Silently taking the first of several would start a
      // run against a file the user did not choose.
      if (files.length > 1) {
        setUploadError("Drop one order file at a time.");
        return;
      }

      const file = files[0]!;
      if (!hasAcceptedExtension(file)) {
        setUploadError(
          `“${file.name}” is not an order file. Drop an Excel (.xls, .xlsx) or CSV file.`,
        );
        return;
      }

      void handleUpload(file);
    },
    [handleUpload, isUploading],
  );

  const readyRows = useMemo(() => [...ready.values()], [ready]);
  const attentionRows = useMemo(() => [...attention.values()], [attention]);

  const visibleReady = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? readyRows.filter(
          (row) =>
            row.product.toLowerCase().includes(needle) ||
            row.bestSupplierName.toLowerCase().includes(needle) ||
            (row.detail.selected?.sku ?? "").toLowerCase().includes(needle),
        )
      : readyRows;

    const value = (row: ReadyToOrderRow): string | number => {
      if (sortKey.startsWith("price:")) {
        const supplierId = sortKey.slice("price:".length);
        const offer = row.detail.offers.find(
          (entry) => entry.supplier === supplierId,
        );
        // No quote from this supplier sorts to the end, whichever way the
        // column is pointing — "they had nothing" is not "they were cheapest".
        return offer?.exVatCasePrice ?? Number.POSITIVE_INFINITY;
      }

      switch (sortKey) {
        case "product":
          return row.product.toLowerCase();
        case "supplier":
          return row.bestSupplierName.toLowerCase();
        case "savings":
          return row.savings ?? Number.NEGATIVE_INFINITY;
        default:
          return row.row;
      }
    };

    return [...filtered].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (left === right) return a.row - b.row;
      return (left < right ? -1 : 1) * sortDirection;
    });
  }, [readyRows, query, sortKey, sortDirection]);

  const visibleAttention = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? attentionRows.filter(
          (row) =>
            row.product.toLowerCase().includes(needle) ||
            row.status.toLowerCase().includes(needle) ||
            row.reason.toLowerCase().includes(needle),
        )
      : attentionRows;
    return [...filtered].sort((a, b) => a.row - b.row);
  }, [attentionRows, query]);

  const totalSavings = useMemo(
    () => readyRows.reduce((sum, row) => sum + (row.savings ?? 0) * row.cases, 0),
    [readyRows],
  );

  const onSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setSortDirection((d) => (d === 1 ? -1 : 1));
      else {
        setSortKey(key);
        setSortDirection(1);
      }
    },
    [sortKey],
  );

  const isRunning = job?.status === "running" || job?.status === "queued";

  return (
    <AppShell active="Dashboard">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">
            Order dashboard
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            Upload an order file — results appear as each batch finishes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/jobs"
            className="rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink"
          >
            Job history
          </Link>
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700 ${
              isUploading ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <UploadIcon />
            {isUploading ? "Uploading…" : "Upload order file"}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {uploadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {uploadError}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          {notice}
        </div>
      )}

      {!job ? (
        // The dashed border already reads as a dropzone, so it behaves like one:
        // dropping a file here works, and so does clicking anywhere on it.
        <div
          role="button"
          tabIndex={isUploading ? -1 : 0}
          aria-label="Upload an order file"
          aria-disabled={isUploading}
          onClick={openFilePicker}
          onKeyDown={(event) => {
            // A div with role="button" gets no keyboard activation for free.
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openFilePicker();
            }
          }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-xl border border-dashed px-6 py-16 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 ${
            isDraggingFile
              ? "border-teal-500 bg-teal-500/5"
              : "border-line bg-surface"
          } ${
            isUploading
              ? "cursor-default opacity-60"
              : "cursor-pointer hover:border-ink-faint"
          }`}
        >
          <div
            className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
              isDraggingFile ? "bg-teal-500/10 text-teal-600" : "bg-canvas text-ink-soft"
            }`}
          >
            <UploadIcon />
          </div>
          <h2 className="mt-3 text-[15px] font-semibold text-ink">
            {isDraggingFile
              ? "Drop the file to start"
              : "Drop an order file here, or click to browse"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-soft">
            Excel (.xls, .xlsx) or CSV in the EPOS Article Order Listing layout.
            Products are searched in batches of 50, and the first results appear
            within seconds — you do not have to wait for the whole file.
          </p>
        </div>
      ) : (
        <>
          {/* ---- Progress ---- */}
          <section className="mb-5 rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-ink">
                    {job.fileName}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      job.status === "completed"
                        ? "bg-emerald-50 text-emerald-700"
                        : job.status === "failed"
                          ? "bg-red-50 text-red-700"
                          : "bg-teal-50 text-link"
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
                {job.storeName && (
                  <div className="text-[12px] text-ink-soft">{job.storeName}</div>
                )}
              </div>

              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                  Processed
                </div>
                <div className="text-[17px] font-semibold tabular-nums text-ink">
                  {job.processedProducts} / {job.totalProducts}
                </div>
              </div>
            </div>

            <div className="mt-3">
              <ProgressBar value={job.progress} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Ready to order", value: String(readyRows.length) },
                { label: "Needs attention", value: String(attentionRows.length) },
                { label: "Est. saving", value: eur(totalSavings) },
                { label: "Progress", value: `${job.progress}%` },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg bg-canvas px-3 py-2">
                  <div className="text-[11px] text-ink-faint">{stat.label}</div>
                  <div className="text-[14px] font-semibold tabular-nums text-ink">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {job.error && (
              <p className="mt-3 text-[12.5px] text-red-700">{job.error}</p>
            )}
          </section>

          {/* ---- Tabs + search ---- */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
              {(
                [
                  ["ready", "Ready to order", readyRows.length],
                  ["attention", "Needs attention", attentionRows.length],
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

            <div className="flex items-center gap-2">
              {isRunning && (
                <span className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />
                  still processing
                </span>
              )}
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products…"
                className="w-56 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-faint"
              />
              <button
                type="button"
                onClick={() => {
                  void downloadReport(job.jobId, job.fileName);
                }}
                className="rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink"
              >
                Download report
              </button>
            </div>
          </div>

          {/* ---- Cart ---- */}
          {/* Every ready row, not just the filtered view — the button acts on
              the whole result, and a search box should not silently shrink
              what "Add All" means. */}
          {tab === "ready" && <CartBar rows={[...ready.values()]} cart={cart} />}

          {/* ---- Tables ---- */}
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="overflow-x-auto">
              {/* Nothing has arrived yet: show the shape of what is coming
                  rather than an empty box, so the wait reads as progress. */}
              {ready.size === 0 &&
              attention.size === 0 &&
              (job.status === "running" || job.status === "queued") ? (
                <TableSkeleton rows={8} columns={7} />
              ) : tab === "ready" ? (
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead className="border-b border-line bg-canvas text-[12px] text-ink-soft">
                    <tr>
                      <SortHeader
                        label="Row"
                        sortKey="row"
                        active={sortKey}
                        direction={sortDirection}
                        onSort={onSort}
                      />
                      <SortHeader
                        label="Product"
                        sortKey="product"
                        active={sortKey}
                        direction={sortDirection}
                        onSort={onSort}
                      />
                      <SortHeader
                        label="Best supplier"
                        sortKey="supplier"
                        active={sortKey}
                        direction={sortDirection}
                        onSort={onSort}
                      />
                      {/* One column per supplier, so both quotes are visible
                          side by side. The winner's cell is highlighted. */}
                      {priceColumns.map((column) => (
                        <SortHeader
                          key={column.id}
                          label={column.name}
                          sortKey={`price:${column.id}`}
                          active={sortKey}
                          direction={sortDirection}
                          onSort={onSort}
                          align="right"
                        />
                      ))}
                      <SortHeader
                        label="Savings"
                        sortKey="savings"
                        active={sortKey}
                        direction={sortDirection}
                        onSort={onSort}
                        align="right"
                      />
                      <th className="px-3 py-2 text-left font-medium">Cart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleReady.map((row) => {
                      const decision = decisions.get(row.row);
                      return (
                      <tr
                        key={row.row}
                        className={`border-b border-line last:border-0 ${
                          decision?.type === "row-removed"
                            ? "bg-red-50/50 opacity-60"
                            : "hover:bg-canvas/60"
                        }`}
                      >
                        <td className="px-3 py-2 tabular-nums text-ink-faint">
                          {row.row}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-start gap-2">
                          {/* The supplier's own picture of what will actually be
                              ordered — which is not always obvious from a name
                              like "Can Coke Zero Cherry Float". */}
                          <ProductImage
                            {...(row.detail.selected?.imageUrl
                              ? { src: row.detail.selected.imageUrl }
                              : {})}
                            alt={row.detail.selected?.product ?? row.product}
                            size={36}
                          />
                          <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-ink ${
                                decision?.type === "row-removed" ? "line-through" : ""
                              }`}
                            >
                              {row.product}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOpenRow(row)}
                              aria-label={`Details for ${row.product}`}
                              className="shrink-0 rounded text-ink-faint hover:text-teal-600"
                            >
                              <InfoIcon />
                            </button>
                          </div>
                          <div className="text-[11.5px] text-ink-faint">
                            {row.detail.selected?.product}
                          </div>
                          {row.warnings.length > 0 && (
                            <div
                              className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700"
                              title={row.warnings.map((w) => w.message).join("\n")}
                            >
                              ⚠ {row.warnings[0]!.message}
                              {row.warnings.length > 1 && (
                                <span className="opacity-70">
                                  +{row.warnings.length - 1}
                                </span>
                              )}
                            </div>
                          )}
                          {/* Pushed here live by the admin app. Shown beside the
                              pipeline's own answer rather than replacing it, so
                              it reads as a person's decision and not as a
                              different match. */}
                          {decision?.type === "row-confirmed" && (
                            <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                              ✓ Confirmed by {decision.by ?? "an administrator"} —{" "}
                              {decision.supplierProduct ??
                                `${decision.supplier} ${decision.supplierSku}`}
                            </div>
                          )}
                          {decision?.type === "row-removed" && (
                            <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">
                              Removed by {decision.by ?? "an administrator"}
                              {decision.reason && ` — ${decision.reason}`}
                            </div>
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
                          <SavingsCell row={row} />
                        </td>
                        <td className="px-3 py-2">
                          <CartCell row={row} cart={cart} />
                        </td>
                      </tr>
                      );
                    })}
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
                {isRunning
                  ? "Waiting for the first batch…"
                  : query
                    ? "No products match this search."
                    : "Nothing here."}
              </div>
            )}
          </div>
        </>
      )}

      {openRow && (
        <ProductDetailModal row={openRow} onClose={() => setOpenRow(null)} />
      )}
    </AppShell>
  );
}
