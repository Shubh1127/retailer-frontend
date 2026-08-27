"use client";

/**
 * The full-screen scanner. Phones only.
 *
 * WHY IT TAKES THE WHOLE SCREEN. Scanning is done standing in an aisle, one
 * hand holding a product and the other holding the phone, looking at a shelf
 * rather than at the device. A camera in a card halfway down a scrolling page
 * asks for aim it will not get. Full screen means the viewfinder IS the screen
 * and there is nothing to scroll away from.
 *
 * WHAT SITS ON TOP OF IT, AND WHY THAT ORDER
 *
 *   the sheet handle  bottom right, next to the input, because that is where a
 *                     thumb already is
 *   the input         bottom, reachable one-handed, for the barcode the camera
 *                     will not read — a torn label, a bottle in shrink wrap
 *   torch + gallery   directly above the input, the two things wanted mid-scan
 *
 * Everything is anchored to the BOTTOM. A control at the top of a phone is a
 * two-handed control, and both of this person's hands are busy.
 *
 * THE SHEET HAS TWO HEIGHTS, DELIBERATELY
 *
 *   peek  most of the screen, with a band of camera still showing above it, so
 *         it reads as covering the scanner rather than replacing it — and so
 *         somebody checking a quantity can see they are still scanning
 *   full  edge to edge, once prices are being fetched, because that is a
 *         different job: reading and comparing, not scanning
 *
 * TORCH IS FEATURE-DETECTED, NOT ASSUMED. `torch` is a capability of the video
 * TRACK and only some devices expose it — every iPhone browser does not. The
 * button is hidden entirely rather than shown dead, because a light switch that
 * does nothing is worse than no light switch.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { eur } from "@/lib/mock-data";
import { cartSupplierLabel } from "@/lib/api/cart";
import type { ScanCart, ScanLine } from "@/lib/api/scan";

/** How often the camera is asked to decode. ~7/s is well past a human's pace. */
const DECODE_INTERVAL_MS = 140;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"] as const;

type Sheet = "closed" | "peek" | "full";

// ---------------------------------------------------------------------------
// Icons — inline, so the overlay costs no request.
// ---------------------------------------------------------------------------
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const TorchIcon = ({ on }: { on: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="M9 2h6l-1 5h3l-7 15 1.5-9H8L9 2Z" fill={on ? "currentColor" : "none"} />
  </svg>
);

const GalleryIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 5-5 4 4 3-2.5 4 3.5" />
  </svg>
);

const ChevronUp = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="m6 15 6-6 6 6" />
  </svg>
);

const ChevronDown = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

// ---------------------------------------------------------------------------

export interface MobileScannerProps {
  open: boolean;
  onClose: () => void;
  /** One decoded barcode. The page owns duplicate rules and the cart. */
  onScan: (code: string) => void;
  cart: ScanCart | null;
  onQuantity: (line: ScanLine, next: number) => void;
  onFetchPrices: () => Promise<void>;
  pricing: boolean;
  /** The most recent thing the page wants said, verbatim. */
  message?: string;
}

