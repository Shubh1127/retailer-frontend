"use client";

/**
 * The order list — what you are buying this week, before anything is priced.
 *
 * This is now the way an order starts. Uploading a file used to fan two hundred
 * lines straight out to four live trade accounts before anyone had looked at
 * what was in it; the list puts a reviewable step in front of that. Correct a
 * quantity, drop the twelve lines you do not want, and only then spend the
 * requests.
 *
 * NOTHING HERE CONTACTS A SUPPLIER. Import, edit, remove and clear are all
 * local. "Send to comparison" is the one action that starts a job, and it hands
 * the reviewed lines to the same pipeline an upload has always used.
 *
 * TWO SOURCES, ONE LIST. An EPOS Article Order Listing (.xls/.xlsx) carries an
 * article code, a description, pack text and the current cost, and NO barcodes.
 * A CSV carries barcodes and quantities. Both merge into the same draft because
 * a line is keyed on whichever identity its source actually has — see
 * `line_key`. Barcode scanning joins them later on the same basis.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/AppShell";
import {
  clearOrderList,
  getOrderList,
  importOrderListCsv,
  importOrderListEpos,
  removeOrderListLine,
  setOrderListCases,
  submitOrderList,
  type OrderList,
  type SkippedRow,
} from "@/lib/api/orderList";

/** A file as base64, which is what the EPOS import route takes. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Chunked: spreading a 200k-element array into String.fromCharCode blows the
  // argument limit on a real order file.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export default function OrdersPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [list, setList] = useState<OrderList | null>(null);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setList(await getOrderList());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your order list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (key: string, work: () => Promise<OrderList>) => {
      setBusy(key);
      setError(null);
      try {
        setList(await work());
      } catch (err) {
        setError(err instanceof Error ? err.message : "That did not work");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const onFile = useCallback(
    async (file: File) => {
      setBusy("import");
      setError(null);
      try {
        // TWO SHAPES OF FILE, TWO PARSERS.
        //
        //   .xls / .xlsx  an EPOS Article Order Listing: article code,
        //                 description, pack and cost, and NO barcodes
        //   .csv          a barcode list: a GTIN and a quantity
        //
        // A .csv could honestly be either, and the EPOS export is sometimes
        // saved as one. It is routed to the CSV parser, which reports rows it
        // cannot read rather than failing the file — so a mis-sent EPOS csv
        // comes back as "no barcode column" rather than as silence.
        const isSpreadsheet = /\.xlsx?$/i.test(file.name);

        const result = isSpreadsheet
          ? await importOrderListEpos(await toBase64(file), file.name)
          : await importOrderListCsv(await file.text(), file.name);

        setList(result.list);
        setSkipped(result.skipped);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that file");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const send = useCallback(async () => {
    setBusy("submit");
    setError(null);
    try {
      const { jobId } = await submitOrderList();
      // Straight to the run. The comparison is where the buyer's attention
      // belongs the moment suppliers start answering.
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this list");
      setBusy(null);
    }
  }, [router]);

  const lines = list?.lines ?? [];
  const totalCases = lines.reduce((sum, line) => sum + line.cases, 0);

  return (
    <AppShell active="Order list">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Order list</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            What you&apos;re buying this week. Nothing is priced until you send it.
          </p>
        </div>

        <div className="flex items-center gap-2">
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

          <button
            type="button"
            onClick={() => void send()}
            disabled={busy !== null || lines.length === 0}
            className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "submit" ? "Sending…" : "Send to comparison"}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700"
        >
          {error}
        </div>
      )}

      {/* Rows the parser could not read. Named rather than counted: a retailer
          whose file lost nine lines needs to know WHICH nine. */}
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

      <div className="mt-6 rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <p className="text-[13.5px] font-medium text-ink">
            {loading
              ? "Loading…"
              : `${lines.length} line${lines.length === 1 ? "" : "s"} · ${totalCases} case${
                  totalCases === 1 ? "" : "s"
                }`}
          </p>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={() => void run("clear", clearOrderList)}
              disabled={busy !== null}
              className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-canvas disabled:opacity-50"
            >
              {busy === "clear" ? "Clearing…" : "Clear list"}
            </button>
          )}
        </div>

        {!loading && lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-[13.5px] font-medium text-ink">This list is empty</p>
            <p className="max-w-sm text-[12.5px] text-ink-soft">
              Import your EPOS Article Order Listing (.xls or .xlsx), or a CSV
              with a barcode column and a case-quantity column. Importing twice
              adds the quantities together.
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="mt-2 rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas"
            >
              Import file
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink">
                    {line.description ?? line.gtin14 ?? line.articleCode}
                  </p>
                  {/* Whichever identity the line actually has. An EPOS line has
                      an article code and no barcode; a CSV line the reverse.
                      Showing "undefined" for the missing one would look like a
                      fault rather than a difference between two file formats. */}
                  <p className="text-[11.5px] tabular-nums text-ink-soft">
                    {[line.gtin14, line.articleCode, line.packRaw]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Fewer cases of ${line.description ?? line.lineKey}`}
                    disabled={busy !== null || line.cases <= 1}
                    onClick={() =>
                      void run(`qty-${line.id}`, () => setOrderListCases(line.id, line.cases - 1))
                    }
                    className="h-7 w-7 rounded-md border border-line text-ink-soft hover:bg-canvas disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-[13px] tabular-nums text-ink">
                    {line.cases}
                  </span>
                  <button
                    type="button"
                    aria-label={`More cases of ${line.description ?? line.lineKey}`}
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`qty-${line.id}`, () => setOrderListCases(line.id, line.cases + 1))
                    }
                    className="h-7 w-7 rounded-md border border-line text-ink-soft hover:bg-canvas disabled:opacity-40"
                  >
                    +
                  </button>
                  <span className="ml-1 text-[12px] text-ink-soft">cases</span>

                  <button
                    type="button"
                    aria-label={`Remove ${line.description ?? line.lineKey}`}
                    disabled={busy !== null}
                    onClick={() => void run(`del-${line.id}`, () => removeOrderListLine(line.id))}
                    className="ml-2 h-7 w-7 rounded-md border border-line text-[12px] text-ink-soft hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-[11.5px] text-ink-faint">
        Sending the list starts a comparison against every connected supplier.
        Until then nothing here has been shown to any of them.
      </p>
    </AppShell>
  );
}
