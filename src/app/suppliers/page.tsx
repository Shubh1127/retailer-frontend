"use client";

/**
 * Suppliers — the shop's trade accounts, what each can do, and how it buys.
 *
 * WHY NO PASSWORDS ARE SHOWN
 *
 * The card names the account the app logs in as, and says whether a password is
 * configured. It never shows the password, because the backend never sends one:
 * a supplier password buys stock on the shop's credit, and putting it in an API
 * response puts it in the network tab and in every proxy between here and the
 * server, to display a field nobody can act on from this screen.
 *
 * Everything an operator actually needs is here instead — which account, by
 * what method, and the exact setting names to change if it is wrong.
 */

import { useCallback, useEffect, useState } from "react";

import AppShell from "@/components/AppShell";
import { eur } from "@/lib/api/jobs";
import {
  connectionStatus,
  getSupplierConnections,
  type SupplierConnection,
} from "@/lib/api/suppliers";

const TONE: Record<"ok" | "warn" | "idle", string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  idle: "border-line bg-canvas text-ink-faint",
};

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
  const [suppliers, setSuppliers] = useState<SupplierConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSuppliers(await getSupplierConnections());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load suppliers");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell active="Suppliers">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Suppliers</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Your trade accounts, what each connection can do, and the buying rules
            comparison uses.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {suppliers === null && !error && (
        <p className="mt-6 text-[13px] text-ink-soft">Loading…</p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {(suppliers ?? []).map((supplier) => {
          const status = connectionStatus(supplier);
          const account = supplier.account;

          return (
            <div
              key={supplier.supplierId}
              className="rounded-xl border border-line bg-surface p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14.5px] font-semibold text-ink">{supplier.name}</p>
                  <p className="text-[12px] text-ink-soft">{supplier.channel}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${TONE[status.tone]}`}
                  >
                    {status.label}
                  </span>
                  {supplier.isMain && (
                    <span className="rounded-md border border-teal-500/20 bg-teal-50 px-2 py-0.5 text-[11.5px] font-medium text-link">
                      Main supplier
                    </span>
                  )}
                </div>
              </div>

              {/* ---- Account ------------------------------------------- */}
              <div className="mt-4 rounded-lg border border-line bg-canvas px-3.5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                    Trade account
                  </span>
                  {account.configured && (
                    <span className="text-[11.5px] text-ink-faint">
                      {account.method === "credentials"
                        ? "Username and password"
                        : "Pasted browser session"}
                    </span>
                  )}
                </div>

                {account.username ? (
                  <p className="mt-1 break-all font-mono text-[13px] text-ink">
                    {account.username}
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-ink-soft">
                    {account.configured
                      ? "Signed in with a pasted session — no username stored."
                      : "No account configured."}
                  </p>
                )}

                <p className="mt-1.5 text-[11.5px] text-ink-soft">
                  {/* The password is never sent to this page. Saying so beats a
                      row of dots, which implies a value is here that is not. */}
                  Password{" "}
                  {account.passwordSet ? (
                    <span className="text-emerald-700">set</span>
                  ) : (
                    <span className="text-amber-700">not set</span>
                  )}{" "}
                  — held on the server and never shown here.
                </p>

                {account.method === "session-cookie" && (
                  <p className="mt-1.5 text-[11.5px] text-amber-700">
                    A pasted session expires and cannot renew itself, so a long
                    sync can stop partway. Adding a username and password makes it
                    self-healing.
                  </p>
                )}

                {!account.configured && account.configuredBy.length > 0 && (
                  <p className="mt-1.5 text-[11.5px] text-ink-faint">
                    Set{" "}
                    <span className="font-mono">{account.configuredBy.join(", ")}</span>{" "}
                    on the server to connect.
                  </p>
                )}
              </div>

              {supplier.vendorNote && (
                <p className="mt-2 text-[11.5px] text-ink-soft">{supplier.vendorNote}</p>
              )}

              {/* ---- What the connection can do ------------------------ */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Capability on={supplier.capabilities.search} label="Live search" />
                <Capability on={supplier.capabilities.cart} label="Add to basket" />
                <Capability on={supplier.capabilities.catalogue} label="Synced catalogue" />
              </div>

              {/* ---- Buying rules -------------------------------------- */}
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
                <Fact
                  label="Compare threshold"
                  value={`${Math.round(supplier.thresholdPct * 100)}%`}
                />
                <Fact
                  label="Minimum order"
                  value={supplier.minOrderValue > 0 ? eur(supplier.minOrderValue) : "None"}
                />
                <Fact
                  label="Delivery"
                  value={supplier.deliveryFee > 0 ? eur(supplier.deliveryFee) : "Free"}
                />
              </div>

              {supplier.freeDeliveryThreshold !== undefined &&
                supplier.freeDeliveryThreshold > 0 && (
                  <p className="mt-2 text-center text-[11.5px] text-ink-soft">
                    Free delivery over {eur(supplier.freeDeliveryThreshold)}
                  </p>
                )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
