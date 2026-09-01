/**
 * Copy the ZXing reader wasm out of node_modules and into `public/wasm/`.
 *
 * WHY THIS EXISTS. `zxing-wasm` defaults to fetching its `.wasm` from the
 * jsDelivr CDN at first decode. That is a third-party request on the critical
 * path of the one thing the scanner does, made from a phone standing in an
 * aisle on shop wifi — and it is the iPhone path specifically, because that is
 * the only place the fallback runs. Serving the file from our own origin makes
 * it a same-origin, cacheable asset instead.
 *
 * WHY IT IS COPIED RATHER THAN COMMITTED. The wasm and the JS glue that
 * instantiates it are one artefact: a mismatched pair fails at load with
 * nothing useful in the console. Copying on install and before every build
 * means the file in `public/` is always the one this `node_modules` expects.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(root, "public", "wasm");

try {
  // `zxing-wasm` does not export `./package.json`, and the wasm sits outside the
  // `dist/cjs` folder the entry point resolves to, so the package root is found
  // by walking back up from whatever path resolution landed on.
  const entry = require.resolve("zxing-wasm/reader");
  const marker = `${sep}zxing-wasm${sep}`;
  const packageRoot = entry.slice(0, entry.lastIndexOf(marker) + marker.length - 1);
  const source = join(packageRoot, "dist", "reader", "zxing_reader.wasm");
  mkdirSync(destination, { recursive: true });
  copyFileSync(source, join(destination, "zxing_reader.wasm"));
  console.log("copied zxing_reader.wasm -> public/wasm/");
} catch (error) {
  // A postinstall that fails hard breaks `npm ci` for everyone, including CI
  // jobs that never build the frontend. The scanner degrades to typed entry on
  // iPhone if this is missing, which is the behaviour it had before.
  console.warn("could not copy zxing_reader.wasm:", error instanceof Error ? error.message : error);
}
