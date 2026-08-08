/**
 * Loading placeholders.
 *
 * Shown between "the file was uploaded" and "the first rows arrived". Matching
 * the real table's column count and row height matters more than it sounds: a
 * skeleton of the wrong shape makes the content jump when it lands, which reads
 * as a glitch rather than as loading.
 *
 * The pulse is on a wrapper rather than each cell so every bar breathes in
 * time — a grid of independently pulsing blocks looks like noise.
 */

export function TableSkeleton({
  rows = 6,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="animate-pulse" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0"
        >
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <div
              key={columnIndex}
              className="h-3 rounded bg-canvas"
              style={{
                // Uneven widths so it reads as text rather than as a bar chart.
                width:
                  columnIndex === 0
                    ? "6%"
                    : columnIndex === 1
                      ? "28%"
                      : columnIndex === columns - 1
                        ? "10%"
                        : "16%",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The banner shown while a job is still processing.
 *
 * States the counts rather than just spinning, because "87 of 213" tells a
 * buyer whether to wait or come back, and a bare spinner does not.
 */
export function ProcessingBanner({
  processed,
  total,
  label = "Matching products against suppliers…",
}: {
  processed: number;
  total: number;
  label?: string;
}) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="mb-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2 text-ink">
          <span className="h-2 w-2 animate-pulse rounded-full bg-teal-500" />
          {label}
        </span>
        <span className="tabular-nums text-ink-soft">
          {processed} / {total || "…"}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
        <div
          className="h-full rounded-full bg-teal-500 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
