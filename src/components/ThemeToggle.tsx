"use client";

/**
 * Light / dark / system.
 *
 * Rendered as a single button that cycles, rather than a menu: it is chrome, it
 * is used rarely, and a dropdown for three values costs more room in the header
 * than the feature is worth. The title attribute names the current state so the
 * cycle is not a guess.
 */

import { useEffect, useState } from "react";
import {
  applyTheme,
  readChoice,
  resolve,
  setChoice,
  type ThemeChoice,
} from "@/lib/theme";

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<ThemeChoice, string> = {
  system: "Theme: follows your system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export default function ThemeToggle({ className }: { className?: string }) {
  // Starts as "system" on both server and client so the first render matches
  // the server's HTML. The real value is read in the effect below — reading
  // localStorage during render would make the markup differ and React would
  // complain about the mismatch.
  const [choice, setLocalChoice] = useState<ThemeChoice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLocalChoice(readChoice());
    setMounted(true);
  }, []);

  // While the choice is "system", follow the system as it changes — someone on
  // an automatic schedule should see this switch with everything else, without
  // a reload.
  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(resolve("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  const cycle = () => {
    const next = NEXT[choice];
    setChoice(next);
    setLocalChoice(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={LABEL[choice]}
      aria-label={LABEL[choice]}
      className={
        className ??
        "flex h-8 w-8 items-center justify-center rounded-md text-ink-soft hover:bg-canvas hover:text-ink"
      }
    >
      {/* Until mounted, the icon is a placeholder — rendering the real one from
          an unknown choice would flicker on hydration. */}
      {!mounted ? (
        <SystemIcon />
      ) : choice === "light" ? (
        <SunIcon />
      ) : choice === "dark" ? (
        <MoonIcon />
      ) : (
        <SystemIcon />
      )}
    </button>
  );
}
