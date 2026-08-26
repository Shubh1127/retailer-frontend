"use client";

/**
 * Scan the shelf.
 *
 * WHAT MAKES THIS FAST, AND WHY IT HAD TO BE DESIGNED FOR
 *
 * Somebody walking a shop produces a beep a second. Nothing in that loop may
 * wait on a supplier: a scan is one master-table read and one insert, and the
 * prices come later, once, when they press the button saying they have
 * finished. A scanner that stops to ask four wholesalers what something costs
 * falls behind the person holding it within ten paces.
 *
 * Even a database round trip is too slow to render against. The scanned
 * barcode is therefore drawn BEFORE the request goes out — a pending row
 * carrying the digits as read — and is replaced by the resolved product when
 * the server answers. The person glancing at the screen is checking that the
 * number in their hand went in, not reading a price.
 *
 * TWO WAYS TO SCAN, AND THE BORING ONE IS BETTER
 *
 *   a handheld scanner  types the digits and presses Enter. It is a keyboard.
 *                       This needs no code at all beyond an input that stays
 *                       focused, and it is faster and far more reliable than a
 *                       camera.
 *   the camera          BarcodeDetector where the browser has it. Useful on a
 *                       phone, and the only option without hardware.
 *
 * The input is therefore the primary path and is re-focused aggressively, so a
 * stray click does not silently send the next ten beeps into nothing.
 *
 * DUPLICATE READS ARE NOT DUPLICATE PRODUCTS
 *
 * A camera decodes the same barcode many times a second while it stays in
 * frame. Every one of those would otherwise be an item. The same code is
 * ignored for a couple of seconds after it lands — long enough to cover a
 * steady hand, short enough that deliberately re-scanning to count two of
 * something still works.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import AppShell from "@/components/AppShell";
import ProductGlyph from "@/components/ProductGlyph";
import Pagination, { usePagination } from "@/components/Pagination";
import { ApiError } from "@/lib/api/client";
import { cartSupplierLabel, supportsCart, addItems, type CartSupplier } from "@/lib/api/cart";
import { eur } from "@/lib/mock-data";
import { classifyBurst, isBarcodeKey, type Keystroke } from "@/lib/scannerInput";
import {
  clearScanCart,
  fetchScanPrices,
  getScanCart,
  recordScan,
  removeScanLine,
  setScanQuantity,
  type ScanCart,
  type ScanLine,
} from "@/lib/api/scan";

/** How long the same code is ignored after it registers. See the header. */
const DUPLICATE_WINDOW_MS = 2000;

/** How often the camera is asked to decode. ~7/s is well past a human's pace. */
const DECODE_INTERVAL_MS = 140;

type Feedback = { kind: "ok" | "miss" | "error"; text: string; at: number };

