"use client";

/**
 * Supabase Auth client — sign-in only.
 *
 * THE ANON KEY, NEVER THE SERVICE ROLE KEY. The service role key bypasses RLS
 * entirely; anything shipped to a browser is public, so putting it here would
 * hand every visitor unrestricted database access. It stays in the backend.
 *
 * This client does exactly one thing: prove who the retailer is, and hand the
 * resulting token to our own API. It never reads or writes product data
 * directly — every such call goes through the backend, which holds the service
 * role key and decides what this person may see.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

/** True when the app is configured enough to attempt a sign-in. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function supabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, then rebuild. NEXT_PUBLIC_* values are " +
        "baked in at build time, so setting them afterwards has no effect.",
    );
  }

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        // A retailer watching a 2000-product job must not be signed out by a
        // page refresh, and the token must renew itself while they wait.
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  return client;
}

/** The current access token, or undefined when signed out. */
export async function accessToken(): Promise<string | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token;
}

/**
 * The token, or a thrown error.
 *
 * Used by callers that cannot do anything useful signed out — every API call.
 * Returning undefined there just moves the failure to a confusing 401 later.
 */
export async function requireAccessToken(): Promise<string> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in to continue");
  return token;
}
