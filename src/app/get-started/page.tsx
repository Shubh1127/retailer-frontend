"use client";

/**
 * Get Started — connect the trade accounts, one at a time.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The app compares a retailer's own prices at their own wholesalers. Until they
 * connect at least one account it can do nothing: a search has nobody to ask, a
 * basket has nowhere to go. Landing a first-time retailer on an empty dashboard
 * and letting them discover that by uploading a file is the wrong order to find
 * it out in.
 *
 * ONE AT A TIME, AND NONE OF THEM COMPULSORY
 *
 * The list is every supplier the backend says is connectable, and a retailer can
 * connect one and leave. That is the realistic first visit — somebody trying the
 * system with the account they remember the password for — and the Suppliers
 * page is where the rest get added later. So the finish button unlocks as soon
 * as ONE account is connected, and this page is reachable again from the gate
 * and from Suppliers.
 *
 * NOT A WIZARD YOU CAN BE TRAPPED IN. There is always a way out; a retailer who
 * has connected something is never made to connect more.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import AppShell from "@/components/AppShell";
import SupplierConnectForm, {
  StatusPill,
  type ConnectOutcome,
} from "@/components/SupplierConnectForm";
import { ApiError } from "@/lib/api/client";
import {
  getOnboardingState,
  listSupplierCredentials,
  type ConnectableSupplier,
  type SupplierCredential,
} from "@/lib/api/supplierCredentials";

/**
 * Motion that reads as arrival rather than decoration.
 *
 * Short and small: a retailer standing in a shop is setting something up, not
 * watching it. `prefers-reduced-motion` is honoured by framer-motion's own
 * `MotionConfig` at the app level; these values are chosen to be unobtrusive
 * even when it plays.
 */
const card = {
  hidden: { opacity: 0, y: 8 },
  shown: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: index * 0.06, duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function GetStartedPage() {
  const router = useRouter();

  const [connectable, setConnectable] = useState<ConnectableSupplier[]>([]);
  const [credentials, setCredentials] = useState<SupplierCredential[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  /** The result of the one test that ran after a save, by supplier. */
  const [tested, setTested] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const load = useCallback(async () => {
    try {
      // Both in one round trip's worth of waiting; neither depends on the other.
      const [onboarding, stored] = await Promise.all([
        getOnboardingState(),
        listSupplierCredentials(),
      ]);
      setConnectable(onboarding.connectable);
      setCredentials(stored);
      setStatus("ready");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setError("Your session has expired. Please sign in again.");
      } else {
        setError("Could not load your account setup. Check your connection and try again.");
      }
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const credentialFor = (supplierId: string): SupplierCredential | undefined =>
    credentials.find((entry) => entry.supplierId === supplierId);

  const connectedCount = credentials.filter((entry) => entry.secretSet).length;

  const onConnected = (supplierId: string, outcome: ConnectOutcome) => {
    setCredentials((current) => [
      ...current.filter((entry) => entry.supplierId !== supplierId),
      outcome.connection,
    ]);
    setTested((current) => ({ ...current, [supplierId]: outcome.tested }));
    setOpenId(null);
  };

  return (
    <AppShell active="Get started">
      <div className="mx-auto max-w-2xl">
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Connect your supplier accounts
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            RetailCompare signs in as you at your own wholesalers to read your prices and
            fill your baskets. Connect at least one to get started — you can add the rest
            whenever you like.
          </p>
        </motion.div>

        {status === "loading" && (
          <div className="mt-6 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-line bg-canvas" />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                void load();
              }}
              className="ml-2 underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        )}

        {status === "ready" && (
          <>
            <div className="mt-6 space-y-3">
              {connectable.map((supplier, index) => {
                const credential = credentialFor(supplier.supplierId);
                const isOpen = openId === supplier.supplierId;
                const result = tested[supplier.supplierId];

                return (
                  <motion.section
                    key={supplier.supplierId}
                    custom={index}
                    initial="hidden"
                    animate="shown"
                    variants={card}
                    className="rounded-xl border border-line bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-[15px] font-semibold text-ink">{supplier.name}</h2>
                        {credential?.username && (
                          <p className="mt-0.5 break-all text-[12px] text-ink-soft">
                            {credential.username}
                          </p>
                        )}
                      </div>
                      <StatusPill {...(credential ? { credential } : {})} />
                    </div>

                    {/* What the one automatic test found, said plainly. */}
                    <AnimatePresence>
                      {result && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className={`mt-2 rounded-md px-3 py-2 text-[12.5px] ${
                            result.ok
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {result.ok
                            ? `Signed in to ${supplier.name} successfully.`
                            : `${supplier.name} refused the sign-in${result.error ? `: ${result.error}` : "."}`}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <AnimatePresence initial={false}>
                      {isOpen ? (
                        <motion.div
                          key="form"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <SupplierConnectForm
                            supplierId={supplier.supplierId}
                            supplierName={supplier.name}
                            {...(credential ? { existing: credential } : {})}
                            onConnected={(outcome) => onConnected(supplier.supplierId, outcome)}
                            onCancel={() => setOpenId(null)}
                          />
                        </motion.div>
                      ) : (
                        <motion.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          <button
                            type="button"
                            onClick={() => setOpenId(supplier.supplierId)}
                            className="mt-3 rounded-md border border-teal-600 px-3.5 py-1.5 text-[13px] font-medium text-teal-700 hover:bg-teal-50"
                          >
                            {credential?.secretSet ? "Update password" : "Connect"}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.section>
                );
              })}
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-3"
            >
              <p className="text-[12.5px] text-ink-soft">
                {connectedCount === 0
                  ? "Connect one account to start comparing."
                  : `${connectedCount} account${connectedCount === 1 ? "" : "s"} connected.`}
              </p>

              <div className="flex gap-2">
                {/* Always available — a retailer is never trapped here. */}
                <Link
                  href="/suppliers"
                  className="rounded-md border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-surface hover:text-ink"
                >
                  Manage suppliers
                </Link>
                <button
                  type="button"
                  disabled={connectedCount === 0}
                  onClick={() => router.push("/dashboard")}
                  title={
                    connectedCount === 0
                      ? "Connect at least one supplier account first"
                      : "Go to the dashboard"
                  }
                  className="rounded-md bg-teal-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue
                </button>
              </div>
            </motion.div>
          </>
        )}
      </div>
    </AppShell>
  );
}
