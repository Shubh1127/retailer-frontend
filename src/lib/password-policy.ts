/**
 * Password rules, for the live checklist under the password box.
 *
 * THIS IS A COPY, AND IT DOES NOT DECIDE ANYTHING.
 * `backend/src/services/passwordPolicy.ts` is the authority and re-checks every
 * password it is sent. This file exists so someone typing can see which rules
 * they have met without a round trip — a browser check is a courtesy to a
 * cooperative user and no obstacle whatsoever to anyone posting at the API.
 *
 * Kept deliberately identical to the backend's, including the regexes. If the
 * two ever disagree the backend wins, and the visible symptom is a checklist
 * that goes all-green and then the request fails — which is why they are worth
 * keeping in step.
 */

export type PasswordRule = "length" | "uppercase" | "number" | "special";

export const MIN_PASSWORD_LENGTH = 8;

/** Anything that is not a letter, a digit, or whitespace. */
const SPECIAL = /[^A-Za-z0-9\s]/;

export const PASSWORD_RULES: {
  rule: PasswordRule;
  label: string;
  test: (value: string) => boolean;
}[] = [
  {
    rule: "length",
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (value) => value.length >= MIN_PASSWORD_LENGTH,
  },
  {
    rule: "uppercase",
    label: "One capital letter",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    rule: "number",
    label: "One number",
    test: (value) => /[0-9]/.test(value),
  },
  {
    rule: "special",
    label: "One special character",
    test: (value) => SPECIAL.test(value),
  },
];

export function passwordMeetsPolicy(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
