"use client";

/**
 * "One of the wholesalers is missing from this answer" — said to a retailer.
 *
 * WHY THE BANNER EXISTS AT ALL. A supplier that FAILED and a supplier that
 * simply had nothing produce the same empty column, and folding them together
 * means a Musgrave outage reads as "Musgrave do not stock this" — the one
 * conclusion nobody may draw from it, because acting on it sends the order to
 * somebody dearer. So the failure is always shown.
 *
 * WHY IT NO LONGER SHOWS WHAT FAILED. The backend's message is written for
 * whoever has to fix it, and it was being printed verbatim on a shop floor:
 *
 *   Barry search failed for departments 6, 35: Cloudflare blocked this request
 *   at the edge (HTTP 403, https://ind.barrys.ie/products/list.asp?product_desc=…)
 *   … connect the VPN and try again. Verify with: curl -s -o /dev/null …
 *
 * None of that is actionable by a buyer, and all of it is alarming. The
 * diagnosis goes to the browser console, where the person who can act on it
 * will look; the screen keeps the one sentence that changes what the retailer
 * should believe about the results in front of them.
 */

import { useEffect } from "react";

import { cartSupplierLabel } from "@/lib/api/cart";

export interface SupplierNotice {
  supplierId: string;
  message: string;
}

export default function SupplierNotices({
  errors,
  context = "product search",
}: {
  errors: readonly SupplierNotice[] | undefined;
  /** Names the operation in the console line, so two screens are tellable apart. */
  context?: string;
}) {
  // Keyed on the messages, so a re-render does not re-log and a genuinely new
  // failure does.
  const signature = (errors ?? []).map((e) => `${e.supplierId}:${e.message}`).join("|");

  useEffect(() => {
    if (!signature) return;
    for (const entry of signature.split("|")) {
      const at = entry.indexOf(":");
      // eslint-disable-next-line no-console
      console.warn(
        `[${context}] ${entry.slice(0, at)} could not be searched — ${entry.slice(at + 1)}`,
      );
    }
  }, [signature, context]);

  if (!errors || errors.length === 0) return null;

  return (
    <>
      {errors.map((entry) => (
        <div
          key={entry.supplierId}
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
        >
          <strong className="font-medium">{cartSupplierLabel(entry.supplierId)}</strong> could
          not be reached, so its products are missing from these results — that is not the same
          as it not stocking them.
        </div>
      ))}
    </>
  );
}
