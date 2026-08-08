import { apiFetch } from "./client";
import type { CompareSearchResponse } from "./types";

/**
 * GET /api/compare/search?q=<query>
 *
 * Pass an AbortSignal so callers (e.g. a debounced search box) can cancel
 * in-flight requests when the query changes again.
 */
export function searchCompare(
  query: string,
  signal?: AbortSignal
): Promise<CompareSearchResponse> {
  return apiFetch<CompareSearchResponse>("/api/compare/search", {
    params: { q: query },
    signal,
  });
}