export default function MobileScanner({
  open,
  onClose,
  onScan,
  cart,
  onQuantity,
  onFetchPrices,
  pricing,
  message,
}: MobileScannerProps) {
  const [sheet, setSheet] = useState<Sheet>("closed");
  const [typed, setTyped] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const lines = cart?.lines ?? [];
  const priced = lines.filter((line) => line.best).length;

  // ---- The camera ----------------------------------------------------------
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const Detector = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
      if (!Detector) {
        setError(
          "This browser cannot read barcodes from the camera. Type the number below, or use a handheld scanner.",
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // `ideal`, not `exact`: a device with only a front camera should still
          // open rather than fail outright.
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

        // Torch lives on the TRACK, and only some devices have it.
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchAvailable(Boolean(capabilities?.torch));

        const detector = new Detector({ formats: FORMATS });

        timer = setInterval(() => {
          void (async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const found = await detector.detect(videoRef.current);
              for (const result of found) {
                if (result?.rawValue) onScan(String(result.rawValue));
              }
            } catch {
              // A single failed frame is normal — motion blur, bad light. The
              // next tick tries again; reporting it would be constant noise.
            }
          })();
        }, DECODE_INTERVAL_MS);
      } catch (err) {
        setError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera permission was refused. Type the barcode below, or allow the camera in your browser settings."
            : "The camera could not be opened. Type the barcode below instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setTorchOn(false);
      setTorchAvailable(false);
    };
  }, [open, onScan]);

  // Reset when it closes, so re-opening does not resume mid-sheet.
  useEffect(() => {
    if (!open) {
      setSheet("closed");
      setError(null);
      setTyped("");
    }
  }, [open]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      // `torch` is real and widely implemented but is not in the DOM typings,
      // so the cast goes through `unknown` rather than pretending the shapes
      // overlap.
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      // Some devices advertise torch and then refuse it. Hide the control
      // rather than leave a button that does nothing.
      setTorchAvailable(false);
    }
  }, [torchOn]);

  /**
   * Decode every barcode in a photo.
   *
   * One image can hold a whole shelf label strip, and `detect` returns all of
   * them — so this is the fast way to take a delivery: photograph the docket,
   * scan it once.
   */
  const onGallery = useCallback(
    async (file: File) => {
      const Detector = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
      if (!Detector) return;

      setGalleryBusy(true);
      try {
        const bitmap = await createImageBitmap(file);
        const detector = new Detector({ formats: FORMATS });
        const found = await detector.detect(bitmap);
        bitmap.close?.();

        if (found.length === 0) {
          setError("No barcode found in that image.");
          return;
        }

        setError(null);
        for (const result of found) {
          if (result?.rawValue) onScan(String(result.rawValue));
        }
        // Straight to the list: a photo of ten barcodes is ten decisions, and
        // they are made in the sheet rather than over the viewfinder.
        setSheet("peek");
      } catch {
        setError("That image could not be read.");
      } finally {
        setGalleryBusy(false);
      }
    },
    [onScan],
  );

  if (!open) return null;

  const sheetHeight = sheet === "full" ? "100%" : "86%";

  return (
    <div className="fixed inset-0 z-[60] bg-black lg:hidden">
      {/* ---- Viewfinder ---- */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* A frame to aim with. Nothing enforces it — the detector reads the
          whole frame — but a rectangle is what makes people hold the phone
          still, which is what actually helps. */}
      <div className="pointer-events-none absolute inset-x-10 top-1/2 h-40 -translate-y-24 rounded-2xl border-2 border-white/70" />

      {/* ---- Close ---- */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the scanner"
        className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <CloseIcon />
      </button>

      {/* ---- What just happened ---- */}
      {(message || error) && (
        <div
          className="absolute inset-x-3 top-3 mr-14 rounded-lg bg-black/60 px-3 py-2 text-[12.5px] text-white backdrop-blur"
          style={{ marginTop: "env(safe-area-inset-top)" }}
        >
          {error ?? message}
        </div>
      )}

      {/* ---- Controls, all anchored to the bottom ---- */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {/* Torch and gallery, directly above the input. */}
        <div className="mb-2 flex items-center gap-2">
          {torchAvailable && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
              aria-label={torchOn ? "Turn the light off" : "Turn the light on"}
              className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur ${
                torchOn ? "bg-white text-black" : "bg-black/50 text-white"
              }`}
            >
              <TorchIcon on={torchOn} />
            </button>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={galleryBusy}
            aria-label="Scan barcodes from a photo"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur disabled:opacity-50"
          >
            <GalleryIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the SAME file twice fires again.
              event.target.value = "";
              if (file) void onGallery(file);
            }}
          />

          {galleryBusy && (
            <span className="rounded-full bg-black/50 px-3 py-1.5 text-[12px] text-white backdrop-blur">
              Reading the image…
            </span>
          )}
        </div>

        {/* Manual entry, and the handle that opens the list. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const code = typed.trim();
            if (!code) return;
            onScan(code);
            setTyped("");
          }}
          className="flex items-center gap-2"
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            inputMode="numeric"
            placeholder="Type a barcode…"
            aria-label="Type a barcode"
            className="nums h-11 min-w-0 flex-1 rounded-full border border-white/25 bg-black/50 px-4 text-[15px] text-white placeholder:text-white/50 backdrop-blur focus:border-white/60 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => setSheet(sheet === "closed" ? "peek" : "closed")}
            aria-label={sheet === "closed" ? "Show what you have scanned" : "Hide the list"}
            aria-expanded={sheet !== "closed"}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black"
          >
            <ChevronUp />
            {lines.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1 text-[11px] font-semibold text-white">
                {lines.length}
              </span>
            )}
          </button>
        </form>
      </div>

      {/* ---- The sheet ---- */}
      <AnimatePresence>
        {sheet !== "closed" && (
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0, height: sheetHeight }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.3 }}
            className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-line bg-surface"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink">
                  {lines.length} scanned
                </p>
                <p className="text-[12px] text-ink-soft">
                  {priced > 0
                    ? `${priced} priced · prices are ex-VAT per case`
                    : "Prices are fetched when you ask — nothing has been sent to a supplier"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSheet("closed")}
                aria-label="Back to the camera"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft"
              >
                <ChevronDown />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {lines.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13px] text-ink-soft">
                  Nothing scanned yet.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {lines.map((line) => (
                    <SheetRow key={line.id} line={line} onQuantity={onQuantity} />
                  ))}
                </ul>
              )}
            </div>

            <div
              className="border-t border-line p-3"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
            >
              <button
                type="button"
                disabled={pricing || lines.length === 0}
                onClick={() => {
                  // Full screen FIRST: reading prices is a different job from
                  // scanning, and the band of camera above stops being useful
                  // the moment somebody is comparing numbers.
                  setSheet("full");
                  void onFetchPrices();
                }}
                className="w-full rounded-full bg-teal-600 py-3 text-[14px] font-medium text-white disabled:opacity-40"
              >
                {pricing ? "Fetching live prices…" : "Fetch live prices"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SheetRow({
  line,
  onQuantity,
}: {
  line: ScanLine;
  onQuantity: (line: ScanLine, next: number) => void;
}) {
  const suppliers = line.product?.suppliers ?? [];

  return (
    <li className="p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] text-ink">
            {line.product?.name ?? (
              <span className="text-ink-soft">Unrecognised barcode</span>
            )}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            EAN <span className="nums">{line.gtin14 ?? line.scannedCode}</span>
            {line.product && ` · ${line.product.vendorCount} supplier`}
            {line.product && line.product.vendorCount === 1 ? "" : line.product ? "s" : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onQuantity(line, line.quantity - 1)}
            aria-label={`Decrease ${line.scannedCode}`}
            className="h-8 w-8 rounded-full border border-line text-[14px] leading-none text-ink-soft"
          >
            {line.quantity <= 1 ? "🗑" : "−"}
          </button>
          <span className="w-7 text-center text-[14px] tabular-nums text-ink">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => onQuantity(line, line.quantity + 1)}
            aria-label={`Increase ${line.scannedCode}`}
            className="h-8 w-8 rounded-full border border-line text-[14px] leading-none text-ink-soft"
          >
            ＋
          </button>
        </div>
      </div>

      {/* Prices only once they are live. A catalogue price here would be
          indistinguishable from one a supplier quoted today. */}
      {suppliers.some((offer) => offer.exVatCasePrice !== undefined) && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-canvas p-2">
          {suppliers.map((offer) => {
            const best =
              line.best?.supplierId === offer.supplierId &&
              line.best?.supplierSku === offer.supplierSku;

            return (
              <li
                key={`${offer.supplierId}:${offer.supplierSku}`}
                className="flex items-baseline justify-between gap-2 text-[12px]"
              >
                <span className={best ? "font-medium text-good-600" : "text-ink-soft"}>
                  {cartSupplierLabel(offer.supplierId)}
                </span>
                <span className={`nums ${best ? "font-medium text-good-600" : "text-ink"}`}>
                  {offer.exVatCasePrice !== undefined ? (
                    eur(offer.exVatCasePrice)
                  ) : offer.repriced === false ? (
                    <span className="text-red-600">not found</span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
