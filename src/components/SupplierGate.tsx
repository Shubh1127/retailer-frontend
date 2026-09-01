"use client";

/**
 * Stopping work that cannot possibly succeed, and saying why.
 *
 * WHAT IT GUARDS. Scanning and uploading an order file both end in the same
 * place: asking a wholesaler what something costs. With no trade account
 * connected there is nobody to ask, so the honest outcome of pressing either is
 * a job that runs and finds nothing — which reads as the product not existing,
 * or the app being broken, rather than as a setup step nobody has done.
 *
 * SO THE OPERATION IS NOT STARTED AT ALL. `guard()` returns false and the
 * caller returns early; no job is created, no camera opens, no file is parsed.
 * A gate that lets the work begin and then apologises has already produced the
 * confusing empty result it exists to prevent.
 *
 * ONE FETCH, NOT ONE PER PRESS. The answer is read once per mount and cached
 * here. Nothing in this component tests a supplier login — it only asks the
 * backend whether any credential exists, which is a database read. Testing
 * credentials is a real login at a real trade account and belongs to a button
 * somebody pressed, never to a page load.
 *
 * FAILS OPEN, DELIBERATELY. If the check itself cannot be made — offline, the
 * backend down — the gate lets the work through. Blocking a retailer who has
 * connected their accounts perfectly well, because a status endpoint was
 * briefly unreachable, would be a worse failure than the empty result this
 * prevents: they would be stopped from doing something that would have worked.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

import { getOnboardingState } from "@/lib/api/supplierCredentials";

export interface SupplierGate {
  /**
   * Call before starting work. Returns true to proceed; false means the modal
   * is now showing and the caller must do nothing further.
   */
  guard: () => boolean;
  /** Render this somewhere in the page. */
  modal: React.ReactNode;
  /** True once at least one account is connected. */
  connected: boolean;
}

export function useSupplierGate(): SupplierGate {
  /** `null` while unknown — neither connected nor known-empty. */
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getOnboardingState()
      .then((state) => {
        // An admin reads suppliers on the shared diagnostic accounts, so there
        // is nothing for them to connect and nothing to stop. Blocking them
        // would refuse work the system can do.
        if (!cancelled) {
          setConnected(state.hasConnectedSuppliers || state.usesSharedAccounts === true);
        }
      })
      .catch(() => {
        // See the header: an unanswerable check must not become a locked door.
        if (!cancelled) setConnected(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const guard = useCallback((): boolean => {
    // Unknown counts as allowed, for the same reason a failed check does.
    if (connected === false) {
      setShowing(true);
      return false;
    }
    return true;
  }, [connected]);

  return {
    guard,
    connected: connected !== false,
    modal: <SupplierGateModal open={showing} onClose={() => setShowing(false)} />,
  };
}

export function SupplierGateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Escape closes it. A modal a keyboard cannot dismiss is a trap, and this one
  // is informational — nothing is lost by closing it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="presentation"
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-gate-title"
            // Rises from the bottom on a phone, where a thumb is; settles in
            // the middle on anything wider.
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-pop"
          >
            <h2 id="supplier-gate-title" className="text-[16px] font-semibold text-ink">
              Connect a supplier account first
            </h2>

            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
              RetailCompare reads prices from your own wholesaler accounts. Until one is
              connected there is nobody to ask, so a scan or an upload would come back
              empty.
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              <Link
                href="/get-started"
                className="rounded-md bg-teal-600 px-4 py-2.5 text-center text-[13px] font-medium text-white hover:bg-teal-700"
              >
                Connect an account
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line px-4 py-2.5 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink"
              >
                Not now
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
