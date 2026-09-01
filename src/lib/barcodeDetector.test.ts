/**
 * The reason this file exists is one bug: every iPhone got "this browser cannot
 * read barcodes" because `BarcodeDetector` is Chromium-only, and no test caught
 * it — the suite runs in jsdom, which has no such global, so the fallback path
 * was the only path anything ever exercised.
 *
 * So these tests are about the CHOICE rather than the decoding. The wasm reader
 * is ZXing's problem; which reader gets picked, and on what evidence, is ours.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BARCODE_FORMATS, createBarcodeReader } from "./barcodeDetector";

const ponyfillDetect = vi.fn();
type PrepareOptions = { overrides: { locateFile: (path: string, prefix: string) => string } };
const prepareZXingModule = vi.fn(async (_options: PrepareOptions) => ({}));

vi.mock("barcode-detector/ponyfill", () => ({
  BarcodeDetector: class {
    detect = ponyfillDetect;
  },
  prepareZXingModule,
}));

function installNative(options: {
  formats?: string[] | null;
  detect?: ReturnType<typeof vi.fn>;
}) {
  const detect = options.detect ?? vi.fn(async () => []);
  class NativeDetector {
    detect = detect;
    static getSupportedFormats?: () => Promise<string[]>;
  }
  if (options.formats !== null) {
    NativeDetector.getSupportedFormats = async () => options.formats ?? [];
  }
  (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector = NativeDetector;
  return detect;
}

afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  vi.clearAllMocks();
});

describe("createBarcodeReader", () => {
  it("uses the native detector when the browser has one", async () => {
    const native = installNative({ formats: [...BARCODE_FORMATS] });
    native.mockResolvedValue([{ rawValue: "5099206084681" }]);

    const reader = await createBarcodeReader();

    expect(await reader.detect({} as Blob)).toEqual(["5099206084681"]);
    expect(ponyfillDetect).not.toHaveBeenCalled();
  });

  it("falls back to the wasm reader when there is no native detector — the iPhone case", async () => {
    ponyfillDetect.mockResolvedValue([{ rawValue: "5000112637939" }]);

    const reader = await createBarcodeReader();

    expect(await reader.detect({} as Blob)).toEqual(["5000112637939"]);
    // Same-origin wasm, not the jsDelivr default.
    expect(prepareZXingModule).toHaveBeenCalled();
    const { locateFile } = prepareZXingModule.mock.calls[0]![0].overrides;
    expect(locateFile("zxing_reader.wasm", "https://cdn.example/")).toBe("/wasm/zxing_reader.wasm");
  });

  it("falls back when the native detector exists but reads no retail format", async () => {
    // Chromium on a machine with no platform barcode library: the constructor
    // is there and supports QR only, so a truthiness check passes and no
    // product barcode is ever read.
    const native = installNative({ formats: ["qr_code"] });
    ponyfillDetect.mockResolvedValue([{ rawValue: "5010025000029" }]);

    const reader = await createBarcodeReader();

    expect(await reader.detect({} as Blob)).toEqual(["5010025000029"]);
    expect(native).not.toHaveBeenCalled();
  });

  it("keeps the native detector when it will not list its formats", async () => {
    const native = installNative({ formats: null });
    native.mockResolvedValue([{ rawValue: "5449000000996" }]);

    const reader = await createBarcodeReader();

    expect(await reader.detect({} as Blob)).toEqual(["5449000000996"]);
    expect(ponyfillDetect).not.toHaveBeenCalled();
  });

  it("reports a failed frame as nothing seen rather than throwing", async () => {
    // The caller feeds every frame to the scan stream, including empty ones —
    // a throw here would break that loop and stop the camera dead.
    const native = installNative({ formats: [...BARCODE_FORMATS] });
    native.mockRejectedValue(new Error("motion blur"));

    const reader = await createBarcodeReader();

    await expect(reader.detect({} as Blob)).resolves.toEqual([]);
  });

  it("drops empty decodes", async () => {
    const native = installNative({ formats: [...BARCODE_FORMATS] });
    native.mockResolvedValue([{ rawValue: "" }, { rawValue: "5011013100019" }, {}]);

    const reader = await createBarcodeReader();

    expect(await reader.detect({} as Blob)).toEqual(["5011013100019"]);
  });
});
