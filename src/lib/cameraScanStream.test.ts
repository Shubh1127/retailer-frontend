/**
 * A camera is a stream, not a scanner.
 *
 * THE REPORTED FAILURE. A printed sheet of about sixteen barcode labels was
 * held in front of the phone, and the app recorded sixty-one scans.
 * `BarcodeDetector` is asked for a decode roughly seven times a second and
 * reports every barcode it can currently see, every time — so a static sheet is
 * not sixteen detections, it is sixteen per frame for as long as it is there.
 *
 * The page's existing duplicate guard did not stop it and was never going to:
 * that set answers "has this been scanned this session", a question about the
 * CART, which is why it is deliberately cleared when a line is deleted and per
 * barcode when a request fails. Every one of those clears re-arms the camera.
 *
 * These are the scenarios that matter, written as frames.
 */

import { describe, it, expect } from "vitest";

import { canonicalBarcode, createCameraScanStream } from "./cameraScanStream";

const COKE_13 = "5000112626940";
const COKE_14 = "05000112626940";
const LUCOZADE = "5054267013926";
const TAYTO = "5000112667110";

/** Run a script of frames and collect everything the stream emitted. */
function run(
  frames: readonly string[][],
  options: { missesBeforeGone?: number; rescanOnReturn?: boolean } = {},
): string[] {
  const stream = createCameraScanStream(options);
  return frames.flatMap((frame) => stream.frame(frame));
}

describe("a barcode held in front of the lens", () => {
  it("is ONE scan across four consecutive frames", () => {
    const scans = run([[COKE_13], [COKE_13], [COKE_13], [COKE_13]]);
    expect(scans).toEqual([COKE_13]);
  });

  it("is still one scan after a hundred frames", () => {
    // Fourteen seconds of a sheet resting on the counter. NOT a timeout: a
    // window that expired would quietly start counting the same label again.
    const scans = run(Array.from({ length: 100 }, () => [COKE_13]));
    expect(scans).toEqual([COKE_13]);
  });

  it("counts a second barcode entering the view, once", () => {
    const scans = run([[COKE_13], [COKE_13, LUCOZADE], [COKE_13, LUCOZADE]]);
    expect(scans).toEqual([COKE_13, LUCOZADE]);
  });

  it("survives a single missed frame as one scan", () => {
    // Detection flickers constantly — motion blur, a hand across the lens, a
    // bad angle for one tick. One miss is not the product leaving.
    expect(run([[COKE_13], [COKE_13], [], [COKE_13], [COKE_13]])).toEqual([COKE_13]);
  });

  it("does NOT rescan a barcode that left the view and came back", () => {
    /**
     * THE SECOND HALF OF THE BUG. Suppressing only while visible was the
     * obvious rule, and it failed on the obvious action: panning the phone
     * across a shelf strip. Every label leaves the frame and returns as the
     * camera moves, and each return counted — sixteen labels, seventy-seven
     * scans.
     *
     * Adding a second case has its own control. The list answers a repeat with
     * "already in the list (qty 2). Use ＋ to add more."
     */
    expect(run([[COKE_13], [COKE_13], [], [], [], [COKE_13]])).toEqual([COKE_13]);
  });

  it("rescans on return only when a caller explicitly asks for it", () => {
    // A coherent behaviour for a fixed camera watching a conveyor. Nothing on
    // a shop floor is that.
    expect(
      run([[COKE_13], [COKE_13], [], [], [], [COKE_13]], { rescanOnReturn: true }),
    ).toEqual([COKE_13, COKE_13]);
  });
});

describe("the same product spelled two ways", () => {
  it("does not scan an EAN-13 and its padded GTIN-14 as two products", () => {
    expect(run([[COKE_13], [COKE_14], [COKE_13]])).toEqual([COKE_13]);
  });

  it("collapses them within a single frame", () => {
    // One label read twice by overlapping detection regions, reported in the
    // two spellings. It is one barcode.
    expect(run([[COKE_13, COKE_14]])).toEqual([COKE_13]);
  });

  it("canonicalises to the significant digits", () => {
    expect(canonicalBarcode(COKE_14)).toBe(COKE_13);
    expect(canonicalBarcode(COKE_13)).toBe(COKE_13);
  });
});

