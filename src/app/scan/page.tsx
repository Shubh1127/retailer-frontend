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
 * SCANNING THE SAME BARCODE AGAIN DOES NOT ADD ANOTHER
 *
 * This was wrong at first and the failure was instructive. A camera decodes the
 * same barcode many times a second while it stays in frame, and the original
 * rule — ignore a repeat for two seconds — assumed somebody would move the
 * product away once it registered. They do not: the screen takes a moment, so
 * they hold it there to check it worked, and at two seconds the count starts
 * climbing on its own. The quantity was being set by how long somebody hesitated.
 *
 * So a barcode already in the cart is NEVER added again by scanning. It is
 * reported as already there, its row is highlighted so the beep is visibly
 * acknowledged, and quantity is changed deliberately with the ＋ and − buttons.
 * The short window below only covers the gap before the cart has caught up.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import StockLine from "@/components/StockLine";
import Link from "next/link";

import AppShell from "@/components/AppShell";
import MobileScanner from "@/components/MobileScanner";
import ScanCard from "@/components/ScanProductCard";
import { useIsMobile } from "@/lib/useMediaQuery";
import ProductGlyph from "@/components/ProductGlyph";
import Pagination, { usePagination } from "@/components/Pagination";
import { ApiError } from "@/lib/api/client";
import { cartSupplierLabel, supportsCart, addItems, type CartSupplier } from "@/lib/api/cart";
import { eur } from "@/lib/mock-data";
import {
  classifyBurst,
  isBarcodeKey,
  sameBarcode,
  type Keystroke,
} from "@/lib/scannerInput";
import { createCameraScanStream } from "@/lib/cameraScanStream";
import {
  clearScanCart,
  discoverScanLine,
  fetchScanPrices,
  getScanCart,
  recordScan,
  removeScanLine,
  setScanQuantity,
  type ScanCart,
  type ScanLine,
} from "@/lib/api/scan";

/**
 * Barcodes accepted in this session, so a repeat is refused INSTANTLY.
 *
 * WHY A TIME WINDOW WAS NOT ENOUGH, AND THE MEASUREMENT THAT SHOWED IT.
 *
 * The rule has always been "a barcode already in the cart is never added again
 * by scanning" — but the cart it checked came back from the server, and reading
 * the cart re-resolves EVERY line against the master table and the catalogues.
 * On a cart of any size that takes longer than the 1.5s window the guard leaned
 * on. So somebody holding a product in front of the camera got: first frame
 * accepted, window expires, cart still in flight, second frame accepted — and
 * the quantity climbed on its own, which is the exact bug the guard exists to
 * prevent.
 *
 * A set held here is updated SYNCHRONOUSLY, before the request goes out, so
 * there is no gap for a second frame to fall through. It is keyed on the
 * significant digits, so a 13-digit shelf edge and a 14-digit outer are one
 * entry.
 *
 * Entries are dropped when a line is removed or the list is cleared, because
 * then re-scanning it is a deliberate act rather than a stutter.
 */
function barcodeKey(code: string): string {
  return code.trim().replace(/^0+/, "");
}

/** How often the camera is asked to decode. ~7/s is well past a human's pace. */
const DECODE_INTERVAL_MS = 140;

/**
 * How long to wait before writing a quantity, so a run of presses is one write.
 *
 * Long enough to collect a burst of ＋ presses, short enough that nobody
 * navigates away before it fires. The screen has already moved; this only
 * decides when the database catches up.
 */
const QUANTITY_FLUSH_MS = 400;

type Feedback = { kind: "ok" | "miss" | "error"; text: string; at: number };

