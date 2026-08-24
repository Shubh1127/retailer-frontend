import { env } from "./env";
import { accessToken } from "../supabase";
import { handleSessionExpired } from "../sessionExpiry";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /**
   * Background traffic: polling, refreshes, anything happening because a timer
   * fired rather than because somebody did something.
   *
   * The backend's 30-minute inactivity timeout reads ordinary requests as
   * "somebody is here". The job list polls every five seconds, so a tab left
   * open on it would keep a session alive for ever — which is exactly the case
   * the timeout exists to catch. Marking those keeps them authenticated
   * without letting them count as presence.
   */
  passive?: boolean;
}

/**
 * Thin wrapper around fetch that:
 *  - resolves paths against env.apiBaseUrl
 *  - serializes query params
 *  - throws ApiError on non-2xx responses
 *  - parses JSON responses
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, body, headers, passive, ...init } = options;

  const url = new URL(path, env.apiBaseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  // The API is authenticated end to end now. The token is attached here rather
  // than at each call site so a new endpoint cannot be added unauthenticated by
  // forgetting it.
  const token = await accessToken();

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Opt-in, so a caller that says nothing counts as a person being
        // present. The safe direction: a poll wrongly counted as activity only
        // keeps a session alive, while a real action wrongly counted as passive
        // would sign somebody out mid-order.
        ...(passive ? { "X-Activity": "passive" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Network failure (backend down, CORS, etc.)
    throw new ApiError(
      err instanceof Error ? `Network error: ${err.message}` : "Network error",
      0
    );
  }

  if (!res.ok) {
    // 401 means the session is no longer accepted — expired by inactivity,
    // revoked, or signed out elsewhere. The page cannot recover from it, and
    // showing its own error would leave somebody looking at an order they are
    // no longer signed in to. Sent back to sign-in instead.
    //
    // Still thrown afterwards, so the caller's own error handling runs and the
    // navigation is not raced by a component that thinks the call succeeded.
    if (res.status === 401) void handleSessionExpired();

    let message = res.statusText;
    try {
      const text = await res.text();
      message = text || message;
    } catch {
      // ignore body-read failures
    }
    throw new ApiError(message, res.status);
  }

  // Handle empty responses (e.g. 204)
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}