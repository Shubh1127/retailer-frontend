"use client";

/**
 * A product thumbnail that arrives late and does not startle anybody.
 *
 * ── WHY IT FADES ────────────────────────────────────────────────────────────
 *
 * Images are no longer part of the cart response — they resolve a batch at a
 * time after the list is already on screen (see `useCartEnrichment`). That is
 * the right trade for the wait, but it means pictures land under a thumb that
 * is already scrolling. Snapping them in makes a settled list twitch; a short
 * fade reads as "this finished loading" instead of "the page moved".
 *
 * The fade is on LOAD, not on mount, because the URL arriving and the bytes
 * arriving are two different moments and only the second one has a picture in
 * it. Fading on mount would fade in an empty box.
 *
 * ── THE TWO ABSENCES ARE ONE ────────────────────────────────────────────────
 *
 * A supplier that publishes no image and a URL that 404s end as the same
 * neutral box, because to a buyer they are the same fact — there is no picture
 * — and a broken-image glyph reads as the app being broken. The box is also
 * exactly the size the loaded image will be, so nothing reflows when it lands:
 * a list that re-lays-out under a moving thumb is worse than a slow one.
 */

import { useState } from "react";
import { motion } from "framer-motion";

export default function ProductThumb({
  src,
  size,
  rounded = "rounded-lg",
}: {
  src?: string;
  /** Pixels. The placeholder reserves exactly this, so nothing reflows. */
  size: number;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const box = { width: size, height: size };

  if (!src || failed) {
    return (
      <span
        style={box}
        aria-hidden="true"
        className={`block shrink-0 border border-line bg-canvas ${rounded}`}
      />
    );
  }

  return (
    <span
      style={box}
      className={`block shrink-0 overflow-hidden border border-line bg-canvas ${rounded}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <motion.img
        src={src}
        alt=""
        loading="lazy"
        initial={false}
        animate={{ opacity: loaded ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
