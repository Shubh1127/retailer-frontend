"use client";

/**
 * One supplier's connect / change-password form, and the status it reports.
 *
 * SHARED between Get Started and the Suppliers page, because they are the same
 * action asked at two moments. A second copy would be a second place for the
 * password to be mishandled, and the whole point of this component is that
 * there is exactly one.
 *
 * WHAT HAPPENS TO THE PASSWORD
 *
 * It lives in one `useState` for as long as the form is open, goes into the
 * request body, and is cleared the moment the save resolves — including when it
 * fails, because a retailer retyping is cheaper than a password sitting in a
 * component that might get serialised into a devtools snapshot or an error
 * report. It is never put in a URL, never written to storage, never logged, and
 * never sent anywhere but the credential API.
 *
 * SAVE THEN TEST, ALWAYS IN THAT ORDER AND ALWAYS ONCE
 *
 * Saving stores the details; testing logs into the wholesaler for real. One
 * test runs automatically after a successful save — because that is the moment
 * a retailer wants to know — and never again without a press. A test is a real
 * login to a real trade account, and firing them on render or on navigation is
 * how an account gets rate-limited or locked.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import PasswordInput from "@/components/PasswordInput";

import { ApiError } from "@/lib/api/client";
import {
  connectSupplier,
  testSupplierConnection,
  type SupplierCredential,
} from "@/lib/api/supplierCredentials";

/** What the form is doing, so buttons can be disabled precisely. */
type Phase = "idle" | "saving" | "testing";

export interface ConnectOutcome {
  connection: SupplierCredential;
  tested: { ok: boolean; error?: string };
}

/**
 * How a stored credential is reported.
 *
 * FOUR STATES, and the fourth is the one that must not be collapsed into the
 * others. `secretUnreadable` means the server cannot decrypt what it stored —
 * an encryption-key problem — and telling a retailer their password is wrong
 * would send them to reset a password that was never the problem.
 */
export function credentialStatus(credential?: SupplierCredential): {
  label: string;
  tone: "ok" | "warn" | "bad" | "idle";
  detail?: string;
} {
  if (!credential || !credential.secretSet) {
    return { label: "Not connected", tone: "idle" };
  }

  if (credential.secretUnreadable) {
    return {
      label: "Needs attention",
      tone: "bad",
      // Addressed to whoever runs the system, not to the person reading it —
      // and explicitly NOT "your password is wrong".
      detail:
        "This account cannot be read because of a server configuration problem. " +
        "Your password is not at fault — please contact support.",
    };
  }

  if (credential.status === "failed") {
    return {
      label: "Sign-in failed",
      tone: "bad",
      ...(credential.lastError ? { detail: credential.lastError } : {}),
    };
  }

  if (credential.status === "verified") {
    return {
      label: "Verified",
      tone: "ok",
      ...(credential.lastVerifiedAt
        ? {
            detail: `Checked ${new Date(credential.lastVerifiedAt).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })}`,
          }
        : {}),
    };
  }

  return { label: "Saved · not yet checked", tone: "warn" };
}

const TONE: Record<"ok" | "warn" | "bad" | "idle", string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  bad: "border-red-200 bg-red-50 text-red-700",
  idle: "border-line bg-canvas text-ink-faint",
};

export function StatusPill({ credential }: { credential?: SupplierCredential }) {
  const status = credentialStatus(credential);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-2 py-0.5 text-[11.5px] font-medium ${TONE[status.tone]}`}
    >
      {status.label}
    </span>
  );
}

export default function SupplierConnectForm({
  supplierId,
  supplierName,
  existing,
  onConnected,
  onCancel,
}: {
  supplierId: string;
  supplierName: string;
  /** Present when this is a password CHANGE rather than a first connection. */
  existing?: SupplierCredential;
  onConnected: (outcome: ConnectOutcome) => void;
  onCancel?: () => void;
}) {
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";
  const changing = Boolean(existing?.secretSet);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setError(null);
    setPhase("saving");

    try {
      const connection = await connectSupplier(supplierId, username.trim(), password);

      /**
       * CLEARED THE INSTANT IT IS NO LONGER NEEDED, before the test runs and
       * before anything is handed back to the parent. The test authenticates
       * with what the SERVER now holds, so nothing here needs the password
       * again.
       */
      setPassword("");

      setPhase("testing");
      // ONE test, here, because this is the moment somebody wants to know.
      const tested = await testSupplierConnection(supplierId);

      onConnected({
        connection: tested.connection ?? connection,
        tested: { ok: tested.ok, ...(tested.error ? { error: tested.error } : {}) },
      });
    } catch (cause) {
      setPassword("");

      // Distinguished, because the retailer's next move differs for each.
      if (cause instanceof ApiError && cause.status === 401) {
        setError("Your session has expired. Please sign in again.");
      } else if (cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError(
          "Could not reach the server. Check your connection and try again.",
        );
      }
    } finally {
      setPhase("idle");
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <div>
        <label
          htmlFor={`${supplierId}-username`}
          className="block text-[12px] font-medium text-ink-soft"
        >
          {supplierName} account email or username
        </label>
        <input
          id={`${supplierId}-username`}
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={busy}
          autoComplete="off"
          required
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-ink-faint disabled:opacity-50"
          placeholder="you@yourshop.ie"
        />
      </div>

      <div>
        <label
          htmlFor={`${supplierId}-password`}
          className="block text-[12px] font-medium text-ink-soft"
        >
          {changing ? "New password" : "Password"}
        </label>
        <div className="mt-1">
          {/* REVEALABLE, because this is typed from a note or a saved list into
              an app that will use it against somebody else's site. A wrong
              character comes back minutes later as "sign-in refused" and
              nothing more, on an account that can lock after a few attempts —
              so checking it before pressing Connect is worth a button.

              `new-password` so a browser does not offer the retailer's password
              for THIS app when the field is asking for a wholesaler's. */}
          <PasswordInput
            id={`${supplierId}-password`}
            value={password}
            onChange={setPassword}
            disabled={busy}
            required
            placeholder="••••••••"
          />
        </div>
        <p className="mt-1 text-[11.5px] text-ink-faint">
          Stored encrypted. We use it only to read your prices and fill your basket at{" "}
          {supplierName}.
        </p>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-700"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap gap-2">
        {/* Disabled while anything is in flight, so a double press cannot write
            the credential twice or start two logins at one wholesaler. */}
        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="rounded-md bg-teal-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase === "saving"
            ? "Saving…"
            : phase === "testing"
              ? "Checking with " + supplierName + "…"
              : changing
                ? "Update password"
                : "Connect"}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-line px-4 py-2 text-[13px] font-medium text-ink-soft hover:bg-canvas hover:text-ink disabled:opacity-40"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
