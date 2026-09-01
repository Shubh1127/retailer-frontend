"use client";

/**
 * A password field with a reveal toggle.
 *
 * SHARED, because this control existed once on the sign-in form and was about
 * to exist again on the supplier connect form. Two copies of a control whose
 * details matter — a button that must not submit, a label that must change with
 * its state, a glyph that must not swap shape — is two chances to get one of
 * them wrong, and the wrong one is the one nobody is looking at.
 *
 * WHY REVEAL AT ALL. A wholesale password is typed from a note or a browser's
 * saved list, into an app that will use it against somebody else's site. When it
 * is wrong the failure arrives from the wholesaler minutes later and says only
 * "sign-in refused" — so being able to check the characters before pressing
 * Connect is the difference between one attempt and three, on an account that
 * locks.
 *
 * IT STILL STARTS HIDDEN, and nothing here remembers the choice. The reveal is
 * for the moment of typing; carrying it across fields or across visits would
 * leave a password on screen in a shop somebody else can walk through.
 */

import { useState } from "react";

export default function PasswordInput({
  id,
  value,
  onChange,
  disabled,
  required,
  placeholder,
  autoComplete = "new-password",
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  /**
   * Defaults to `new-password`, which is right nearly everywhere here: a
   * browser must not offer THIS app's password when the field is asking for a
   * wholesaler's. The sign-in form passes `current-password`.
   */
  autoComplete?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      {/* `pr-10` keeps the typed characters clear of the button. Revealed, a
          long password would otherwise run straight underneath it. */}
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled ?? false}
        required={required ?? false}
        autoComplete={autoComplete}
        {...(placeholder ? { placeholder } : {})}
        className={`w-full rounded-md border border-line bg-surface px-3 py-2 pr-10 text-[14px] text-ink placeholder:text-ink-faint focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50 ${className}`}
      />

      {/* THE ICON IS A BUTTON, AND IT SAYS WHAT IT DOES.
       *
       * `type="button"` — inside a form, a button with no type is a SUBMIT
       * button, so revealing the password would post the form.
       *
       * `aria-pressed` plus a label that changes with the state, so a screen
       * reader gets "show password" / "hide password" rather than a nameless
       * control.
       *
       * `tabIndex={-1}` keeps it out of the tab order: Tab from the password
       * field should reach the submit button, not a decoration on the way.
       */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShown((current) => !current)}
        aria-pressed={shown}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
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
          {shown && <path d="m4 20 16-16" />}
        </svg>
      </button>
    </div>
  );
}