export default function ScanPage() {
  const [cart, setCart] = useState<ScanCart | null>(null);
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /**
   * Whether a hardware scanner has been seen typing.
   *
   * Inferred, not detected — a scanner is a keyboard as far as the browser is
   * concerned. Shown because the alternative is a retailer wondering whether
   * the thing in their hand is doing anything.
   */
  const [scannerSeen, setScannerSeen] = useState(false);

  /**
   * Scans sent but not yet confirmed, newest first.
   *
   * THE BARCODE IS ON SCREEN BEFORE THE SERVER HAS BEEN ASKED ANYTHING. A round
   * trip is 100–300ms and the cart re-read is another; at a beep a second that
   * is two or three scans' worth of nothing happening, and the person is
   * looking at a shelf rather than the screen. What they need instantly is
   * confirmation that the number in their hand went in — the product name and
   * the supplier list can arrive a moment later.
   *
   * Keyed by code so a second beep of the same thing does not stack two ghosts.
   */
  const [pending, setPending] = useState<{ code: string; at: number }[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastSeen = useRef<Map<string, number>>(new Map());

  // ---- The cart ------------------------------------------------------------
  const load = useCallback(async () => {
    try {
      const result = await getScanCart();
      setCart(result.cart);
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Could not load the cart",
        at: Date.now(),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- One scan ------------------------------------------------------------
  const submitCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;

      // Duplicate suppression. A camera reads the same barcode continuously
      // while it is in frame; without this a two-second pause is twenty items.
      const now = Date.now();
      const seen = lastSeen.current.get(code);
      if (seen !== undefined && now - seen < DUPLICATE_WINDOW_MS) return;
      lastSeen.current.set(code, now);

      // On screen NOW, before the request goes out.
      setPending((current) =>
        current.some((entry) => entry.code === code)
          ? current
          : [{ code, at: Date.now() }, ...current],
      );
      setFeedback({ kind: "ok", text: `${code} — scanned`, at: Date.now() });

      try {
        const { line, source } = await recordScan(code);

        setFeedback(
          line.product
            ? {
                kind: "ok",
                text: `${code} · ${line.product.name ?? "product"} · ${
                  line.product.vendorCount
                } supplier${line.product.vendorCount === 1 ? "" : "s"}`,
                at: Date.now(),
              }
            : {
                kind: "miss",
                // A real barcode we do not hold is a gap in our catalogues;
                // digits that are not a barcode are usually a misread. Saying
                // which saves somebody scanning it five more times.
                text:
                  source === "barcode"
                    ? `${code} — no supplier we carry stocks this`
                    : `${code} — not a barcode we recognise`,
                at: Date.now(),
              },
        );

        await load();
      } catch (error) {
        setFeedback({
          kind: "error",
          text: error instanceof ApiError ? error.message : "That scan did not register",
          at: Date.now(),
        });
      } finally {
        setPending((current) => current.filter((entry) => entry.code !== code));
      }
    },
    [load],
  );

  // ---- The camera ----------------------------------------------------------
  useEffect(() => {
    if (!cameraOn) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      // Feature-detected rather than assumed: BarcodeDetector is Chromium-only
      // today, and a camera that opens and never decodes is worse than a clear
      // message saying to use a handheld scanner instead.
      const Detector = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
      if (!Detector) {
        setCameraError(
          "This browser cannot decode barcodes from the camera. Use a handheld scanner — it types into the box above and works everywhere.",
        );
        setCameraOn(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The back camera on a phone. `ideal` rather than `exact` so a laptop
          // with only one camera still works instead of failing outright.
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = new Detector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"],
        });

        timer = setInterval(() => {
          void (async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const found = await detector.detect(videoRef.current);
              for (const result of found) {
                if (result?.rawValue) void submitCode(String(result.rawValue));
              }
            } catch {
              // A single failed frame is normal — motion blur, bad light. The
              // next tick tries again; reporting it would be constant noise.
            }
          })();
        }, DECODE_INTERVAL_MS);
      } catch (error) {
        setCameraError(
          error instanceof Error && error.name === "NotAllowedError"
            ? "Camera permission was refused. Allow it in the browser, or use a handheld scanner."
            : "The camera could not be opened. A handheld scanner works without one.",
        );
        setCameraOn(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOn, submitCode]);

  /**
   * A hardware scanner, wherever the page's focus happens to be.
   *
   * Listening on the document rather than on the input, because a scan that
   * only lands when the right box is focused is a scan that disappears after
   * one stray click — silently, which is the worst way for a stock-take to
   * fail. The previous version re-focused the input every 1.5s to paper over
   * that, which also meant a phone had to hold its on-screen keyboard open all
   * the way round the shop.
   *
   * A burst is only treated as a scan if it is faster than a person can type —
   * see `classifyBurst`. Ordinary typing falls straight through to whatever is
   * focused, so the manual box, the quantity fields and the rest of the page
   * behave normally.
   */
  useEffect(() => {
    const strokes: Keystroke[] = [];

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBarcodeKey(event)) {
        strokes.length = 0;
        return;
      }

      if (event.key !== "Enter") {
        strokes.push({ key: event.key, at: Date.now() });
        return;
      }

      const verdict = classifyBurst(strokes);
      strokes.length = 0;
      if (!verdict.isScan) return;

      // It was a scanner. Swallow the Enter so the manual form does not also
      // submit, and clear anything that landed in the box on the way.
      event.preventDefault();
      setScannerSeen(true);
      if (inputRef.current) inputRef.current.value = "";
      setTyped("");
      void submitCode(verdict.code);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [submitCode]);

  // ---- Actions -------------------------------------------------------------
  const changeQuantity = async (line: ScanLine, next: number) => {
    setBusy(true);
    try {
      const result = next <= 0 ? await removeScanLine(line.id) : await setScanQuantity(line.id, next);
      setCart(result.cart);
    } finally {
      setBusy(false);
    }
  };

  const price = async () => {
    setPricing(true);
    setFeedback(null);
    try {
      const result = await fetchScanPrices();
      setCart(result.cart);
      setFeedback({
        kind: "ok",
        text: `Priced ${result.cart.pricedSkus ?? 0} of ${result.cart.requestedSkus ?? 0} supplier products`,
        at: Date.now(),
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Could not fetch prices",
        at: Date.now(),
      });
    } finally {
      setPricing(false);
    }
  };

  /**
   * Send every priced line to the cheapest supplier's basket.
   *
   * Only lines that HAVE a live price, and only suppliers with a real cart
   * integration. A line priced from the catalogue alone is not offered: the
   * basket would be filled on a number nobody has stood behind today.
   */
  const addAllToBaskets = async () => {
    if (!cart) return;
    setAdding(true);
    setFeedback(null);

    const bySupplier = new Map<string, { sku: string; quantity: number; name?: string }[]>();
    for (const line of cart.lines) {
      if (!line.best || !supportsCart(line.best.supplierId)) continue;
      const list = bySupplier.get(line.best.supplierId) ?? [];
      list.push({
        sku: line.best.supplierSku,
        quantity: line.quantity,
        ...(line.product?.name ? { name: line.product.name } : {}),
      });
      bySupplier.set(line.best.supplierId, list);
    }

    try {
      let added = 0;
      let failed = 0;
      for (const [supplierId, items] of bySupplier) {
        const result = await addItems(items, supplierId as CartSupplier);
        added += result.added + result.updated;
        failed += result.failed;
      }
      setFeedback({
        kind: failed > 0 ? "miss" : "ok",
        text: `${added} line${added === 1 ? "" : "s"} sent to supplier baskets${
          failed > 0 ? `, ${failed} failed` : ""
        }`,
        at: Date.now(),
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Could not reach the baskets",
        at: Date.now(),
      });
    } finally {
      setAdding(false);
    }
  };

  const lines = cart?.lines ?? [];
  const paged = usePagination(lines, { resetKey: lines.length });
  const priced = lines.filter((line) => line.best).length;
  const readyToOrder = lines.filter(
    (line) => line.best && supportsCart(line.best.supplierId),
  ).length;

  return (
    <AppShell active="Scan">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Scan</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Walk the shop and beep. Nothing is priced until you ask — scanning stays fast
            because it never waits on a supplier.
          </p>
        </div>
        <Link href="/orders" className="text-[13px] text-link hover:underline">
          Order list →
        </Link>
      </div>

      {/* ---- The scanner ---- */}
      <div className="mt-4 rounded-xl border border-line bg-surface p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitCode(typed);
            setTyped("");
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            ref={inputRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Scan or type a barcode…"
            aria-label="Barcode"
            autoComplete="off"
            className="w-full max-w-sm rounded-md border border-line bg-canvas px-3.5 py-2 text-[15px] tabular-nums text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <button
            type="submit"
            disabled={!typed.trim()}
            className="rounded-md bg-teal-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-700 disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setCameraError(null);
              setCameraOn((current) => !current);
            }}
            className="rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink"
          >
            {cameraOn ? "Stop camera" : "📷 Use camera"}
          </button>
        </form>

        <p className="mt-2 text-[11.5px] text-ink-faint">
          {scannerSeen ? (
            <span className="font-medium text-good-600">
              ✓ Scanner detected — just scan, the box does not need to be selected.
            </span>
          ) : (
            <>
              A handheld scanner works here with no setup — plug it in and scan. It types
              the digits and presses Enter, and is picked up wherever you are on the page.
            </>
          )}
        </p>

        {cameraError && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            {cameraError}
          </p>
        )}

        {cameraOn && (
          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-black">
            <video ref={videoRef} muted playsInline className="mx-auto max-h-64 w-full object-contain" />
          </div>
        )}

        {/* One line of feedback, not a log. The person is looking up at a shelf,
            not reading the screen — they need to know the beep registered. */}
        {feedback && (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-[12.5px] ${
              feedback.kind === "ok"
                ? "bg-good-50 text-good-600"
                : feedback.kind === "miss"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {feedback.text}
          </p>
        )}


      </div>

      {/* ---- What is in the cart ---- */}
      <div className="mt-5 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="text-[13px] text-ink">
            <span className="font-medium">{lines.length}</span> line
            {lines.length === 1 ? "" : "s"}
            {cart && cart.unrecognised > 0 && (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-medium text-amber-800">
                {cart.unrecognised} unrecognised
              </span>
            )}
            {priced > 0 && (
              <span className="ml-2 rounded bg-good-50 px-1.5 py-0.5 text-[11.5px] font-medium text-good-600">
                {priced} priced
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pricing || lines.length === 0}
              onClick={() => void price()}
              className="rounded-md bg-teal-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal-700 disabled:opacity-40"
            >
              {pricing ? "Fetching live prices…" : "Fetch live prices"}
            </button>
            <button
              type="button"
              disabled={adding || readyToOrder === 0}
              onClick={() => void addAllToBaskets()}
              title={
                readyToOrder === 0
                  ? "Fetch live prices first — nothing goes into a basket on a catalogue price"
                  : `Add ${readyToOrder} lines to their cheapest supplier's basket`
              }
              className="rounded-md border border-teal-600 px-3.5 py-1.5 text-[12.5px] font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {adding ? "Adding…" : `Add ${readyToOrder} to baskets`}
            </button>
            {lines.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void clearScanCart().then((result) => setCart(result.cart));
                }}
                className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:bg-canvas hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {lines.length === 0 && pending.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-ink-soft">
            Nothing scanned yet.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {/* Beeps that have not come back yet, at the top, showing the
                barcode as read. This is what makes a scan feel instant: the
                number appears with the beep, and fills in behind it. */}
            {pending.map((entry) => (
              <li key={`pending-${entry.code}`} className="flex items-center gap-3 bg-canvas/60 p-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-ink-faint">
                  <span className="animate-pulse text-[15px]">⋯</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="nums text-[13.5px] font-medium text-ink">{entry.code}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">Looking it up…</p>
                </div>
              </li>
            ))}

            {paged.items.map((line) => (
              <ScanRow
                key={line.id}
                line={line}
                busy={busy}
                onQuantity={(next) => void changeQuantity(line, next)}
              />
            ))}
          </ul>
        )}

        <Pagination paged={paged} label="lines" />
      </div>
    </AppShell>
  );
}

