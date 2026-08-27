"use client";

/**
 * A scanned product's picture, with somewhere to fall back to.
 *
 * THREE FALLBACKS, AND EACH HAS BEEN NEEDED.
 *
 * The master row's image comes from the preferred supplier, which is usually
 * Musgrave — and Musgrave publish RELATIVE paths, so for a while every mapped
 * product silently had no picture. That is repaired now on both the read and
 * the write side, but a URL can still 404 for ordinary reasons: a product
 * delisted, a CDN path changed between syncs, a host that refuses hotlinking.
 * None of those should leave a broken-image icon on a shop floor.
 *
 * So: the master image, then any supplier that publishes one, then the
 * departmental glyph. Each step is taken only when the previous one actually
 * FAILED TO LOAD, not guessed at in advance — a URL that works is never
 * skipped because another looked more promising.
 *
 * Shared between the scan page and the phone's scanner sheet, which is the
 * whole point: the sheet had no picture at all until this existed, and copying
 * the chain into it would have meant two of them to keep in step.
 */

import { useState } from "react";

import ProductGlyph from "@/components/ProductGlyph";
import type { ScanLine } from "@/lib/api/scan";

export default function ScanThumb({ line, size = 44 }: { line: ScanLine; size?: number }) {
  const candidates = [
    line.product?.imageUrl,
    ...(line.product?.suppliers ?? []).map((offer) => offer.imageUrl),
  ].filter((url): url is string => Boolean(url));

  const [attempt, setAttempt] = useState(0);
  const src = candidates[attempt];

  if (!src) return <ProductGlyph department="General" size={size} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={line.product?.name ?? line.scannedCode}
      style={{ width: size, height: size }}
      onError={() => setAttempt((current) => current + 1)}
      className="shrink-0 rounded-lg border border-line bg-white object-contain"
      loading="lazy"
    />
  );
}
