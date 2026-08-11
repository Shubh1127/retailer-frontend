/**
 * The account-request endpoints.
 *
 * These are the only calls in the app made by someone who is NOT signed in, so
 * they do not go through `apiFetch` — that attaches a Supabase token, and there
 * is no session to take one from yet.
 *
 * They also need the server's error BODY rather than its status text. A
 * rejected password comes back as a list of the specific rules it missed, and
 * `apiFetch` flattens a failure into one string, which would turn four
 * actionable messages into one unreadable one.
 *
 * WHERE THE CLAIM TOKEN LIVES
 *
 * `localStorage`, under one key. It is the only proof that this browser is the
 * one that asked, so losing it means asking an administrator to re-issue — a
 * deliberate trade against the alternative, which is letting anyone who knows
 * an approved email address claim the account.
 *
 * It is NOT a session and grants nothing on its own: it identifies a request,
 * and the request has to have been approved before it does anything at all.
 */

import { env } from "./env";

const CLAIM_TOKEN_KEY = "retailcompare.signup.claim";

export type SignupStatus = "pending" | "approved" | "rejected" | "completed";

export interface SignupRequestView {
  email: string;
  status: SignupStatus;
  requestedAt: string;
}

export class SignupError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Per-rule failures, when the server rejected a password. */
    readonly messages?: string[],
  ) {
    super(message);
    this.name = "SignupError";
  }
}

// `Omit` before the intersection, not alongside it: `RequestInit & { body?:
// unknown }` NARROWS body to the intersection of both types rather than
// replacing it, so an object literal fails to assign.
async function call<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T> {
  const { body, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(new URL(path, env.apiBaseUrl).toString(), {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new SignupError(
      0,
      error instanceof Error
        ? `Could not reach the server: ${error.message}`
        : "Could not reach the server",
    );
  }

  const text = await response.text();
  const parsed = text ? safeParse(text) : undefined;

  if (!response.ok) {
    throw new SignupError(
      response.status,
      parsed?.error ?? response.statusText ?? "Something went wrong",
      Array.isArray(parsed?.messages) ? parsed.messages : undefined,
    );
  }

  return parsed as T;
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---- Claim token ----------------------------------------------------------

export function storedClaimToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CLAIM_TOKEN_KEY);
  } catch {
    // Private browsing and hardened settings can throw on access rather than
    // returning null. A missing token is a recoverable state; a crash is not.
    return null;
  }
}

function rememberClaimToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAIM_TOKEN_KEY, token);
  } catch {
    // Nothing to do. The flow still works within this tab, because the token is
    // also held in component state; it just will not survive a reload.
  }
}

export function forgetClaimToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLAIM_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// ---- Calls ----------------------------------------------------------------

/** Ask for an account. Returns the token this browser must keep. */
export async function requestAccount(email: string): Promise<{
  request: SignupRequestView;
  claimToken: string;
}> {
  const result = await call<SignupRequestView & { claimToken: string }>(
    "/api/signup/requests",
    { method: "POST", body: { email } },
  );

  rememberClaimToken(result.claimToken);

  return {
    request: {
      email: result.email,
      status: result.status,
      requestedAt: result.requestedAt,
    },
    claimToken: result.claimToken,
  };
}

/** Has an admin decided yet? */
export function accountRequestStatus(token: string): Promise<SignupRequestView> {
  return call<SignupRequestView>("/api/signup/requests/status", {
    method: "GET",
    headers: { "X-Claim-Token": token },
  });
}

/** Set the password. The account exists only after this succeeds. */
export function completeAccount(
  claimToken: string,
  password: string,
): Promise<{ email: string }> {
  return call<{ email: string }>("/api/signup/requests/complete", {
    method: "POST",
    body: { claimToken, password },
  });
}
