/**
 * Recognising a hardware barcode scanner from its typing.
 *
 * THERE IS NOTHING TO DETECT, IN THE USUAL SENSE. A USB or Bluetooth scanner in
 * the mode retail uses (HID "keyboard wedge") presents itself to the operating
 * system as a keyboard. The browser cannot enumerate it, cannot ask whether one
 * is plugged in, and receives nothing but ordinary keystrokes — there is no
 * device API, no permission prompt, and no event that says "a scanner
 * appeared". Anything claiming to detect one is inferring it.
 *
 * WHAT CAN BE INFERRED, RELIABLY: the speed. A scanner emits a whole barcode in
 * a burst — typically 5–15ms between characters — and ends it with Enter. A
 * person cannot type thirteen digits at 20ms intervals; the world record for
 * sustained typing is an order of magnitude slower than the slowest scanner.
 * So a burst that is fast enough, long enough, and terminated by Enter is a
 * scan, and everything else is somebody typing.
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS
 *
 * Without it, a scan only lands if the right input happens to be focused. One
 * stray click and the next ten beeps go into the page and vanish — silently,
 * which is the worst way for a stock-take to fail. Listening on the document
 * means the scanner works wherever the retailer's attention is, and it means
 * the on-screen keyboard does not have to be held open on a phone just to keep
 * a text box focused.
 */

/** Characters closer together than this are not being typed by a person. */
export const MAX_HUMAN_GAP_MS = 35;

/** Shorter than this is not a barcode. EAN-8 is the shortest real one. */
export const MIN_BARCODE_LENGTH = 6;

/** A burst taking longer than this was somebody typing, however fast. */
export const MAX_BURST_MS = 500;

export interface Keystroke {
  key: string;
  at: number;
}

export interface BurstVerdict {
  isScan: boolean;
  code: string;
  /** Mean gap between keystrokes, for showing why something was rejected. */
  meanGapMs: number;
}

/**
 * Was this burst of keystrokes a scan?
 *
 * Pure, so the thresholds can be tested against real timings rather than
 * guessed at behind a DOM.
 *
 * Requires ALL of:
 *   long enough      a barcode, not a keypress
 *   fast enough      mean gap under the human floor
 *   quick enough     the whole burst inside MAX_BURST_MS, so a slow burst with
 *                    one fast pair in it cannot pass on the mean alone
 */
export function classifyBurst(strokes: readonly Keystroke[]): BurstVerdict {
  const printable = strokes.filter((stroke) => stroke.key.length === 1);
  const code = printable.map((stroke) => stroke.key).join('');

  if (printable.length < MIN_BARCODE_LENGTH) {
    return { isScan: false, code, meanGapMs: Number.POSITIVE_INFINITY };
  }

  const first = printable[0]!.at;
  const last = printable[printable.length - 1]!.at;
  const span = last - first;
  const meanGapMs = span / (printable.length - 1);

  return {
    isScan: meanGapMs <= MAX_HUMAN_GAP_MS && span <= MAX_BURST_MS,
    code,
    meanGapMs,
  };
}

/**
 * True for a keystroke that belongs to a barcode rather than to the page.
 *
 * Modifier combinations are excluded so a scan buffer cannot be filled by
 * somebody pressing Ctrl-C, and non-printing keys are ignored except Enter,
 * which is what terminates a scan.
 */
export function isBarcodeKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 || event.key === 'Enter';
}

/**
 * Are these two codes the same barcode?
 *
 * GTIN-14 IS THE ZERO-PADDED SUPERSET of EAN-8, UPC-12 and EAN-13, so one
 * product legitimately reaches us spelled several ways: a shelf edge prints
 * 5054267013926 and the outer case carries 05054267013926. Comparing them as
 * text says they are different products.
 *
 * That mattered more than it looks. The scan page refuses to re-add a barcode
 * already in the cart — but the refusal is a string comparison, and the BACKEND
 * merges on the canonical form and ADDS the quantity. So a mismatch here does
 * not produce a second line, it silently increments the first: exactly the bug
 * the refusal exists to prevent, reappearing through the one spelling the guard
 * did not catch.
 */
export function sameBarcode(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const significant = (value: string) => value.trim().replace(/^0+/, '');
  return significant(a) === significant(b) && significant(a) !== '';
}