export default function ScanPage() {
  const [cart, setCart] = useState<ScanCart | null>(null);
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /**
   * Emptying the cart, which is the one list action still worth waiting on.
   *
   * Quantity changes are optimistic because their outcome is not in doubt.
   * Clear throws away everything somebody walked a shop to collect, so it says
   * plainly that it is working rather than blanking the screen and hoping.
   */
  const [clearing, setClearing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  /**
   * Which scanner the camera button opens.
   *
   * A MEDIA QUERY, NOT A CSS CLASS. Rendering both and hiding one would mount
   * two cameras: the second `getUserMedia` either fails or takes the first's
   * track, and the visible preview goes black. Only one may exist, so the
   * component has to know which one it is.
   */
  const isMobile = useIsMobile();

  /**
   * `/scan?camera=1` — arriving from the tab bar's Scan button.
   *
   * Tapping a scan icon means "I want to scan", so the viewfinder opens on
   * arrival rather than behind another button.
   *
   * READ FROM `window.location` RATHER THAN `useSearchParams`. That hook makes
   * the route opt out of static rendering unless it is wrapped in a Suspense
   * boundary, which is a lot of ceremony for one flag read once on mount.
   *
   * The flag is STRIPPED as it is consumed, so coming back to /scan — from the
   * tab bar, or the back button — lands on the list rather than reopening the
   * camera on somebody who was reading it.
   */
  useEffect(() => {
    if (!isMobile) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("camera") === "1") setCameraOn(true);
  }, [isMobile]);

  /**
   * The URL says whether the camera is open, so a refresh does not close it.
   *
   * The flag used to be stripped the moment it was read, which meant reloading
   * mid-scan dropped somebody back to a list with the viewfinder shut — on a
   * phone, in an aisle, holding a product. Keeping it in the URL makes the
   * camera part of where you ARE rather than something that happened on the
   * way in, so refresh and back both behave.
   *
   * `replaceState`, never `push`: opening and closing a viewfinder should not
   * fill the back stack with entries that look identical.
   */
  useEffect(() => {
    if (!isMobile) return;
    const wanted = cameraOn ? "/scan?camera=1" : "/scan";
    if (window.location.pathname + window.location.search !== wanted) {
      window.history.replaceState(null, "", wanted);
    }
  }, [cameraOn, isMobile]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /**
   * Whether a hardware scanner has been seen typing.
   *
   * Inferred, not detected — a scanner is a keyboard as far as the browser is
   * concerned. Shown because the alternative is a retailer wondering whether
   * the thing in their hand is doing anything.
   */
  const [scannerSeen, setScannerSeen] = useState(false);
  /** The row a repeat scan just pointed at, so the beep is acknowledged. */
  const [highlight, setHighlight] = useState<number | null>(null);
  /** Lines whose background supplier lookup is still running. */
  const [discovering, setDiscovering] = useState<number[]>([]);

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
  const accepted = useRef<Set<string>>(new Set());

  /**
   * Frame-level de-duplication for the CAMERA, kept apart from `accepted`.
   *
   * `accepted` answers "has this been scanned this session" — a question about
   * the cart, which is why it is cleared when a line is deleted and per barcode
   * when a request fails. A video stream needs a different question answered:
   * "is this the same label I am still looking at". Sixteen barcodes on a sheet
   * held in front of the lens are sixteen detections SEVEN TIMES A SECOND, and
   * routing those through a cart-shaped guard produced sixty-one lines.
   *
   * A ref, so the decode loop is not rebuilt when it changes — restarting the
   * camera on every scan is the bug this page has already had once.
   */
  const scanStream = useRef(createCameraScanStream());

  /**
   * The cart, readable from inside `submitCode` without re-creating it.
   *
   * `submitCode` is memoised and is captured by the camera's decode loop and by
   * the document-level key listener. Adding `cart` to its dependencies would
   * rebuild both on every scan — tearing down and restarting the camera timer
   * each time — so the current value is mirrored into a ref instead.
   */
  const cartRef = useRef<ScanCart | null>(null);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // A highlight is an acknowledgement, not a selection — it fades by itself.
  useEffect(() => {
    if (highlight === null) return;
    const timer = setTimeout(() => setHighlight(null), 1800);
    return () => clearTimeout(timer);
  }, [highlight]);

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

      // ALREADY SCANNED — acknowledge it, change nothing.
      //
      // The local set is checked FIRST and is authoritative for this session:
      // it is written synchronously, so a camera decoding the same barcode
      // seven times a second cannot slip past it while the cart is loading.
      // The cart is checked too, for lines that were already there when the
      // page opened.
      const key = barcodeKey(code);
      const existing = (cartRef.current?.lines ?? []).find(
        (candidate) =>
          sameBarcode(candidate.scannedCode, code) || sameBarcode(candidate.gtin14, code),
      );

      if (accepted.current.has(key) || existing) {
        if (existing) setHighlight(existing.id);
        setFeedback({
          kind: "miss",
          text: existing
            ? `${code} — already in the list (qty ${existing.quantity}). Use ＋ to add more.`
            : `${code} — already scanned. Use ＋ to add more.`,
          at: Date.now(),
        });
        return;
      }

      accepted.current.add(key);

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
                    ? // Not a verdict yet — the background lookup below is
                      // about to ask the suppliers directly.
                      `${code} — not in our catalogues, checking suppliers…`
                    : `${code} — not a valid barcode`,
                at: Date.now(),
              },
        );

        await load();

        /**
         * Nothing of ours holds this barcode — ask the suppliers, in the
         * background.
         *
         * NOT AWAITED, deliberately. It is up to four live searches and takes
         * seconds; waiting on it here would put that in front of the next beep,
         * which is the one thing the scanner may not do. The answer lands on a
         * later refresh, and the row fills itself in.
         */
        if (!line.product && source === "barcode") {
          setDiscovering((current) => [...current, line.id]);
          void discoverScanLine(line.id)
            .then((result) => {
              setFeedback({
                kind: result.discovered ? "ok" : "miss",
                text: result.discovered
                  ? `${code} · found at ${result.name ?? result.supplierId}`
                  : `${code} — not found at any supplier`,
                at: Date.now(),
              });
              if (result.discovered) void load();
            })
            .catch(() => {
              // A supplier being unreachable is not worth interrupting a
              // scanning session for. The Fetch button asks again later.
            })
            .finally(() => {
              setDiscovering((current) => current.filter((id) => id !== line.id));
            });
        }
      } catch (error) {
        // It never landed, so it is not in the list — let it be scanned again.
        accepted.current.delete(key);
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
    // On a phone the full-screen scanner owns the camera. Opening a second
    // stream here would blank whichever one lost the race.
    if (!cameraOn || isMobile) return;

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

            let raw: string[] = [];
            try {
              const found = await detector.detect(videoRef.current);
              raw = found
                .map((result: { rawValue?: unknown }) => String(result?.rawValue ?? ""))
                .filter((value: string) => value !== "");
            } catch {
              // A single failed frame is normal — motion blur, bad light. The
              // next tick tries again; reporting it would be constant noise.
            }

            /**
             * EVERY FRAME GOES THROUGH THE STREAM, including empty ones.
             *
             * That is how a barcode leaving the view is noticed. Feeding it
             * only when something decoded would keep every label "visible" for
             * ever, and the first real absence would never be counted.
             *
             * A failed decode is fed as an empty frame rather than skipped, for
             * the same reason: from the stream's point of view a frame that
             * threw and a frame that saw nothing are the same fact.
             */
            for (const code of scanStream.current.frame(raw)) {
              void submitCode(code);
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
      // Closing the camera ends the continuity the stream is tracking. Without
      // this, reopening it on a product still in view would suppress the first
      // scan and look like the camera had stopped working.
      scanStream.current.reset();
    };
  }, [cameraOn, isMobile, submitCode]);

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

  /**
   * Pending quantity writes, one timer per line.
   *
   * A buyer correcting 1 to 6 presses ＋ five times in about a second. Sending
   * five requests wastes four of them, and — worse — they can land out of order
   * and leave the row showing 4 because the third arrived last. Only the final
   * number is sent, once the pressing stops.
   */
  const flushTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(
    () => () => {
      for (const timer of flushTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  /**
   * Change a quantity, or remove the line at zero.
   *
   * ON SCREEN FIRST, SERVER SECOND. Pressing ＋ used to await a round trip that
   * re-resolved every line in the cart before answering, and disabled every
   * other row while it ran — so a list of thirty products froze for as long as
   * it took, on a click whose outcome was never in doubt.
   *
   * The change is applied locally and the write follows. There is nothing to
   * reconcile on success: the server was told a number and stored it. A FAILURE
   * puts the old value back and says so, because a quantity that silently
   * reverted would be worse than one that never moved.
   */
  const changeQuantity = useCallback((line: ScanLine, next: number) => {
    const quantity = Math.max(0, Math.floor(next));

    // Deleting a line makes re-scanning it a deliberate act again, so the
    // barcode stops being refused. Without this a product removed by mistake
    // could never be put back by scanning.
    if (quantity <= 0) {
      accepted.current.delete(barcodeKey(line.scannedCode));
      if (line.gtin14) accepted.current.delete(barcodeKey(line.gtin14));
    }

    // The value to roll back to, captured before the optimistic write.
    const previous = cartRef.current?.lines.find((entry) => entry.id === line.id) ?? line;

    setCart((current) => {
      if (!current) return current;
      return {
        ...current,
        lines:
          quantity <= 0
            ? current.lines.filter((entry) => entry.id !== line.id)
            : current.lines.map((entry) =>
                entry.id === line.id ? { ...entry, quantity } : entry,
              ),
      };
    });

    const existing = flushTimers.current.get(line.id);
    if (existing) clearTimeout(existing);

    const restore = (message: string) => {
      setFeedback({ kind: "error", text: message, at: Date.now() });
      // Re-read rather than splice the old row back in: by now the local list
      // may have moved on, and the server is the only thing that knows what is
      // actually stored.
      void load();
    };

    flushTimers.current.set(
      line.id,
      setTimeout(() => {
        flushTimers.current.delete(line.id);

        const write =
          quantity <= 0 ? removeScanLine(line.id) : setScanQuantity(line.id, quantity);

        void write.catch((error) =>
          restore(
            error instanceof ApiError
              ? `Could not update ${previous.name ?? previous.scannedCode}: ${error.message}`
              : `Could not update ${previous.name ?? previous.scannedCode}`,
          ),
        );
      }, QUANTITY_FLUSH_MS),
    );
  }, [load]);

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

        {cameraOn && !isMobile && (
          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="mx-auto max-h-64 w-full object-contain"
            />
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
                disabled={clearing}
                onClick={() => {
                  setClearing(true);
                  void clearScanCart()
                    .then((result) => {
                      // Nothing is in the list any more, so nothing is a repeat.
                      accepted.current.clear();
                      setCart(result.cart);
                    })
                    .catch((error) =>
                      setFeedback({
                        kind: "error",
                        text:
                          error instanceof ApiError
                            ? error.message
                            : "Could not clear the list",
                        at: Date.now(),
                      }),
                    )
                    .finally(() => setClearing(false));
                }}
                className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40"
              >
                {clearing ? "Clearing…" : "Clear"}
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

            {paged.items.map((line) => {
              /**
               * BOTH LAYOUTS ARE RENDERED and CSS decides which is seen —
               * unlike the camera, where two mounted copies would open two
               * video streams. Markup is free, and a `useMediaQuery` here would
               * mean the server's HTML and the browser's first paint disagreed
               * about which one exists.
               */
              const shared = {
                line,
                highlighted: highlight === line.id,
                discovering: discovering.includes(line.id),
                onQuantity: (next: number) => void changeQuantity(line, next),
              };

              return (
                <Fragment key={line.id}>
                  <ScanCard {...shared} />
                  <ScanRow {...shared} />
                </Fragment>
              );
            })}
          </ul>
        )}

        <Pagination paged={paged} label="lines" />
      </div>

      {/* Phones only. Everything it needs — the cart, the duplicate rules, the
          optimistic quantity writes — already lives on this page, so it is
          handed those rather than owning a second copy of any of them. */}
      <MobileScanner
        open={cameraOn && isMobile}
        onClose={() => setCameraOn(false)}
        onScan={(code) => void submitCode(code)}
        cart={cart}
        onQuantity={changeQuantity}
        onFetchPrices={price}
        pricing={pricing}
        {...(feedback ? { message: feedback.text } : {})}
      />
    </AppShell>
  );
}

/**
 * The product picture, with somewhere to fall back to.
 *
 * TWO FALLBACKS, AND BOTH HAVE BEEN NEEDED. The master row's image comes from
 * the preferred supplier, which is usually Musgrave — and Musgrave publish
 * RELATIVE paths, so for a while every mapped product silently had no picture.
 * That is fixed in the catalogue adapter, but a URL that 404s for any other
 * reason (a product delisted, a CDN path changed between syncs) should not
 * leave a broken-image icon on a shop floor.
 *
 * So: the master image, then any supplier that publishes one, then the
 * departmental glyph. Each step is taken only when the previous one actually
 * failed to load, not guessed at in advance.
 */
function ScanThumb({ line }: { line: ScanLine }) {
  const candidates = [
    line.product?.imageUrl,
    ...(line.product?.suppliers ?? []).map((offer) => offer.imageUrl),
  ].filter((url): url is string => Boolean(url));

  const [attempt, setAttempt] = useState(0);
  const src = candidates[attempt];

  if (!src) return <ProductGlyph department="General" size={44} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={line.product?.name ?? line.scannedCode}
      onError={() => setAttempt((current) => current + 1)}
      className="h-11 w-11 shrink-0 rounded-lg border border-line bg-white object-contain"
      loading="lazy"
    />
  );
}

