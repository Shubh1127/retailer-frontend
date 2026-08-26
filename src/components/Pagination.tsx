"use client";

/**
 * Ten at a time, with Prev and Next.
 *
 * WHY TEN, AND WHY EVERYWHERE. The job now emits results in batches of ten, so
 * ten is what a retailer receives at a time while a file is still processing.
 * A table that renders all 213 lines makes the arrival of a batch invisible —
 * the page grows somewhere below the fold — and makes the first screenful of a
 * finished job a scroll rather than a page. Matching the page size to the batch
 * size means one batch is one screen.
 *
 * PAGES ARE CLAMPED, NOT REMEMBERED. When the list shrinks under you — a filter
 * narrows it, a job's rows are re-fetched — the current page can fall off the
 * end, and a page past the end renders empty. That reads as "there is nothing
 * here", which is a lie about the data rather than about the page. So the hook
 * pulls the page back to the last real one instead.
 */

import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZE = 10;

export interface Paged<T> {
  /** The current page's items. */
  items: T[];
  page: number;
  pageCount: number;
  /** 1-based index of the first item on this page, for "11–20 of 213". */
  from: number;
  /** 1-based index of the last item on this page. */
  to: number;
  total: number;
  setPage: (page: number) => void;
  next: () => void;
  prev: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Slice `all` into pages.
 *
 * `resetKey` starts again from page one when the LIST ITSELF changes meaning —
 * a new search, a different job. Without it, searching again while on page 4
 * shows page 4 of the new results, which looks like the search returned
 * something unrelated.
 */
export function usePagination<T>(
  all: readonly T[],
  { pageSize = PAGE_SIZE, resetKey }: { pageSize?: number; resetKey?: unknown } = {},
): Paged<T> {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Clamped during render, not in an effect: an effect would let one frame
  // render the empty page first.
  const current = Math.min(Math.max(1, page), pageCount);

  useEffect(() => {
    if (page !== current) setPage(current);
  }, [page, current]);

  const items = useMemo(
    () => all.slice((current - 1) * pageSize, current * pageSize),
    [all, current, pageSize],
  );

  return {
    items: items as T[],
    page: current,
    pageCount,
    from: total === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, total),
    total,
    setPage,
    next: () => setPage((p) => Math.min(pageCount, p + 1)),
    prev: () => setPage((p) => Math.max(1, p - 1)),
    hasPrev: current > 1,
    hasNext: current < pageCount,
  };
}

/**
 * The Prev / Next control.
 *
 * Renders nothing for a single page. A control that can only be disabled is
 * furniture, and on a five-line list it is the only thing under the table.
 */
export default function Pagination({
  paged,
  label = "items",
  className = "",
}: {
  paged: Pick<
    Paged<unknown>,
    "page" | "pageCount" | "from" | "to" | "total" | "next" | "prev" | "hasPrev" | "hasNext"
  >;
  /** Plural noun for the count line: "213 products". */
  label?: string;
  className?: string;
}) {
  if (paged.pageCount <= 1) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 ${className}`}
    >
      <p className="text-[12px] text-ink-soft">
        <span className="nums font-medium text-ink">
          {paged.from}–{paged.to}
        </span>{" "}
        of <span className="nums">{paged.total}</span> {label}
      </p>

      <div className="flex items-center gap-2">
        <span className="text-[12px] text-ink-faint">
          Page <span className="nums">{paged.page}</span> of{" "}
          <span className="nums">{paged.pageCount}</span>
        </span>
        <button
          type="button"
          onClick={paged.prev}
          disabled={!paged.hasPrev}
          className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={paged.next}
          disabled={!paged.hasNext}
          className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
