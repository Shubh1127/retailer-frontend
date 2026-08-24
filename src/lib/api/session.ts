/**
 * Telling the backend a session started or ended.
 *
 * Sign-in happens in the browser against Supabase, over a connection the API is
 * not part of — so the server cannot observe the moment a session begins, only
 * that one is in force by the time a request arrives. This is the app reporting
 * it, so an admin looking at an order can see who was signed in and when.
 *
 * BEST EFFORT, ALWAYS. Never throws and never blocks: a closed laptop reports
 * no sign-out, and a failed report must not stop somebody signing in or out.
 * An absent sign-out means "we did not hear", never "they are still working".
 */

import { apiFetch } from "./client";

export async function reportSession(event: "signed-in" | "signed-out"): Promise<void> {
  try {
    await apiFetch("/api/activity/session", { method: "POST", body: { event } });
  } catch {
    // Swallowed on purpose. Signing out must succeed whether or not anyone is
    // listening, and an audit gap is not the user's problem to solve.
  }
}
