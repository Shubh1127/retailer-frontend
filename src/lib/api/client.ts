import { env } from "./env";
import { accessToken } from "../supabase";

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
}

/**
 * Thin wrapper around fetch that:
 *  - resolves paths against env.apiBaseUrl
 *  - serializes query params
 *  - throws ApiError on non-2xx responses
 *  - parses JSON responses
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, body, headers, ...init } = options;

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