describe("the sheet of sixteen labels", () => {
  const SHEET = [
    "5000112626940",
    "5054267013926",
    "5000112667110",
    "5000159484695",
    "5010102000102",
    "5099873001714",
    "5000169001301",
    "5011026106503",
    "5060335635013",
    "5000112637939",
    "5000128193214",
    "5010036002319",
    "5000168020891",
    "5060283510110",
    "5011476100010",
    "5000267024004",
  ].filter((code) => canonicalBarcode(code) !== undefined);

  it("produces one scan per label, however long it is held there", () => {
    // THE REGRESSION. Thirty frames of the same sheet is thirty × sixteen
    // detections, and every one of them used to reach the cart API.
    const scans = run(Array.from({ length: 30 }, () => SHEET));

    expect(scans).toHaveLength(SHEET.length);
    expect(new Set(scans).size).toBe(SHEET.length);
  });

  it("never re-emits a label while the sheet stays in view", () => {
    const stream = createCameraScanStream();

    stream.frame(SHEET);
    const afterFirst = Array.from({ length: 50 }, () => stream.frame(SHEET)).flat();

    // Not "few". None. A quantity that climbs on its own is worse than a
    // duplicate line, because nothing on screen explains it.
    expect(afterFirst).toEqual([]);
  });

  it("survives the camera being PANNED across the strip", () => {
    /**
     * THE REPORTED FAILURE, as frames.
     *
     * A phone moved along a shelf-label strip sees a sliding window of three
     * labels at a time. Every label leaves the frame and returns several times
     * as the hand travels back and forth — which is how sixteen labels produced
     * seventy-seven scans.
     */
    const stream = createCameraScanStream();
    const scans: string[] = [];

    // Four passes up and down the strip, three labels visible at a time.
    for (let pass = 0; pass < 4; pass += 1) {
      const order = pass % 2 === 0 ? SHEET : [...SHEET].reverse();
      for (let at = 0; at < order.length; at += 1) {
        const window = order.slice(at, at + 3);
        // Several frames per position, because the hand is not instantaneous.
        for (let tick = 0; tick < 5; tick += 1) scans.push(...stream.frame(window));
      }
    }

    expect(scans).toHaveLength(SHEET.length);
    expect(new Set(scans).size).toBe(SHEET.length);
  });

  it("emits nothing at all for frames that decoded nothing", () => {
    const stream = createCameraScanStream();
    expect(stream.frame([])).toEqual([]);
    expect(stream.frame([])).toEqual([]);
  });
});

describe("what is not a barcode", () => {
  it("drops a decode whose check digit fails", () => {
    // A camera pointed at a printed sheet produces junk: ITF and Code 128
    // decode fragments of a longer symbol, and neighbouring labels bleed
    // together. Each of those was becoming a cart line saying "not a valid
    // barcode" — a misread is not a decision anybody made.
    expect(canonicalBarcode("5000112626941")).toBeUndefined();
    expect(run([["5000112626941"]])).toEqual([]);
  });

  it("drops a decode of the wrong length", () => {
    expect(canonicalBarcode("500011262")).toBeUndefined();
    expect(canonicalBarcode("500011262694012345")).toBeUndefined();
  });

  it("drops anything that is not digits", () => {
    expect(canonicalBarcode("ABC-123")).toBeUndefined();
    expect(canonicalBarcode("")).toBeUndefined();
    expect(canonicalBarcode("   ")).toBeUndefined();
  });

  it("keeps the good barcodes in a frame that also held junk", () => {
    expect(run([["5000112626941", COKE_13, "not-a-barcode"]])).toEqual([COKE_13]);
  });

  it("accepts a valid GTIN-8", () => {
    // Small packs really do carry these; refusing them would lose real
    // products in the name of tidiness.
    expect(canonicalBarcode("30107014")).toBe("30107014");
  });
});

describe("closing and reopening the camera", () => {
  it("scans the same product again after a reset", () => {
    const stream = createCameraScanStream();

    expect(stream.frame([COKE_13])).toEqual([COKE_13]);
    expect(stream.frame([COKE_13])).toEqual([]);

    // Closing the viewfinder ends the continuity being tracked. Without the
    // reset, reopening it on the same product would suppress the first scan
    // and look like the camera had stopped working.
    stream.reset();
    expect(stream.frame([COKE_13])).toEqual([COKE_13]);
  });

  it("reports what it currently believes is in view", () => {
    const stream = createCameraScanStream();
    stream.frame([COKE_13, TAYTO]);
    expect(stream.visible().sort()).toEqual([COKE_13, TAYTO].sort());

    stream.frame([]);
    stream.frame([]);
    stream.frame([]);
    expect(stream.visible()).toEqual([]);
  });
});

describe("how patient it is", () => {
  it("can be told to wait longer before calling a barcode gone", () => {
    // The knob, for a shaky hand or a slower decode. Only meaningful alongside
    // `rescanOnReturn` — session-sticky never lets a barcode back regardless.
    const patient = { missesBeforeGone: 5, rescanOnReturn: true };

    // Four misses is still within five, so this is one scan…
    expect(run([[COKE_13], [], [], [], [], [COKE_13]], patient)).toEqual([COKE_13]);
    // …and the fifth is what evicts it.
    expect(run([[COKE_13], [], [], [], [], [], [COKE_13]], patient)).toEqual([
      COKE_13,
      COKE_13,
    ]);
  });

  it("refuses a threshold that would evict on the frame itself", () => {
    // Zero would mean a barcode is gone the instant it is seen, which makes
    // every frame a new scan — the bug this file exists to prevent.
    expect(
      run([[COKE_13], [COKE_13], [COKE_13]], { missesBeforeGone: 0, rescanOnReturn: true }),
    ).toEqual([COKE_13]);
  });
});
