"use client";

/**
 * Who the backend thinks you are.
 *
 * Deliberately not derived from the Supabase session. Supabase can tell this app
 * that somebody signed in; it cannot tell it whether this system regards them as
 * a retailer, an administrator, or an account that has been blocked. Only the
 * backend can, because only the backend reads the user directory — so the gate
 * asks it rather than guessing from a token it happens to hold.
 */

import { env } from "./env";
import { accessToken } from "../supabase";

export interface Me {
  id: string;
  email?: string;
  role: "retailer" | "admin";
  /** From the retailer's own EPOS uploads. Absent until they have uploaded one. */
  storeName?: string;
  lastLoginAt?: string;
}

export interface MeResponse {
  user: Me;
}

export class MeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MeError";
  }
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await accessToken();
  if (!token) throw new MeError(401, "Sign in to continue");

  let res: Response;
  try {
    res = await fetch(new URL(path, env.apiBaseUrl).toString(), {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    throw new MeError(
      0,
      `Could not reach the backend: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const text = await res.text();

  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* the raw text is the best we have */
    }
    throw new MeError(res.status, message);
  }

  return (text ? JSON.parse(text) : undefined) as T;
}

/** Identity only — what the gate checks. */
export async function whoAmI(): Promise<Me> {
  return (await call<MeResponse>("/api/me")).user;
}

/** Identity plus store and location — what the app shell renders. */
export async function getMe(): Promise<MeResponse> {
  return await call<MeResponse>("/api/me");
}

/** What this retailer saved over a recent window. */
export interface MeStats {
  /** Length of the window, in days. */
  days: number;
  since: string;
  /** Jobs uploaded inside the window. Zero means there is nothing to report. */
  jobs: number;
  lines: number;
  /** Ex-VAT, summed over cases. Only genuine savings count. */
  savings: number;
  /** What those lines would have cost at the retailer's own current prices. */
  baselineSpend: number;
  /**
   * Savings as a share of that spend. NULL when no line carried a baseline —
   * distinct from 0, which would claim we compared and found nothing.
   */
  savingsPct: number | null;
  /** Suppliers actually integrated, from the backend's live roster. */
  suppliers: number;
}

export async function getMyStats(): Promise<MeStats> {
  return await call<MeStats>("/api/me/stats");
}


