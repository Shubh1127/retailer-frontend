/**
 * Trade-account state for the Suppliers page.
 *
 * NOTE WHAT IS ABSENT: passwords. The backend never sends one, so there is no
 * field here to hold it and nothing on the page can render it. A supplier
 * password buys stock on the shop's credit; it lives in the backend's
 * environment and has no reason to reach a browser.
 *
 * What IS here is the account NAME, which is not a secret and is the question
 * this page exists to answer — "which account are we connected as?" — plus
 * whether a password is configured at all, which is what separates a supplier
 * nobody set up from one whose login has stopped working.
 */

import { env } from "./env";
import { accessToken } from "../supabase";

export type AuthMethod = "credentials" | "session-cookie" | "none";

export interface SupplierAccount {
  configured: boolean;
  method: AuthMethod;
  /** The account we log in as. Never a password — see the module header. */
  username?: string;
  /** Whether a password is set, never what it is. */
  passwordSet: boolean;
  /** Env var names an operator would edit, so the fix is findable. */
  configuredBy: string[];
  /**
   * This is a SHARED diagnostic account, not one this person connected.
   *
   * Set for administrators, who read suppliers on the `.env` credentials. The
   * page shows their state and offers no controls: there is nothing here for an
   * admin to change, and a Connect button would invite them to replace an
   * account that is not theirs.
   */
  shared?: boolean;
  connected?: boolean;
}

export interface SupplierConnection {
  supplierId: string;
  name: string;
  isMain: boolean;
  preferenceRank?: number;
  channel: string;
  thresholdPct: number;
  minOrderValue: number;
  deliveryFee: number;
  freeDeliveryThreshold?: number;
  capabilities: { search: boolean; cart: boolean; catalogue: boolean };
  account: SupplierAccount;
  /** Set where one login serves more than one basket, as Barry's does. */
  vendorNote?: string;
}

export async function getSupplierConnections(): Promise<SupplierConnection[]> {
  const token = await accessToken();

  const res = await fetch(`${env.apiBaseUrl}/api/suppliers/connections`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not read supplier connections");
  }

  return (await res.json()) as SupplierConnection[];
}

/**
 * A one-line verdict for the card header.
 *
 * "No integration" is deliberately distinct from "Not connected". The first
 * means the app has no way to talk to this supplier at all and no amount of
 * configuration changes that today; the second means it does, and somebody
 * needs to fill something in. Collapsing them would send an operator hunting
 * for a setting that does not exist.
 */
export function connectionStatus(supplier: SupplierConnection): {
  label: string;
  tone: "ok" | "warn" | "idle";
} {
  const hasIntegration =
    supplier.capabilities.search ||
    supplier.capabilities.cart ||
    supplier.capabilities.catalogue;

  if (!hasIntegration) return { label: "No integration", tone: "idle" };
  if (!supplier.account.configured) return { label: "Not connected", tone: "warn" };
  if (supplier.account.method === "session-cookie") {
    return { label: "Connected · pasted session", tone: "warn" };
  }
  return { label: "Connected", tone: "ok" };
}
