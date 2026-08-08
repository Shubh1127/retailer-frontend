"use client";

/**
 * Light or dark, remembered.
 *
 * THREE STATES, NOT TWO
 *
 * "System" is a real choice and the right default: somebody whose laptop
 * switches at sunset expects this to follow, and until they express a preference
 * we have no business overriding the one they already set for everything else.
 * Only an explicit click is stored — so "system" is the ABSENCE of a stored
 * value, not a third value pretending to be one.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

export const THEME_KEY = "retailcompare.theme";

/** The script injected into <head>. See the note in the layout for why. */
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_KEY}');
    var dark = stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** What the user chose, or "system" when they never have. */
export function readChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function resolve(choice: ThemeChoice): Resolved {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

export function applyTheme(resolved: Resolved): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

/**
 * Store a choice and apply it.
 *
 * Choosing "system" REMOVES the key rather than writing "system" — otherwise
 * "follow the system" and "never asked" would be indistinguishable, and the
 * no-flash script above would need to understand a third value.
 */
export function setChoice(choice: ThemeChoice): Resolved {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private browsing can refuse storage. The theme still applies for this
    // page; it simply will not be remembered.
  }

  const resolved = resolve(choice);
  applyTheme(resolved);
  return resolved;
}
