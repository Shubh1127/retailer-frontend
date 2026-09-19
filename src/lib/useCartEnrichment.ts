"use client";

/**
 * The cart's pictures, fetched after the cart itself and merged in as they land.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 *
 * Reading the order cart used to be two costs wearing one name. The order — the
 * products, the quantities, where each line came from — is two queries and
 * arrives in milliseconds. The PRESENTATION of those products is one catalogue
 * round trip per barcode plus one local catalogue search per barcode-less EPOS
 * line. On a two-hundred-line weekly order that is a few hundred lookups, and
 * every one of them stood between the retailer and a list they had already
 * saved and could already have read.
 *
 * So the screen now asks for the cart without enrichment and calls this. The
 * list paints immediately; each batch of pictures appears as it resolves.
 *
 * ── WHY BATCHES, IN ORDER, ONE AT A TIME ────────────────────────────────────
 *
 * Asking for all 214 at once would rebuild the original wait — the server
 * refuses more than 50 for exactly that reason. Asking for all of them at once
 * in parallel would instead fire every catalogue lookup simultaneously, which
 * is the same load on the database with a nicer-looking client.
 *
 * Batches run SEQUENTIALLY and IN LIST ORDER, because the first batch is what
 * the retailer is actually looking at. A parallel fan-out would finish sooner
 * in total and yet leave the top of the screen blank for longer, which is the
 * only part of "sooner" anybody experiences.
 *
 * ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────
 *
 * It never re-asks about a line it has already asked about, even when the
 * answer was "nothing known" — the server answers for every id precisely so
 * that silence and ignorance stay distinguishable. It never asks again because
 * a quantity changed. And a failed batch is dropped rather than retried: these
 * are pictures, and a cart that works is worth more than a cart that keeps
 * trying to decorate itself.
 *
 * ── IT SURVIVES LEAVING THE PAGE ────────────────────────────────────────────
 *
 * Kept in this tab's session cache, because it was the single most expensive
 * thing a navigation threw away: going to Settings and back re-ran every batch,
 * and each batch is a catalogue round trip per barcode. A product's picture and
 * pack text do not change while somebody walks to the next screen.
 *
 * Only server answers are cached — the whole point of `enrichOrderCartLines`
 * answering for every id is that "we asked and there is nothing" is a fact
 * worth remembering, so it is remembered too and never asked again this session.
 */

import { useEffect, useRef, useState } from "react";

import { enrichOrderCartLines, type CartLineEnrichment, type OrderListLine } from "@/lib/api/orderList";
import { cacheKeys, readCache, writeCache } from "@/lib/sessionCache";

/** The server's own cap. Asking for more is refused, not truncated. */
const BATCH = 50;

export type Enrichment = Record<number, CartLineEnrichment>;

/**
 * Fold what the catalogue said onto a line.
 *
 * `sizeText` is overlaid wholesale because the SERVER has already applied the
 * precedence rule — an imported EPOS pack is the retailer's explicit purchase
 * requirement and outranks anything the catalogue thinks. Re-deciding that here
 * would be a second implementation of a rule that already exists.
 */
export function withEnrichment(line: OrderListLine, found: CartLineEnrichment | undefined): OrderListLine {
  if (!found) return line;

  return {
    ...line,
    ...(found.gtin14 && !line.gtin14 ? { gtin14: found.gtin14 } : {}),
    ...(found.imageUrl ? { imageUrl: found.imageUrl } : {}),
    ...(found.sizeText ? { sizeText: found.sizeText } : {}),
  };
}

export function useCartEnrichment(lines: readonly OrderListLine[]): Enrichment {
  const [enrichment, setEnrichment] = useState<Enrichment>(() =>
    typeof window === "undefined"
      ? {}
      : /**
         * An hour, rather than the default. These are image URLs and pack
         * text, not quantities — the cost of a slightly old picture is nothing,
         * and the cost of re-fetching two hundred of them is a visible pause.
         */
        (readCache<Enrichment>(cacheKeys.cartEnrichment, { maxAgeMs: 60 * 60 * 1000 }) ?? {}),
  );

  /**
   * Every id ever asked about, kept in a ref rather than in state.
   *
   * In state it would be a dependency of the effect that writes it, and the
   * effect would re-run on its own result — a loop that fetches the cart's
   * pictures forever. The ref is read inside the effect and never renders.
   */
  const asked = useRef(new Set<number>(Object.keys(enrichment).map(Number)));

  /**
   * The merged result, mirrored outside React.
   *
   * Batches land one after another and each has to build on the last. Doing
   * that inside a `setEnrichment` updater looked natural and was wrong twice
   * over: the updater is not guaranteed to have run by the time the next line
   * executes, so the value written to the cache could be a batch behind, and
   * writing to storage inside an updater is a side effect in what must be a
   * pure function — which StrictMode invokes twice.
   */
  const merged = useRef<Enrichment>(enrichment);

  /**
   * ── THE DEPENDENCY IS THE CART'S LINES, NOT THE UNASKED ONES ──────────────
   *
   * This was the other way round and it was a bug worth describing, because it
   * failed intermittently — which is the worst way to fail.
   *
   * The signature was built from the ids NOT yet asked about. The effect's
   * first act is to mark those ids as asked, so the very next render computed
   * an EMPTY signature, React treated that as a dependency change, and ran the
   * cleanup — which set `live = false` and discarded the answer to a request
   * that was still in flight. Whether a picture appeared came down to whether
   * the network beat the re-render. On a fast mock it usually did; on a real
   * connection it usually did not.
   *
   * So the dependency is now the cart's own line ids, which change only when a
   * product is genuinely added or removed. The "have I already asked" filtering
   * happens INSIDE the effect, where mutating the ref cannot re-trigger it.
   */
  const signature = lines.map((line) => line.id).join(",");

  useEffect(() => {
    const ids = signature
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => !asked.current.has(id));

    if (ids.length === 0) return;
    for (const id of ids) asked.current.add(id);

    let live = true;

    void (async () => {
      for (let index = 0; index < ids.length; index += BATCH) {
        try {
          const items = await enrichOrderCartLines(ids.slice(index, index + BATCH));

          /**
           * APPLIED EVEN IF THIS EFFECT IS NO LONGER THE CURRENT ONE. The
           * request was paid for and the answer is correct; throwing it away
           * because a line was added while it was in flight would leave those
           * ids marked as asked and permanently without pictures. Setting state
           * after unmount is a no-op in React 18, not a warning.
           */
          const next = { ...merged.current };
          for (const item of items) next[item.lineId] = item;
          merged.current = next;
          setEnrichment(next);
          // From the RESPONSE, after it arrived — the rule the session cache is
          // built on.
          writeCache(cacheKeys.cartEnrichment, next);
        } catch {
          // Pictures are an enhancement; a cart that works outranks one that
          // keeps trying to decorate itself. The ids stay marked as asked, so
          // a failure costs one batch rather than starting a retry storm.
        }

        // `live` only stops the NEXT batch being started.
        if (!live) return;
      }
    })();

    return () => {
      live = false;
    };
  }, [signature]);

  return enrichment;
}