function ScanRow({
  line,
  highlighted,
  discovering,
  onQuantity,
}: {
  line: ScanLine;
  /** A repeat scan just pointed at this row. See the header. */
  highlighted?: boolean;
  /** The background supplier lookup for this barcode is still running. */
  discovering?: boolean;
  onQuantity: (next: number) => void;
}) {
  const product = line.product;

  return (
    <li
      className={`hidden flex-wrap items-center gap-3 p-3 transition-colors duration-500 lg:flex ${
        highlighted ? "bg-amber-50" : ""
      }`}
    >
      <ScanThumb line={line} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13.5px] text-ink">
            {product?.name ??
              (discovering ? (
                // Honest about what is happening: no catalogue of ours holds
                // this, so the suppliers are being asked directly. Saying
                // "unrecognised" while that runs states a verdict we do not
                // have yet.
                <span className="text-ink-soft">Checking suppliers…</span>
              ) : (
                <span className="text-ink-soft">Not found</span>
              ))}
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
                    {/* UNDER THE PRICE. A cheaper supplier that did not win is
                        confusing without it — this is the reason. */}
                    <StockLine
                      inStock={offer.inStock}
                      {...(offer.availabilityText
                        ? { availabilityText: offer.availabilityText }
                        : {})}
                      supplierName={cartSupplierLabel(offer.supplierId)}
                    />
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
        {/* Never disabled. The change is local and instant; there is nothing
            in flight for a buyer to wait on. */}
        <button
          type="button"
          onClick={() => onQuantity(line.quantity - 1)}
          className="h-7 w-7 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
          aria-label={`Decrease ${line.scannedCode}`}
        >
          {line.quantity <= 1 ? "🗑" : "−"}
        </button>
        <span className="w-8 text-center text-[13.5px] tabular-nums text-ink">
          {line.quantity}
        </span>
        <button
          type="button"
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
