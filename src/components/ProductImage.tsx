"use client";

/**
 * A supplier product thumbnail that cannot break the layout.
 *
 * Two separate absences are handled as one: a supplier that publishes no image,
 * and a URL that 404s or is refused. Both end as the same neutral placeholder,
 * because to a buyer they are the same fact — there is no picture — and a
 * broken-image glyph reads as the page being broken.
 *
 * Sized by the caller, since the same component serves a 32px table cell and a
 * 96px popup.
 */

import { useState } from "react";

export default function ProductImage({
  src,
  alt,
  size = 32,
}: {
  src?: string;
  alt: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  const box = { width: size, height: size };

  if (!src || failed) {
    return (
      <div
        style={box}
        className="shrink-0 rounded border border-line bg-canvas"
        aria-hidden="true"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={box}
      onError={() => setFailed(true)}
      className="shrink-0 rounded border border-line bg-white object-contain"
      loading="lazy"
    />
  );
}
