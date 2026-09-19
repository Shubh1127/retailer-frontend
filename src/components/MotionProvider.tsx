"use client";

/**
 * One motion policy for the whole app.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `globals.css` zeroes `transition-duration` and `animation-duration` under
 * `prefers-reduced-motion`, which handles CSS — and framer-motion is not CSS.
 * It drives transforms from JavaScript, so a sheet that slides up 100% of the
 * viewport kept sliding for anyone who had asked the OS for less movement.
 * Several components already assumed this file existed (`get-started/page.tsx`
 * says so in a comment); it did not.
 *
 * `reducedMotion="user"` defers to the OS switch: opacity still cross-fades,
 * but transforms — the y-slide of a sheet, the scale of a dialog — are dropped.
 * That is the right split for a system used by people who get motion sick on a
 * moving phone screen, while keeping the state change visible.
 *
 * A CLIENT COMPONENT because context cannot cross the server boundary, and
 * `layout.tsx` is a server component. It renders nothing of its own.
 */

import { MotionConfig } from "framer-motion";

export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
