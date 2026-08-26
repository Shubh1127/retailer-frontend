import { redirect } from "next/navigation";

/**
 * The root path is not a page.
 *
 * There is no marketing site and no landing screen: this is an internal tool
 * for retailers who already have an account, so the only two states are
 * "signed in" and "signing in". Sending `/` straight to the dashboard collapses
 * that — AuthGate bounces a signed-out visitor to /login and carries `next`, so
 * they land back here once they are in.
 *
 * A redirect rather than a rendered page, so there is no flash of a screen
 * nobody is meant to see.
 */
export default function RootPage(): never {
  redirect("/dashboard");
}
