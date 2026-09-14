"use client";

/**
 * One button, for every screen that can put a product in the central cart.
 *
 * WHY IT IS A COMPONENT AND NOT SEVERAL BUTTONS
 *
 * The dashboard search, the product search page, and (later) a finished
 * comparison can all collect a product, and each of them already has its own
 * "Add to basket", which sends money to a real wholesaler. Two adjacent
 * buttons whose consequences differ that much need to look and behave
 * identically wherever they appear, or the difference between "put it on my
 * list" and "order it" becomes something the retailer has to remember per
 * screen.
 *
 * WHAT IT GUARANTEES
 *
 *   ONE REQUEST PER PRESS. Disabled while in flight, so a double-click cannot
 *   send two. The backend's `ensure` merge makes a second add harmless anyway —
 *   this is about not lying to the retailer with two conflicting messages.
 *
 *   THE ANSWER STAYS ON SCREEN. Adding does not navigate anywhere. Somebody
 *   working through a search adds four things and keeps searching; being
 *   thrown to the cart after each one would make that impossible.
 *
 *   ALREADY THERE IS NOT AN ERROR. `ensure` leaves the quantity alone and says
 *   so. A retailer who forgot they had already added something has done
 *   nothing wrong and nothing needs undoing.
 *
 *   NO IDENTITY, NO LINE. A result with no barcode and no supplier code cannot
 *   be identified, and the backend refuses rather than inventing a line keyed
 *   on a name. That comes back as `skipped` and is shown as a refusal, not a
 *   success.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { addToOrderCart, type OrderCartItemInput, type OrderCartSource } from "@/lib/api/orderList";

/** How long the outcome stays on the button before it offers Add again. */
const FEEDBACK_MS = 4000;

type Outcome = { kind: "added"; text: string } | { kind: "already"; text: string } | { kind: "error"; text: string };

export default function AddToOrderCartButton({
  item,
  source,
  jobId,
  sourceRow,
  size = "regular",
  className = "",
  onAdded,
}: {
  item: OrderCartItemInput;
  source: OrderCartSource;
  /** The comparison this product was picked off. VERIFIED server-side. */
  jobId?: string;
  sourceRow?: number;
  size?: "regular" | "compact";
  className?: string;
  /**
   * The line as it now stands, so a caller that shows a persistent "already
   * in cart" quantity control (rather than relying on this button's own
   * transient confirmation) has what it needs to seed one immediately.
   */
  onAdded?: (line: { lineId: number; cases: number; outcome: "added" | "already-present" }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  /**
   * Cleared on unmount, so a result arriving after the search was re-run does
   * not set state on a row that no longer exists.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const show = useCallback((next: Outcome) => {
    if (!alive.current) return;
    setOutcome(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (alive.current) setOutcome(null);
    }, FEEDBACK_MS);
  }, []);

  const add = useCallback(async () => {
    // ONE REQUEST PER PRESS. The guard is here rather than only on `disabled`,
    // because a keyboard repeat can fire before React has re-rendered.
    if (busy) return;
    setBusy(true);

    try {
      const result = await addToOrderCart([item], {
        source,
        ...(jobId ? { jobId } : {}),
        ...(sourceRow !== undefined ? { sourceRow } : {}),
      });

      const line = result.lines[0];

      if (!line) {
        // No usable identity — the backend refused rather than keying a line on
        // a product name. Its reason is written for this screen.
        show({
          kind: "error",
          text: result.skipped[0]?.reason ?? "This product could not be identified.",
        });
        return;
      }

      if (line.outcome === "added") {
        show({ kind: "added", text: "In order cart" });
        onAdded?.({ lineId: line.lineId, cases: line.cases, outcome: "added" });
        return;
      }

      // `ensure` left the quantity alone, which is the whole point of it.
      show({ kind: "already", text: `Already in cart · ${line.cases}` });
      onAdded?.({ lineId: line.lineId, cases: line.cases, outcome: "already-present" });
    } catch (error) {
      show({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Could not reach the order cart.",
      });
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [busy, item, source, jobId, sourceRow, show, onAdded]);

  const compact = size === "compact";
  const shape = compact ? "px-2.5 py-1 text-[11.5px]" : "w-full px-3 py-2.5 text-[13px]";

  if (outcome) {
    return (
      <span
        role="status"
        title={outcome.kind === "error" ? outcome.text : undefined}
        className={`inline-block rounded-md text-center font-medium ${shape} ${
          outcome.kind === "error"
            ? "bg-red-50 text-red-600"
            : outcome.kind === "added"
              ? "bg-good-50 text-good-600"
              : "bg-canvas text-ink-soft"
        } ${className}`}
      >
        {outcome.kind === "added" ? "✓ " : outcome.kind === "already" ? "✓ " : ""}
        {outcome.text}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void add()}
      // Says what it does, and says which of the two carts it means. The
      // button beside this one spends money at a wholesaler.
      title="Put this product on your order cart. Nothing is ordered and no supplier is contacted."
      className={`rounded-md border border-line font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${shape} ${className}`}
    >
      {busy ? "Adding…" : "＋ Order cart"}
    </button>
  );
}
