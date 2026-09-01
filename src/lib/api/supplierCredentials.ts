/**
 * Connecting a retailer's own supplier trade accounts.
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 * It never receives a password, never returns one, and never keeps one. The
 * types below have no field for a password on the way OUT — only `connect()`
 * takes one, as an argument, on its way to the backend. That is structural
 * rather than a rule to remember: there is nowhere in `SupplierCredential` for
 * a secret to live, so no component can render one by accident.
 *
 * A password also never becomes part of a URL. `connect` puts it in a JSON
 * body, because query strings end up in browser history, in server access logs,
 * and in the `Referer` header of the next request out.
 *
 * SAVING AND TESTING ARE TWO CALLS, ON PURPOSE
 *
 * `connect` stores the details and reports `unverified`. `test` logs into the
 * wholesaler for real. They are separate because a supplier being briefly
 * unreachable must not stop a retailer recording a password that is perfectly
 * correct — and because a login is a real request to a real trade account,
 * which is not something to fire on every page load. Nothing here tests
 * automatically; every call is somebody pressing a button.
 */

import { env } from "./env";
import { accessToken } from "../supabase";
import { ApiError } from "./client";

/** How a stored connection authenticates. */
export type CredentialAuthMethod = "credentials" | "session-cookie";

/**
 * Whether a stored credential has been proven to work.
 *
 *   unverified  saved, never tried. Not a warning — just untested.
 *   verified    a real login succeeded.
 *   failed      a real login was refused. The retailer can act on this.
 */
export type CredentialStatus = "unverified" | "verified" | "failed";

export interface SupplierCredential {
  supplierId: string;
  /** The account we log in as. Not a secret. */
  username?: string;
  authMethod: CredentialAuthMethod;
  /** A secret is stored. Never what it is. */
  secretSet: boolean;
  /**
   * A secret is stored and cannot be decrypted.
   *
   * An ENCRYPTION KEY problem, not a wrong password — the two must never be
   * shown the same way. Telling a retailer their password is wrong when the
   * server has lost the key sends them to reset a password that was fine.
   */
  secretUnreadable: boolean;
  status: CredentialStatus;
  lastVerifiedAt?: string;
  lastError?: string;
  updatedAt?: string;
}

export interface ConnectableSupplier {
  supplierId: string;
  name: string;
}

export interface OnboardingState {
  /**
   * Whose answer this is.
   *
   * The onboarding latch lives in `sessionStorage`, which belongs to the TAB
   * rather than the person — so it has to be keyed on the user, or one
   * retailer's latch silences the next one's onboarding in the same browser.
   */
  userId?: string;
  /** Has this retailer ever signed in before? Nothing gates on it; reported honestly. */
  firstLogin: boolean;
  /** Can they actually trade? Decides whether scanning and uploading are gated. */
  hasConnectedSuppliers: boolean;
  connectedCount: number;
  role?: "retailer" | "admin";
  /**
   * This account reads suppliers on the SHARED diagnostic credentials.
   *
   * True for administrators. Onboarding and the "connect an account first" gate
   * both answer a question that does not apply to them — the system already
   * works — so both stand down. Kept separate from `hasConnectedSuppliers`
   * because the Suppliers page still needs to know they have connected nothing
   * of their own, so it can say the accounts are shared rather than offer to
   * disconnect one that is not theirs.
   */
  usesSharedAccounts?: boolean;
  /** The roster comes from the backend so a new supplier appears without a deploy. */
  connectable: ConnectableSupplier[];
}

async function authorisedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();

  return fetch(`${env.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Turn a response into either a value or an `ApiError` carrying its status.
 *
 * The STATUS is kept because the caller has genuinely different things to say
 * for each: 401 means the session lapsed and the answer is to sign in again;
 * 409 means nothing is connected yet; anything else is a fault the retailer
 * cannot fix by retyping.
 */
async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? fallback, res.status);
  }
  return (await res.json()) as T;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  return unwrap<OnboardingState>(
    await authorisedFetch("/api/me/onboarding"),
    "Could not check your account setup.",
  );
}

export async function listSupplierCredentials(): Promise<SupplierCredential[]> {
  const body = await unwrap<{ connections: SupplierCredential[] }>(
    await authorisedFetch("/api/supplier-credentials"),
    "Could not read your connected accounts.",
  );
  return body.connections;
}

/**
 * Store a username and password for one supplier.
 *
 * The password is passed straight through to `fetch` and is not held anywhere
 * else — no module state, no cache, no storage. The caller is expected to clear
 * its own form field once this resolves.
 */
export async function connectSupplier(
  supplierId: string,
  username: string,
  password: string,
): Promise<SupplierCredential> {
  const body = await unwrap<{ connection: SupplierCredential }>(
    await authorisedFetch(`/api/supplier-credentials/${encodeURIComponent(supplierId)}`, {
      method: "PUT",
      body: JSON.stringify({ username, password }),
    }),
    "Could not save these details.",
  );
  return body.connection;
}

export async function disconnectSupplier(supplierId: string): Promise<void> {
  await unwrap<unknown>(
    await authorisedFetch(`/api/supplier-credentials/${encodeURIComponent(supplierId)}`, {
      method: "DELETE",
    }),
    "Could not disconnect this account.",
  );
}

export interface TestResult {
  ok: boolean;
  /** The supplier's own words when it refused. Absent when it worked. */
  error?: string;
  /** True when there is nothing stored to test. */
  notConnected?: boolean;
  connection?: SupplierCredential;
}

/**
 * Log into the wholesaler for real, and report what happened.
 *
 * A REFUSED LOGIN COMES BACK AS `ok: false`, NOT AS A THROW. The request
 * succeeded; the supplier said no, and that is a normal answer this screen has
 * something useful to show for. Only a transport or session failure throws.
 *
 * This is a real request to a real trade account, which can rate-limit or lock.
 * Call it when somebody asks, and once after connecting — never on page load,
 * and never for every supplier at once.
 */
export async function testSupplierConnection(supplierId: string): Promise<TestResult> {
  const res = await authorisedFetch(
    `/api/supplier-credentials/${encodeURIComponent(supplierId)}/test`,
    { method: "POST" },
  );

  // 409 is "nothing stored yet" — a state, not a fault.
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, notConnected: true, ...(body.error ? { error: body.error } : {}) };
  }

  return unwrap<TestResult>(res, "Could not reach the supplier.");
}

/** Barry is one login behind two baskets — see the backend's `credentialSupplierId`. */
export function credentialSupplierId(supplierId: string): string {
  return supplierId.startsWith("barrygroup") ? "barrygroup" : supplierId;
}
