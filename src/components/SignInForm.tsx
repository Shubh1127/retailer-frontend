"use client";

/**
 * The sign-in / sign-up form.
 *
 * One component, two callers: the `/login` page renders it on its own, and the
 * gate redirects to that page rather than drawing its own copy. There was
 * briefly a second form inside `AuthGate`, which is how a login screen ends up
 * with two different password rules and one of them wrong.
 *
 * SIGNING UP IS THREE STEPS, NOT ONE
 *
 * This system reads live prices from the shop's own logged-in trade accounts,
 * so an account here is a share of a real supplier relationship and somebody
 * has to say yes first. `supabase.auth.signUp()` is no longer called from the
 * browser at all:
 *
 *   1. email      → POST /api/signup/requests, which returns a claim token
 *   2. waiting    → poll until an administrator decides
 *   3. password   → POST …/complete, which is what finally creates the account
 *
 * The password is collected LAST on purpose. Taken up front it would have to be
 * held somewhere between the request and the approval, and there is no good
 * answer to where.
 *
 * Signing IN is untouched — one step, straight to Supabase.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { reportSession } from "@/lib/api/session";
import { supabase } from "@/lib/supabase";
import {
  accountRequestStatus,
  completeAccount,
  forgetClaimToken,
  requestAccount,
  SignupError,
  storedClaimToken,
  type SignupStatus,
} from "@/lib/api/signup";
import { PASSWORD_RULES, passwordMeetsPolicy } from "@/lib/password-policy";

export type AuthMode = "sign-in" | "sign-up";

/** How often the waiting screen asks. */
const POLL_MS = 10_000;

type Stage = "email" | "waiting" | "password";

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
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<SignupStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const clearMessages = () => {
    setError(null);
    setErrorDetails(null);
    setNotice(null);
  };

  const showError = (err: unknown, fallback: string) => {
    if (err instanceof SignupError) {
      setError(err.message);
      setErrorDetails(err.messages ?? null);
      return;
    }
    setError(err instanceof Error ? err.message : fallback);
    setErrorDetails(null);
  };

  // A request already in flight from an earlier visit. Picked up on mount so
  // closing the tab while waiting for approval is not the same as starting
  // over — the token outlives the page, so the flow should too.
  useEffect(() => {
    const existing = storedClaimToken();
    if (!existing) return;
    setClaimToken(existing);
    setMode("sign-up");
    setStage("waiting");
  }, []);

  const checkStatus = useCallback(
    async (token: string) => {
      try {
        const request = await accountRequestStatus(token);
        setRequestStatus(request.status);
        setLastChecked(new Date());
        if (request.email) setEmail(request.email);

        if (request.status === "approved") {
          setStage("password");
          clearMessages();
        }
      } catch (err) {
        // A token the server does not recognise is spent, expired, or from a
        // database that has been reset. Clearing it returns the person to a
        // form that can actually get them somewhere, rather than a waiting
        // screen that will never advance.
        if (err instanceof SignupError && (err.status === 404 || err.status === 410)) {
          forgetClaimToken();
          setClaimToken(null);
          setStage("email");
          setRequestStatus(null);
          setError("That request is no longer valid. Please ask again.");
          return;
        }
        // Anything else — the backend restarting, a flaky connection — is not
        // worth interrupting a waiting screen for. The next poll retries.
      }
    },
    [],
  );

  // Poll while waiting. Cleared on unmount and whenever the stage moves on, so
  // a completed flow cannot leave a timer running against a dead component.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (stage !== "waiting" || !claimToken) return;

    void checkStatus(claimToken);
    pollRef.current = setInterval(() => void checkStatus(claimToken), POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [stage, claimToken, checkStatus]);

  // ---- Actions -------------------------------------------------------------

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    clearMessages();

    try {
      const { claimToken: token, request } = await requestAccount(email);
      setClaimToken(token);
      setRequestStatus(request.status);
      setStage("waiting");
    } catch (err) {
      showError(err, "Could not send the request");
    } finally {
      setIsBusy(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!claimToken) return;

    setIsBusy(true);
    clearMessages();

    try {
      await completeAccount(claimToken, password);

      // The account exists now. Signing in with the password just chosen keeps
      // session creation in Supabase's hands, exactly as it is for everyone
      // else — the backend never issues a session of its own.
      const { error: signInError } = await supabase().auth.signInWithPassword({
        email,
        password,
      });

      // Reported after the credential is accepted, so a failed attempt is not
      // recorded as a session.
      if (!signInError) void reportSession("signed-in");

      forgetClaimToken();

      if (signInError) {
        setNotice("Your account is ready. Sign in to continue.");
        setMode("sign-in");
        setStage("email");
        setPassword("");
        return;
      }

      onSignedIn();
    } catch (err) {
      showError(err, "Could not create the account");
    } finally {
      setIsBusy(false);
    }
  };

  const submitSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    clearMessages();

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

  const startOver = () => {
    forgetClaimToken();
    setClaimToken(null);
    setRequestStatus(null);
    setStage("email");
    setPassword("");
    clearMessages();
  };

  // ---- Copy ----------------------------------------------------------------

  const heading =
    mode === "sign-in"
      ? "Sign in"
      : stage === "email"
        ? "Request an account"
        : stage === "waiting"
          ? "Waiting for approval"
          : "Choose a password";

  const subheading =
    mode === "sign-in"
      ? "Upload your order list and compare it across every supplier."
      : stage === "email"
        ? "Accounts are approved by an administrator. Start with your email address."
        : stage === "waiting"
          ? "An administrator has been notified. You can leave this page open."
          : "Your request was approved. Set a password to finish.";

  return (
    <form
      onSubmit={
        mode === "sign-in"
          ? submitSignIn
          : stage === "password"
            ? submitPassword
            : submitEmail
      }
      className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-card"
    >
      <h1 className="text-[16px] font-semibold text-ink">{heading}</h1>
      <p className="mt-1 text-[12.5px] text-ink-soft">{subheading}</p>

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

      {/* ---- Waiting for an administrator ---- */}
      {mode === "sign-up" && stage === "waiting" && (
        <WaitingPanel
          email={email}
          status={requestStatus}
          lastChecked={lastChecked}
          onCheckNow={() => claimToken && void checkStatus(claimToken)}
          onStartOver={startOver}
        />
      )}

      {/* ---- Email ---- */}
      {(mode === "sign-in" || stage === "email") && (
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
      )}

      {/* ---- Password ---- */}
      {(mode === "sign-in" || stage === "password") && (
        <>
          {mode === "sign-up" && (
            <p className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink-soft">
              Creating the account for <span className="font-medium text-ink">{email}</span>
            </p>
          )}
          <label className="mt-3 block text-[12.5px] text-ink-soft">
            Password
            <input
              type="password"
              required
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink"
            />
          </label>

          {/* The checklist only appears where it can help. On sign-in the rules
              are whatever the account was created with, and showing them there
              would read as a complaint about a password that is already correct. */}
          {mode === "sign-up" && <PasswordChecklist password={password} />}
        </>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          {error}
          {errorDetails && errorDetails.length > 0 && (
            <ul className="mt-1.5 list-disc pl-4">
              {errorDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The waiting screen has no submit — there is nothing for the person to
          do, and a disabled button implies otherwise. */}
      {!(mode === "sign-up" && stage === "waiting") && (
        <button
          type="submit"
          disabled={
            isBusy || (mode === "sign-up" && stage === "password" && !passwordMeetsPolicy(password))
          }
          className="mt-4 w-full rounded-md bg-teal-500 px-3 py-2 text-[13px] font-medium text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {isBusy
            ? mode === "sign-in"
              ? "Signing in…"
              : stage === "password"
                ? "Creating…"
                : "Sending…"
            : mode === "sign-in"
              ? "Sign in"
              : stage === "password"
                ? "Create account"
                : "Request an account"}
        </button>
      )}

      {stage !== "password" && (
        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setStage("email");
            clearMessages();
          }}
          className="mt-3 w-full text-center text-[12.5px] text-ink-soft hover:text-ink"
        >
          {mode === "sign-in"
            ? "Need an account? Request one"
            : "Already have an account? Sign in"}
        </button>
      )}
    </form>
  );
}

