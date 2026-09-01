"use client";

/**
 * Suppliers — the shop's own trade accounts, and the rules comparison buys by.
 *
 * TWO SECTIONS, BECAUSE THEY ARE TWO DIFFERENT THINGS
 *
 *   Trade accounts   one card per LOGIN. What the retailer connected, whether
 *                    it works, and how to change it.
 *   Buying rules     one card per COMMERCIAL SUPPLIER — thresholds, minimums,
 *                    delivery — which is a different list.
 *
 * They are different lists because Barry Group is ONE login and TWO baskets.
 * Ambient and chill have their own delivery days and their own minimums, so
 * allocation genuinely needs them apart; a retailer typing a password does not,
 * and asking for it twice would give them two places for one credential to
 * drift out of step. Splitting the page this way is what keeps both facts true
 * at once.
 *
 * NO PASSWORD IS EVER SHOWN, because none is ever sent. The status says whether
 * one is stored and whether it has been proven to work — which is what somebody
 * looking at this page is actually asking.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import AppShell from "@/components/AppShell";
import SupplierConnectForm, {
  StatusPill,
  credentialStatus,
  type ConnectOutcome,
} from "@/components/SupplierConnectForm";
import { ApiError } from "@/lib/api/client";
import { eur } from "@/lib/api/jobs";
import {
  disconnectSupplier,
  getOnboardingState,
  listSupplierCredentials,
  testSupplierConnection,
  type ConnectableSupplier,
  type SupplierCredential,
} from "@/lib/api/supplierCredentials";
import { getSupplierConnections, type SupplierConnection } from "@/lib/api/suppliers";

function Capability({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
        on ? "bg-teal-50 text-link" : "bg-canvas text-ink-faint line-through"
      }`}
    >
      {on ? "✓" : "—"} {label}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="nums text-[15px] font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}

export default function SuppliersPage() {
  const [connectable, setConnectable] = useState<ConnectableSupplier[]>([]);
  const [credentials, setCredentials] = useState<SupplierCredential[]>([]);
  const [rules, setRules] = useState<SupplierConnection[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  /**
   * This account reads suppliers on the SHARED diagnostic credentials.
   *
   * True for administrators. They connect nothing of their own, so the page
   * shows what the shared accounts are and offers no Connect, Update or
   * Disconnect — none of those would be theirs to press.
   */
  const [sharedAccounts, setSharedAccounts] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  /** Which supplier has a request in flight, so its buttons can be disabled. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const load = useCallback(async () => {
    try {
      const [onboarding, stored, buying] = await Promise.all([
        getOnboardingState(),
        listSupplierCredentials(),
        getSupplierConnections(),
      ]);
      setConnectable(onboarding.connectable);
      setCredentials(stored);
      setRules(buying);
      setSharedAccounts(onboarding.usesSharedAccounts === true);
      setError(null);
      setStatus("ready");
    } catch (cause) {
      // Distinguished: an expired session is fixed by signing in, a network
      // failure by trying again, and telling somebody the wrong one wastes
      // their time.
      if (cause instanceof ApiError && cause.status === 401) {
        setError("Your session has expired. Please sign in again.");
      } else if (cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const credentialFor = (supplierId: string): SupplierCredential | undefined =>
    credentials.find((entry) => entry.supplierId === supplierId);

  const onConnected = (supplierId: string, outcome: ConnectOutcome) => {
    setCredentials((current) => [
      ...current.filter((entry) => entry.supplierId !== supplierId),
      outcome.connection,
    ]);
    setTested((current) => ({ ...current, [supplierId]: outcome.tested }));
    setOpenId(null);
  };

  /**
   * Log in for real, because somebody asked.
   *
   * NEVER ON LOAD and never for every supplier at once — this is a genuine
   * request to a trade account that can rate-limit or lock.
   */
  const runTest = async (supplierId: string) => {
    if (busyId) return;
    setBusyId(supplierId);
    try {
      const result = await testSupplierConnection(supplierId);
      setTested((current) => ({
        ...current,
        [supplierId]: { ok: result.ok, ...(result.error ? { error: result.error } : {}) },
      }));
      if (result.connection) {
        setCredentials((current) => [
          ...current.filter((entry) => entry.supplierId !== supplierId),
          result.connection!,
        ]);
      }
    } catch (cause) {
      setTested((current) => ({
        ...current,
        [supplierId]: {
          ok: false,
          error:
            cause instanceof ApiError && cause.status === 401
              ? "Your session has expired. Please sign in again."
              : "Could not reach the server.",
        },
      }));
    } finally {
      setBusyId(null);
    }
  };

  const runDisconnect = async (supplierId: string, name: string) => {
    if (busyId) return;
    // A real order path is being removed; a stray click should not do it.
    if (!window.confirm(`Disconnect your ${name} account? Orders will stop going to it.`)) {
      return;
    }

    setBusyId(supplierId);
    try {
      await disconnectSupplier(supplierId);
      setCredentials((current) => current.filter((entry) => entry.supplierId !== supplierId));
      setTested((current) => {
        const next = { ...current };
        delete next[supplierId];
        return next;
      });
    } catch (cause) {
      setTested((current) => ({
        ...current,
        [supplierId]: {
          ok: false,
          error: cause instanceof ApiError ? cause.message : "Could not disconnect.",
        },
      }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell active="Suppliers">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">Suppliers</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">
          Your trade accounts, and the buying rules comparison uses.
        </p>
      </div>

      {status === "error" && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
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

      {status === "loading" && (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-canvas" />
          ))}
        </div>
      )}

      {status === "ready" && (
        <>
          {/* ---- Trade accounts: ONE CARD PER LOGIN ----------------------
              HIDDEN ENTIRELY FOR AN ADMINISTRATOR.

              There is nothing here for them. They connect no accounts of their
              own — supplier reads run on the shared `.env` credentials — so the
              whole section would be four cards offering to connect, update or
              disconnect logins that are configured on the server and are not
              theirs to change. Showing it read-only was still showing it; the
              honest answer is that this section is about a retailer's own trade
              accounts, and an admin has none. */}
          {!sharedAccounts && (
          <>
          <h2 className="mt-7 text-[15px] font-semibold text-ink">Trade accounts</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            We sign in as you to read your prices and fill your baskets. Passwords are
            stored encrypted and never shown here.
          </p>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {connectable.map((supplier) => {
              const credential = credentialFor(supplier.supplierId);
              const state = credentialStatus(credential);
              const isOpen = openId === supplier.supplierId;
              const busy = busyId === supplier.supplierId;
              const result = tested[supplier.supplierId];

              return (
                <section
                  key={supplier.supplierId}
                  className="rounded-xl border border-line bg-surface p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-ink">{supplier.name}</p>
                      {credential?.username ? (
                        <p className="mt-0.5 break-all font-mono text-[12.5px] text-ink-soft">
                          {credential.username}
                        </p>
                      ) : sharedAccounts ? (
                        <p className="mt-0.5 text-[12.5px] text-ink-soft">
                          Shared diagnostic account
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[12.5px] text-ink-faint">No account connected</p>
                      )}
                    </div>
                    {sharedAccounts && !credential ? (
                      <span className="inline-flex shrink-0 items-center rounded border border-line bg-canvas px-2 py-0.5 text-[11.5px] font-medium text-ink-soft">
                        Shared
                      </span>
                    ) : (
                      <StatusPill {...(credential ? { credential } : {})} />
                    )}
                  </div>

                  {/* The detail behind the pill — including, for an unreadable
                      secret, a message about OUR configuration rather than
                      their password. */}
                  {state.detail && (
                    <p
                      className={`mt-2 text-[12px] ${
                        state.tone === "bad" ? "text-red-700" : "text-ink-soft"
                      }`}
                    >
                      {state.detail}
                    </p>
                  )}

                  <AnimatePresence>
                    {result && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className={`mt-2 overflow-hidden rounded-md px-3 py-2 text-[12.5px] ${
                          result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {result.ok
                          ? `Signed in to ${supplier.name} successfully.`
                          : `${supplier.name} refused the sign-in${result.error ? `: ${result.error}` : "."}`}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  {/* NOTHING TO PRESS ON A SHARED ACCOUNT. It is configured on
                      the server and is not this person's to change; a Connect
                      button here would offer to replace somebody else's login. */}
                  {sharedAccounts && !credential ? (
                    <p className="mt-3 text-[12px] text-ink-faint">
                      Configured on the server. Retailers connect their own accounts here.
                    </p>
                  ) : (
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
                      <div key="actions" className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenId(supplier.supplierId)}
                          disabled={busy}
                          className="rounded-md border border-teal-600 px-3 py-1.5 text-[12.5px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40"
                        >
                          {credential?.secretSet ? "Update password" : "Connect"}
                        </button>

                        {credential?.secretSet && (
                          <>
                            <button
                              type="button"
                              onClick={() => void runTest(supplier.supplierId)}
                              disabled={busy}
                              className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40"
                            >
                              {busy ? "Checking…" : "Test connection"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void runDisconnect(supplier.supplierId, supplier.name)}
                              disabled={busy}
                              className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                            >
                              Disconnect
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </AnimatePresence>
                  )}
                </section>
              );
            })}
          </div>

          </>
          )}

          {/* What an admin gets instead: one line saying where the accounts
              live, with nothing to press. */}
          {sharedAccounts && (
            <p className="mt-7 rounded-xl border border-line bg-canvas px-4 py-3 text-[12.5px] text-ink-soft">
              You are signed in as an administrator. Supplier reads use the shared
              diagnostic accounts configured on the server, so there are no trade
              accounts to connect here. Retailers connect their own.
            </p>
          )}

          {/* ---- Buying rules: one card per commercial supplier ---------- */}
          <h2 className="mt-8 text-[15px] font-semibold text-ink">Buying rules</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            How comparison decides between suppliers. Barry Group appears twice here —
            ambient and chill are separate orders with their own minimums — but they share
            the single login above.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {rules.map((supplier) => (
              <div
                key={supplier.supplierId}
                className="rounded-xl border border-line bg-surface p-5 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[14.5px] font-semibold text-ink">{supplier.name}</p>
                    <p className="text-[12px] text-ink-soft">{supplier.channel}</p>
                  </div>
                  {supplier.isMain && (
                    <span className="shrink-0 rounded-md border border-teal-500/20 bg-teal-50 px-2 py-0.5 text-[11.5px] font-medium text-link">
                      Main supplier
                    </span>
                  )}
                </div>

                {supplier.vendorNote && (
                  <p className="mt-2 text-[11.5px] text-ink-soft">{supplier.vendorNote}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Capability on={supplier.capabilities.search} label="Live search" />
                  <Capability on={supplier.capabilities.cart} label="Add to basket" />
                  <Capability on={supplier.capabilities.catalogue} label="Synced catalogue" />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
                  <Fact
                    label="Compare threshold"
                    value={`${Math.round(supplier.thresholdPct * 100)}%`}
                  />
                  {/* "NOT PUBLISHED" IS NOT "NONE".
                      Two of these wholesalers state a minimum — Kadona €1,000,
                      Musgrave €150 — and the rest publish nothing. Rendering
                      the absence as "None" asserted a fact nobody has told us,
                      and a buyer building a small order off that would find out
                      at the supplier's checkout. */}
                  <Fact
                    label="Minimum order"
                    value={
                      supplier.minOrderValue > 0 ? eur(supplier.minOrderValue) : "Not published"
                    }
                  />
                  <Fact
                    label="Delivery"
                    value={supplier.deliveryFee > 0 ? eur(supplier.deliveryFee) : "Free"}
                  />
                </div>

                {/* A DELIVERY THRESHOLD, kept well away from the minimum
                    beside it. O'Reilly's €35 is the order value at which
                    carriage stops being charged — not a floor below which they
                    refuse to sell, which is what the Minimum order column
                    means. Reading one as the other is how a €30 basket gets
                    moved to a dearer wholesaler for no reason. */}
                {supplier.freeDeliveryThreshold !== undefined &&
                  supplier.freeDeliveryThreshold > 0 && (
                    <p className="mt-2 text-center text-[11.5px] text-ink-soft">
                      Free delivery over {eur(supplier.freeDeliveryThreshold)}
                    </p>
                  )}
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
