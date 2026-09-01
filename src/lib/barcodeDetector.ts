/**
 * One barcode reader for every browser, native where there is one.
 *
 * WHAT WAS BROKEN. `BarcodeDetector` is a Chromium API. Every browser on an
 * iPhone — Safari, "Chrome", Firefox, all of them — is WebKit underneath and
 * WebKit does not ship it, so the feature test in the scanner failed on every
 * iPhone in the country and the camera was replaced by "this browser cannot
 * read barcodes". Android was fine, which is exactly what made it look like a
 * device problem rather than an engine one.
 *
 * WHAT REPLACES IT. Native when the browser has it — it is hardware-accelerated
 * and costs nothing to load — and a WebAssembly build of ZXing when it does
 * not. Same call, same return, so neither call site has to know which one it
 * got.
 *
 * WHY THE FALLBACK IS LOADED LAZILY. It is about a megabyte of wasm, and on
 * Android nothing ever needs it. `import()` inside the fallback branch means
 * Android never pays for the iPhone fix.
 *
 * THE WASM IS SERVED FROM OUR OWN ORIGIN. `zxing-wasm` otherwise fetches it
 * from a CDN on first decode — a third-party request in the middle of the one
 * thing this screen does, from a phone on shop wifi. `scripts/copy-zxing-wasm.mjs`
 * puts the file in `public/wasm/` on install and before every build.
 *
 * IT IS INSTANTIATED EAGERLY, at reader creation rather than at first frame.
 * A reader that constructs happily and then throws on every decode is a camera
 * that runs and never reads — the worst possible failure here, because it looks
 * like the person is aiming badly. Failing at creation reaches the same error
 * message the missing-API case always used.
 */

/**
 * The retail symbologies, and only those. QR and DataMatrix are not on grocery
 * packaging, and asking ZXing for formats nobody scans makes every frame slower
 * and every misread more likely.
 */
export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "itf",
] as const;

type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

/** Anything either implementation can decode: a video frame, or a photo. */
export type BarcodeSource = HTMLVideoElement | HTMLCanvasElement | ImageBitmap | Blob | ImageData;

export interface BarcodeReader {
  /** Every barcode currently visible, as raw strings. Never throws. */
  detect(source: BarcodeSource): Promise<string[]>;
}

interface DetectorLike {
  detect(source: BarcodeSource): Promise<Array<{ rawValue?: unknown }>>;
}

type DetectorConstructor = new (options: { formats: readonly string[] }) => DetectorLike;

interface NativeBarcodeDetector extends DetectorConstructor {
  getSupportedFormats?: () => Promise<string[]>;
}

function nativeDetector(): NativeBarcodeDetector | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { BarcodeDetector?: NativeBarcodeDetector }).BarcodeDetector;
}

/**
 * Whether the native API can read the formats this app cares about.
 *
 * NOT just "does the constructor exist". Some Chromium builds — Linux desktop
 * in particular, and a few Android WebViews — expose `BarcodeDetector` and then
 * support QR only, because the underlying platform library is missing. That
 * combination reads no product barcode ever while passing a truthiness check,
 * so the supported-format list is asked for and a machine with no EAN support
 * is sent to the fallback like an iPhone.
 */
async function nativeCanReadRetailFormats(Detector: NativeBarcodeDetector): Promise<boolean> {
  if (typeof Detector.getSupportedFormats !== "function") return true;
  try {
    const supported = await Detector.getSupportedFormats();
    return BARCODE_FORMATS.some((format) => supported.includes(format));
  } catch {
    // A browser that will not answer the question still has the constructor.
    // Trying it is better than discarding a working native decoder.
    return true;
  }
}

let fallbackConstructor: Promise<DetectorConstructor> | null = null;

function loadFallbackConstructor(): Promise<DetectorConstructor> {
  fallbackConstructor ??= (async () => {
    const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");

    // Same-origin wasm. See the header — the default is a CDN fetch.
    await prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? `/wasm/${path}` : `${prefix}${path}`,
      },
      fireImmediately: true,
    });

    return BarcodeDetector as unknown as DetectorConstructor;
  })();

  // A failed load must not be cached as a permanent verdict: the usual cause is
  // one dropped request, and reopening the scanner should try again.
  fallbackConstructor.catch(() => {
    fallbackConstructor = null;
  });

  return fallbackConstructor;
}

/**
 * A reader, or a rejection if this browser genuinely cannot decode.
 *
 * The rejection is the signal for the "type it instead" message. It should now
 * be rare enough to be a real fault rather than a whole platform.
 */
export async function createBarcodeReader(
  formats: readonly BarcodeFormat[] = BARCODE_FORMATS,
): Promise<BarcodeReader> {
  const Native = nativeDetector();
  const Detector =
    Native && (await nativeCanReadRetailFormats(Native)) ? Native : await loadFallbackConstructor();

  const detector = new Detector({ formats });

  return {
    async detect(source) {
      try {
        const found = await detector.detect(source);
        return found
          .map((result) => String(result?.rawValue ?? ""))
          .filter((value) => value !== "");
      } catch {
        /**
         * A single failed frame is normal — motion blur, bad light, and in the
         * wasm path a frame grabbed while the video was between sizes. The next
         * tick tries again, and an empty result is the honest answer: nothing
         * was read. Callers feed it to the frame stream as a frame that saw
         * nothing, which is what it was.
         */
        return [];
      }
    },
  };
}