/** The holding screen between asking and being answered. */
function WaitingPanel({
  email,
  status,
  lastChecked,
  onCheckNow,
  onStartOver,
}: {
  email: string;
  status: SignupStatus | null;
  lastChecked: Date | null;
  onCheckNow: () => void;
  onStartOver: () => void;
}) {
  if (status === "rejected") {
    return (
      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-[12.5px] text-red-700">
        <p className="font-medium">This request was not approved.</p>
        <p className="mt-1">
          Contact whoever manages your account if you think that is wrong.
        </p>
        <button
          type="button"
          onClick={onStartOver}
          className="mt-2 text-[12.5px] font-medium underline"
        >
          Start again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12.5px] text-amber-900">
      <div className="flex items-center gap-2">
        {/* Motion is the whole message here: something is still happening. */}
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <p className="font-medium">Waiting for an administrator to approve {email || "your request"}</p>
      </div>

      <p className="mt-2">
        This page checks every few seconds and will move on by itself. You can
        close it and come back — the request is remembered in this browser.
      </p>

      {/* Shown to EVERYONE waiting, never only to addresses that turn out to be
          registered. Someone who already has an account and forgot ends up on
          exactly this screen, and this is the line that rescues them — but the
          moment it appears conditionally it becomes a way to ask the server
          which addresses exist. */}
      <p className="mt-1.5">
        Already signed up before? You may already have an account — try signing
        in instead.
      </p>

      <div className="mt-2.5 flex items-center gap-3">
        <button
          type="button"
          onClick={onCheckNow}
          className="rounded-md border border-amber-300 bg-white/60 px-2.5 py-1 text-[12px] font-medium text-amber-900 hover:bg-white"
        >
          Check now
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="text-[12px] text-amber-800 underline hover:text-amber-900"
        >
          Use a different email
        </button>
        {lastChecked && (
          <span className="ml-auto text-[11px] text-amber-700">
            checked {lastChecked.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The rules, ticking off as they are met.
 *
 * Every rule is listed from the start rather than appearing as it fails, so the
 * target is visible before the first keystroke instead of the box growing
 * accusations as someone types.
 */
function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-2 space-y-1">
      {PASSWORD_RULES.map(({ rule, label, test }) => {
        const met = test(password);
        return (
          <li
            key={rule}
            className={`flex items-center gap-1.5 text-[11.5px] ${
              met ? "text-emerald-700" : "text-ink-faint"
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border text-[8px] ${
                met
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-line text-transparent"
              }`}
            >
              ✓
            </span>
            {label}
            <span className="sr-only">{met ? " — met" : " — not yet met"}</span>
          </li>
        );
      })}
    </ul>
  );
}
