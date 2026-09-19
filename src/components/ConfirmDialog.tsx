"use client";

/**
 * A destructive confirmation, asked in the middle of the screen.
 *
 * WHY THIS IS NOT `window.confirm`. The native dialog cannot say WHICH product
 * is about to go — it gets one unstyled string and renders it against the
 * browser chrome, which on iOS Safari reads as a page error rather than as a
 * question this app is asking. Removing the wrong line from a 200-line order is
 * a mistake nobody notices until the delivery arrives, so the product's name is
 * the whole point of asking.
 *
 * FOCUS IS TRAPPED, BARELY. The dialog holds exactly two buttons, so rather
 * than a full focus-trap library the cancel button takes focus on open and
 * Escape closes. That is the whole keyboard surface there is to get wrong.
 *
 * CANCEL SITS LEFT AND IS THE DEFAULT FOCUS. The destructive button is never
 * the one a stray Return keypress lands on.
 *
 * IT SCALES UP FROM SLIGHTLY SMALL rather than sliding in from an edge. A
 * dialog has no home edge to come from — it is about the thing already on
 * screen — so growing in place keeps the eye where the product was. The
 * movement is deliberately smaller than the sheet's: this one interrupts, and
 * an interruption that swoops draws attention to itself rather than to the
 * question it is asking.
 */

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
    >
      {/*
        The scrim closes on tap, which is the gesture people try first.

        HIDDEN FROM ASSISTIVE TECH, and not out of laziness: labelling it
        "Cancel" put TWO buttons called Cancel in one dialog, which is a worse
        answer for a screen reader than one. The keyboard and screen-reader
        paths out are the real Cancel button and Escape, both of which do
        exactly what this does.
      */}
      <motion.button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCancel}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: "linear" }}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[300px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      >
        <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
          {/* The icon lands a beat after the card, which is what makes the
              dialog read as "this is about deleting" rather than as a panel
              that happens to contain a red circle. */}
          <motion.span
            aria-hidden="true"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.06, duration: 0.24, ease: [0.34, 1.56, 0.64, 1] }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"
          >
            <TrashGlyph />
          </motion.span>

          <h2 id="confirm-title" className="mt-3 text-[15px] font-semibold text-ink">
            {title}
          </h2>

          {body && <div className="mt-1.5 text-[12.5px] leading-snug text-ink-soft">{body}</div>}
        </div>

        <div className="flex gap-2 border-t border-line p-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface text-[13.5px] font-medium text-ink hover:bg-canvas disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl bg-red-600 text-[13.5px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Removing…" : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function TrashGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
    </svg>
  );
}
