/**
 * Turning a stream of camera frames into physical scans.
 *
 * WHAT WENT WRONG WITHOUT IT
 *
 * `BarcodeDetector` is asked for a decode roughly seven times a second and
 * reports EVERY barcode it can currently see, every time. A printed sheet held
 * in front of the lens is therefore not sixteen detections, it is sixteen
 * detections per frame for as long as the sheet is there — and each one was
 * being handed straight to `submitCode`. Sixteen labels produced sixty-one
 * cart lines.
 *
 * The page already had a duplicate guard, and it was the wrong tool. That set
 * answers "has this been scanned during this session", which is a question
 * about the CART: it is deliberately cleared when a line is deleted, and
 * cleared per barcode when a request fails, because both of those make
 * re-scanning a deliberate act. A continuous video stream needs the opposite —
 * something that answers "is this the same barcode I am still looking at", and
 * that must not be affected by what the server said.
 *
 * So this is a separate layer, in front of the existing one, and the hardware
 * scanner does not go through it at all. A handheld reader emits one burst per
 * trigger pull; it has no frames to deduplicate and its own guard is correct
 * for it.
 *
 * HOW IT DECIDES
 *
 * A barcode is emitted the frame it APPEARS, and then suppressed for as long as
 * it stays in view — however many seconds that is. Not a timeout: a sheet left
 * on the counter for a minute is still one scan of each label, and a timeout
 * would silently start counting again.
 *
 * It stops being "in view" only after several CONSECUTIVE frames without it,
 * because detection flickers constantly — motion blur, a hand crossing the
 * lens, a bad angle for one tick. One missed frame means nothing. After that it
 * is genuinely gone, and seeing it again is a new physical scan: the buyer
 * moved the pack away and brought it back, which is how somebody deliberately
 * scans a second case.
 *
 * WHAT IT REFUSES
 *
 * Anything that is not a valid GTIN. A camera pointed at a printed sheet
 * produces junk — ITF and Code 128 in particular decode fragments of a longer
 * symbol and neighbouring labels bleed together — and every one of those was
 * becoming a cart line reading "not a valid barcode". A misread is not a
 * decision anybody made, so the camera drops it silently. A person whose real
 * product has an unreadable barcode still has the manual box and the handheld
 * scanner, both of which report the problem rather than swallowing it.
 */

/** Consecutive frames a barcode must be ABSENT for before it counts as gone. */
const MISSES_BEFORE_GONE = 3;

/**
 * The GS1 mod-10 check digit.
 *
 * Weights alternate 3 and 1 from the right of the body, which is why a
 * zero-padded GTIN-14 and the EAN-13 printed on the pack validate identically —
 * padding adds zeros that contribute nothing.
 */
function hasValidCheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);

  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    // From the RIGHT of the body: the rightmost body digit carries weight 3.
    const fromRight = body.length - 1 - index;
    sum += Number(body[index]) * (fromRight % 2 === 0 ? 3 : 1);
  }

  return (10 - (sum % 10)) % 10 === check;
}

/**
 * One barcode as a comparable key, or `undefined` if it is not a barcode.
 *
 * SIGNIFICANT DIGITS, so `5000112626940` and `05000112626940` are one product
 * and not two — the same rule `sameBarcode` applies to the hardware path, and
 * the same rule the backend's canonical GTIN-14 collapses to.
 */
export function canonicalBarcode(raw: string): string | undefined {
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return undefined;
  if (![8, 12, 13, 14].includes(digits.length)) return undefined;
  if (!hasValidCheckDigit(digits)) return undefined;

  const significant = digits.replace(/^0+/, '');
  return significant === '' ? undefined : significant;
}

export interface CameraScanStream {
  /**
   * Hand over one frame's raw detections; get back the barcodes to act on.
   *
   * MUST BE CALLED FOR EVERY FRAME, including ones that decoded nothing —
   * that is how a barcode leaving the view is noticed. A loop that only called
   * this when it found something would keep every barcode "visible" for ever.
   */
  frame(detections: readonly string[]): string[];

  /** Forget everything. For closing the camera, so reopening starts clean. */
  reset(): void;

  /** What is currently in view. For tests and diagnostics. */
  visible(): string[];
}

export function createCameraScanStream(
  options: { missesBeforeGone?: number } = {},
): CameraScanStream {
  const missesBeforeGone = Math.max(1, options.missesBeforeGone ?? MISSES_BEFORE_GONE);

  /** canonical barcode → consecutive frames it has been missing for. */
  const inView = new Map<string, number>();

  return {
    frame(detections) {
      // Deduplicated WITHIN the frame first. A detector can report the same
      // symbol twice in one pass — two overlapping regions of one label — and
      // that is one barcode, not two.
      const seen = new Set<string>();
      for (const raw of detections) {
        const code = canonicalBarcode(String(raw ?? ''));
        if (code) seen.add(code);
      }

      const fresh: string[] = [];

      for (const code of seen) {
        if (!inView.has(code)) fresh.push(code);
        // Zero either way: still here, so the absence count restarts.
        inView.set(code, 0);
      }

      // Everything tracked but not seen this frame is one frame closer to gone.
      for (const [code, misses] of [...inView]) {
        if (seen.has(code)) continue;
        if (misses + 1 >= missesBeforeGone) inView.delete(code);
        else inView.set(code, misses + 1);
      }

      return fresh;
    },

    reset() {
      inView.clear();
    },

    visible() {
      return [...inView.keys()];
    },
  };
}
