"use client";

/**
 * The sign-in / sign-up form.
 *
 * One component, two callers: the `/login` page renders it on its own, and the
 * gate redirects to that page rather than drawing its own copy. There was
 * briefly a second form inside `AuthGate`, which is how a login screen ends up
 * with two different password rules and one of them wrong.
 */

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export type AuthMode = "sign-in" | "sign-up";

export default function SignInForm({
  initialMode = "sign-in",
  message,
  onSignedIn,
}: {
  initialMode?: AuthMode;
  /** Context for why the form is being shown, e.g. "Sign in to continue". */
  message?: string;
  onSignedIn: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "sign-up") {
        const { data, error: signUpError } = await supabase().auth.signUp({
          email,
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        // With email confirmation switched on, Supabase returns a user but no
        // session. Saying so beats a silent no-op that reads as a failure.
        if (!data.session) {
          setNotice("Check your email to confirm the account, then sign in.");
          setMode("sign-in");
          return;
        }
        onSignedIn();
        return;
      }

      const { error: signInError } = await supabase().auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        // Supabase is deliberately vague about WHICH half was wrong. Passing it
        // through keeps it that way, which is correct — a more helpful message
        // here is a gift to whoever is guessing.
        setError(signInError.message);
        return;
      }
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-card"
    >
      <h1 className="text-[16px] font-semibold text-ink">
        {mode === "sign-in" ? "Sign in" : "Create your account"}
      </h1>
      <p className="mt-1 text-[12.5px] text-ink-soft">
        {mode === "sign-in"
          ? "Upload your order list and compare it across every supplier."
          : "Takes a moment. You will be comparing prices straight after."}
      </p>

      {message && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          {message}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          {notice}
        </div>
      )}

      <label className="mt-4 block text-[12.5px] text-ink-soft">
        Email
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink"
        />
      </label>

      <label className="mt-3 block text-[12.5px] text-ink-soft">
        Password
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink"
        />
      </label>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isBusy}
        className="mt-4 w-full rounded-md bg-teal-500 px-3 py-2 text-[13px] font-medium text-white hover:bg-teal-600 disabled:opacity-50"
      >
        {isBusy
          ? mode === "sign-in"
            ? "Signing in…"
            : "Creating…"
          : mode === "sign-in"
            ? "Sign in"
            : "Create account"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
          setNotice(null);
        }}
        className="mt-3 w-full text-center text-[12.5px] text-ink-soft hover:text-ink"
      >
        {mode === "sign-in"
          ? "Need an account? Create one"
          : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
