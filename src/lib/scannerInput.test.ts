/**
 * Telling a barcode scanner apart from a person typing.
 *
 * The whole feature rests on one inference: a scanner is a keyboard as far as
 * the browser is concerned, so the only thing separating a scan from typing is
 * SPEED. Get the threshold wrong in one direction and stray keystrokes turn
 * into phantom products in a real order; get it wrong in the other and the
 * scanner silently does nothing, which is how a stock-take is lost.
 *
 * The timings below are the ones real hardware produces: retail scanners emit
 * a character every 5–15ms, and sustained human typing does not go below about
 * 60ms even at competition speeds.
 */

import { describe, it, expect } from "vitest";

import {
  classifyBurst,
  isBarcodeKey,
  MAX_HUMAN_GAP_MS,
  MIN_BARCODE_LENGTH,
  sameBarcode,
  type Keystroke,
} from "./scannerInput";

/** Keystrokes `gapMs` apart, as a device would send them. */
function burst(text: string, gapMs: number, startAt = 1_000): Keystroke[] {
  return [...text].map((key, index) => ({ key, at: startAt + index * gapMs }));
}

describe("a hardware scan", () => {
  it("recognises a 13-digit barcode at scanner speed", () => {
    const verdict = classifyBurst(burst("5054267013926", 8));

    expect(verdict.isScan).toBe(true);
    expect(verdict.code).toBe("5054267013926");
  });

  it("recognises a slower scanner too", () => {
    // Bluetooth scanners and phones pairing over BLE run nearer the human
    // floor. 25ms is still four times faster than fast typing.
    expect(classifyBurst(burst("5054267013926", 25)).isScan).toBe(true);
  });

  it("recognises the shortest real barcode", () => {
    // EAN-8. Anything shorter is a keypress, not a product.
    expect(classifyBurst(burst("50106375", 10)).isScan).toBe(true);
  });
});

describe("a person typing", () => {
  it("is not a scan, even typing quickly", () => {
    // 80ms/char is ~150wpm — faster than almost anybody sustains.
    const verdict = classifyBurst(burst("5054267013926", 80));

    expect(verdict.isScan).toBe(false);
    // The code is still returned so a caller can report WHY it was rejected.
    expect(verdict.code).toBe("5054267013926");
  });

  it("is not a scan at the boundary", () => {
    expect(classifyBurst(burst("5054267013926", MAX_HUMAN_GAP_MS + 1)).isScan).toBe(false);
    expect(classifyBurst(burst("5054267013926", MAX_HUMAN_GAP_MS)).isScan).toBe(true);
  });

  it("does not treat a short keypress as a barcode", () => {
    // Somebody hitting Enter in a quantity box must not add a product.
    expect(classifyBurst(burst("12", 5)).isScan).toBe(false);
    expect(classifyBurst([]).isScan).toBe(false);
  });

  it("rejects a long slow burst that happens to contain fast pairs", () => {
    // Two characters typed together inside a long pause. The mean gap alone
    // could be dragged under the threshold by enough fast pairs, so the total
    // span is checked as well.
    const strokes: Keystroke[] = [
      { key: "5", at: 0 },
      { key: "0", at: 5 },
      { key: "5", at: 10 },
      { key: "4", at: 15 },
      { key: "2", at: 20 },
      { key: "6", at: 900 },
    ];

    expect(classifyBurst(strokes).isScan).toBe(false);
  });

  it("needs at least a barcode's worth of characters", () => {
    expect(MIN_BARCODE_LENGTH).toBe(6);
    expect(classifyBurst(burst("12345", 5)).isScan).toBe(false);
    expect(classifyBurst(burst("123456", 5)).isScan).toBe(true);
  });
});

describe("which keys count", () => {
  const key = (over: Partial<Parameters<typeof isBarcodeKey>[0]>) =>
    isBarcodeKey({ key: "5", ctrlKey: false, metaKey: false, altKey: false, ...over });

  it("takes printable characters and Enter", () => {
    expect(key({ key: "5" })).toBe(true);
    expect(key({ key: "X" })).toBe(true);
    expect(key({ key: "Enter" })).toBe(true);
  });

  it("ignores navigation and function keys", () => {
    expect(key({ key: "Tab" })).toBe(false);
    expect(key({ key: "ArrowLeft" })).toBe(false);
    expect(key({ key: "Shift" })).toBe(false);
  });

  it("ignores anything held with a modifier", () => {
    // Otherwise Ctrl-C, Cmd-R and a browser shortcut all feed the scan buffer.
    expect(key({ key: "c", ctrlKey: true })).toBe(false);
    expect(key({ key: "r", metaKey: true })).toBe(false);
    expect(key({ key: "5", altKey: true })).toBe(false);
  });

  it("drops non-printing keys from the decoded barcode", () => {
    const strokes: Keystroke[] = [
      ...burst("5054267013926", 8),
      { key: "Shift", at: 2_000 },
    ];

    expect(classifyBurst(strokes).code).toBe("5054267013926");
  });
});

describe("the same barcode, spelled differently", () => {
  it("matches a shelf edge against an outer case", () => {
    // EAN-13 as printed on the shelf, GTIN-14 as printed on the case. One
    // product. Comparing as text says two.
    expect(sameBarcode("5054267013926", "05054267013926")).toBe(true);
    expect(sameBarcode("05054267013926", "5054267013926")).toBe(true);
  });

  it("matches whatever the padding", () => {
    expect(sameBarcode("00000050106375", "50106375")).toBe(true);
  });

  it("keeps genuinely different products apart", () => {
    expect(sameBarcode("5054267013926", "5000354919336")).toBe(false);
    // Not a prefix match: a shorter code is not "the same product, padded".
    expect(sameBarcode("505426701392", "5054267013926")).toBe(false);
  });

  it("never matches nothing against nothing", () => {
    // Two lines that both failed to resolve are not the same product, and a
    // guard that said they were would silently merge unrelated scans.
    expect(sameBarcode(undefined, undefined)).toBe(false);
    expect(sameBarcode("", "")).toBe(false);
    expect(sameBarcode("0", "00")).toBe(false);
    expect(sameBarcode("5054267013926", undefined)).toBe(false);
  });
});