function ScanRow({
  line,
  busy,
  onQuantity,
}: {
  line: ScanLine;
  busy: boolean;
  onQuantity: (next: number) => void;
}) {
  const product = line.product;

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      {product?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt={product.name ?? line.scannedCode}
          className="h-11 w-11 shrink-0 rounded-lg border border-line bg-white object-contain"
          loading="lazy"
        />
      ) : (
        <ProductGlyph department="General" size={44} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13.5px] text-ink">
            {product?.name ?? <span className="text-ink-soft">Unrecognised barcode</span>}
          </span>

          {/* WHERE THIS CAME FROM. "Cross-referenced across three wholesalers"
              and "one catalogue mentions it" are different degrees of
              confidence, and a buyer choosing on them should know which. */}
          {line.resolvedFrom === "master" && (
            <span
              className="rounded bg-good-50 px-1.5 py-0.5 text-[10.5px] font-medium text-good-600"
              title="Mapped across two or more wholesalers"
            >
              mapped
            </span>
          )}
          {line.resolvedFrom === "catalogue" && (
            <span
              className="rounded bg-canvas px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft"
              title="Found in one wholesaler's own catalogue — no cross-supplier mapping"
            >
              catalogue
            </span>
          )}
        </div>

        <p className="mt-0.5 text-[11.5px] text-ink-faint">
          EAN <span className="nums">{line.gtin14 ?? line.scannedCode}</span>
          {product && ` · ${product.vendorCount} supplier${product.vendorCount === 1 ? "" : "s"}`}
          {product?.sizeText && ` · ${product.sizeText}`}
        </p>

        {/* Every supplier that stocks it, with the code and the page. NO
            catalogue price is rendered — until Fetch runs, the price column is
            deliberately empty rather than showing a figure from the last sync,
            which on screen is indistinguishable from a current one. */}
        {product && product.suppliers.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {product.suppliers.map((offer) => {
              const isBest =
                line.best?.supplierId === offer.supplierId &&
                line.best?.supplierSku === offer.supplierSku;

              return (
                <li
                  key={`${offer.supplierId}:${offer.supplierSku}`}
                  className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]"
                >
                  <span
                    className={`w-40 shrink-0 ${isBest ? "font-medium text-good-600" : "text-ink-soft"}`}
                  >
                    {cartSupplierLabel(offer.supplierId)}
                    {offer.isSingle && (
                      <span className="ml-1 text-amber-700" title="Break-pack single">
                        single
                      </span>
                    )}
                  </span>

                  <span className="nums w-20 shrink-0 text-right">
                    {offer.exVatCasePrice !== undefined ? (
                      <span className={isBest ? "font-medium text-good-600" : "text-ink"}>
                        {eur(offer.exVatCasePrice)}
                      </span>
                    ) : offer.repriced === false ? (
                      <span className="text-red-600" title="The supplier could not be reached">
                        not found
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </span>

                  <span className="nums text-ink-faint">{offer.supplierSku}</span>

                  {offer.productUrl && (
                    <a
                      href={offer.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link hover:underline"
                    >
                      view ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Once priced, who is cheapest and what the others wanted. Before
            that, nothing — a catalogue price here would be indistinguishable
            from a current one. */}
        {/* No catalogue held this barcode; it was found by asking the suppliers
            directly. One price and no comparison — which is the truth about it,
            not a gap in the answer. */}
        {line.liveOnly && line.best && (
          <p className="mt-1 text-[11.5px]">
            <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">
              found live at {cartSupplierLabel(line.best.supplierId)} ·{" "}
              {eur(line.best.exVatCasePrice)}
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => onQuantity(line.quantity - 1)}
          className="h-7 w-7 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
          aria-label={`Decrease ${line.scannedCode}`}
        >
          {line.quantity <= 1 ? "🗑" : "−"}
        </button>
        <span className="w-8 text-center text-[13.5px] tabular-nums text-ink">{line.quantity}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onQuantity(line.quantity + 1)}
          className="h-7 w-7 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
          aria-label={`Increase ${line.scannedCode}`}
        >
          ＋
        </button>
      </div>
    </li>
  );
}
