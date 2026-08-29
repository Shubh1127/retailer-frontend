"use client";

/**
 * The sign-in form. Sign-in only.
 *
 * THERE IS NO WAY TO GET AN ACCOUNT FROM HERE, AND THAT IS THE POINT.
 *
 * This system reads live prices from the shop's own logged-in trade accounts,
 * so an account here is a share of a real supplier relationship. It used to be
 * self-service — request by email, wait for approval, choose a password — which
 * left a public endpoint anybody could pile requests into and an approval queue
 * somebody had to watch. Accounts are now created by an administrator, who sets
 * the email and the password directly and hands them over.
 *
 * So this component has one job and one path. No mode switch, no stage machine,
 * no polling: if you are here without credentials, the answer is to ask an
 * administrator, and the form says so rather than offering a button that starts
 * a process nobody monitors.
 *
 * Sessions still come from Supabase. The backend never issues one of its own.
 */

import { useState } from "react";
import { reportSession } from "@/lib/api/session";
import { supabase } from "@/lib/supabase";

export default function SignInForm({
  message,
  onSignedIn,
}: {
  /** Context for why the form is being shown, e.g. "Sign in to continue". */
  message?: string;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  /**
   * Revealed only while the person asks for it, and never remembered.
   *
   * A typo in a password nobody can see is indistinguishable from a wrong
   * password, and the field is where a phone's autocorrect and a shared
   * keyboard layout do their worst. This is the standard fix.
   *
   * Local to the component and reset on every mount: it must not survive a
   * sign-out, and nothing about it belongs in storage.
   */
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);

    try {
      const { error: signInError } = await supabase().auth.signInWithPassword({
        email,
        password,
      });

      // Reported after the credential is accepted, so a failed attempt is not
      // recorded as a session.
      if (!signInError) void reportSession("signed-in");
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
    <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-card">
      <h1 className="text-[18px] font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1 text-[13px] text-ink-soft">
        Upload your order list and compare it across every supplier.
      </p>

      {message && (
        <p className="mt-4 rounded-md bg-canvas px-3 py-2 text-[12.5px] text-ink-soft">
          {message}
        </p>
      )}

      <form onSubmit={submit} className="mt-5 space-y-3">
        <div>
          <label
            htmlFor="signin-email"
            className="block text-[12px] font-medium text-ink-soft"
          >
            Email
          </label>
          <input
            id="signin-email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13.5px] text-ink focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        <div>
          <label
            htmlFor="signin-password"
            className="block text-[12px] font-medium text-ink-soft"
          >
            Password
          </label>
          <div className="relative mt-1">
            {/* `pr-10` keeps the typed characters clear of the button.
                Revealed, a long password runs straight underneath it. */}
            <input
              id="signin-password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 pr-10 text-[13.5px] text-ink focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />

            {/* THE ICON IS A BUTTON, AND IT SAYS WHAT IT DOES.

                `aria-pressed` plus a label that changes with the state, so a screen
                reader gets "show password" / "hide password" rather than a nameless
                control.

                `type="button"` — inside a form, a button with no type is a SUBMIT
                button, so revealing the password would post the form.

                `tabIndex={-1}` keeps it out of the tab order: Tab from the password
                field should reach Sign in, not a decoration on the way. */}
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((shown) => !shown)}
              aria-pressed={showPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:text-ink-soft"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                <circle cx="12" cy="12" r="3" />
                {/* A struck-through eye means "hidden". The eye stays put and gains a
                    line rather than swapping to a different glyph — a control should
                    not change shape the moment somebody uses it. */}
                {showPassword && <path d="m4 20 16-16" />}
              </svg>
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={isBusy || !email || !password}
          className="w-full rounded-md bg-teal-600 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isBusy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* A statement, not a link. There is nothing to click, because there is
          no self-service route to an account — saying so is more useful than
          leaving people hunting for a button that does not exist. */}
      <p className="mt-5 border-t border-line pt-4 text-[12px] text-ink-faint">
        Accounts are created by an administrator. If you need access, or have
        forgotten your password, contact them.
      </p>
    </div>
  );
}
