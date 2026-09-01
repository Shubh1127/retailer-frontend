/**
 * The two pages a retailer manages trade accounts from.
 *
 * What is pinned here is mostly about lists: which suppliers appear, how many
 * times Barry appears, and that a returning retailer is not dragged back
 * through a flow they finished. The visual layout is not tested and could not
 * be — jsdom applies no Tailwind — but "the wrong number of Barry cards" is a
 * structural fact, not a visual one, and it is the failure that would put one
 * password in two places.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/dashboard",
}));

const { listMock, onboardingMock, testMock, disconnectMock, connectMock, rulesMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    onboardingMock: vi.fn(),
    testMock: vi.fn(),
    disconnectMock: vi.fn(),
    connectMock: vi.fn(),
    rulesMock: vi.fn(),
  }),
);

vi.mock("@/lib/api/supplierCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/supplierCredentials")>();
  return {
    ...actual,
    listSupplierCredentials: listMock,
    getOnboardingState: onboardingMock,
    testSupplierConnection: testMock,
    disconnectSupplier: disconnectMock,
    connectSupplier: connectMock,
  };
});

vi.mock("@/lib/api/suppliers", () => ({ getSupplierConnections: rulesMock }));

// AppShell pulls in the whole nav, /api/me and the theme. None of it is what
// these tests are about.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const SuppliersPage = (await import("./page")).default;
const GetStartedPage = (await import("../get-started/page")).default;
const FirstLoginRedirect = (await import("@/components/FirstLoginRedirect")).default;

import type { SupplierCredential } from "@/lib/api/supplierCredentials";

const CONNECTABLE = [
  { supplierId: "musgrave", name: "Musgrave" },
  { supplierId: "oreilly", name: "O'Reilly" },
  { supplierId: "barrygroup", name: "Barry Group" },
  { supplierId: "kadona", name: "Kadona Wholesale" },
];

const credential = (over: Partial<SupplierCredential> = {}): SupplierCredential => ({
  supplierId: "musgrave",
  username: "shop@example.com",
  authMethod: "credentials",
  secretSet: true,
  secretUnreadable: false,
  status: "verified",
  lastVerifiedAt: "2026-08-30T10:00:00.000Z",
  ...over,
});

/** Buying rules DO list Barry twice — two baskets, two sets of terms. */
const RULES = [
  { supplierId: "musgrave", name: "Musgrave", isMain: true, channel: "webview-cart", thresholdPct: 0.1, minOrderValue: 0, deliveryFee: 0, capabilities: { search: true, cart: true, catalogue: true }, account: {} },
  { supplierId: "barrygroup-ambient", name: "Barry Group · Ambient", isMain: false, channel: "webview-cart", thresholdPct: 0.13, minOrderValue: 0, deliveryFee: 0, capabilities: { search: true, cart: true, catalogue: true }, account: {} },
  { supplierId: "barrygroup-chill", name: "Barry Group · Chill", isMain: false, channel: "webview-cart", thresholdPct: 0.13, minOrderValue: 0, deliveryFee: 0, capabilities: { search: true, cart: true, catalogue: true }, account: {} },
];

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  listMock.mockReset().mockResolvedValue([]);
  testMock.mockReset().mockResolvedValue({ ok: true });
  disconnectMock.mockReset().mockResolvedValue(undefined);
  connectMock.mockReset().mockResolvedValue(credential());
  rulesMock.mockReset().mockResolvedValue(RULES as never);
  onboardingMock.mockReset().mockResolvedValue({
    firstLogin: false,
    hasConnectedSuppliers: false,
    connectedCount: 0,
    connectable: CONNECTABLE,
  });
  try {
    window.sessionStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("Get Started", () => {
  it("offers every connectable supplier the backend named", async () => {
    render(<GetStartedPage />);
    await waitFor(() => expect(screen.getByText("Musgrave")).toBeTruthy());

    for (const supplier of CONNECTABLE) {
      expect(screen.getByText(supplier.name)).toBeTruthy();
    }
  });

  it("shows Barry Group ONCE — one login, not two baskets", async () => {
    render(<GetStartedPage />);
    await waitFor(() => expect(screen.getByText("Barry Group")).toBeTruthy());

    expect(screen.getAllByText(/^Barry Group$/)).toHaveLength(1);
    expect(screen.queryByText(/ambient/i)).toBeNull();
    expect(screen.queryByText(/chill/i)).toBeNull();
  });

  it("will not let a retailer continue with nothing connected", async () => {
    render(<GetStartedPage />);
    await waitFor(() => expect(screen.getByText("Musgrave")).toBeTruthy());

    const button = screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("unlocks Continue once ONE account is connected — the rest are optional", async () => {
    listMock.mockResolvedValue([credential()]);
    render(<GetStartedPage />);
    await waitFor(() => expect(screen.getByText("Musgrave")).toBeTruthy());

    expect((screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByText(/1 account connected/i)).toBeTruthy();
  });

  it("always offers a way out, so onboarding is never a trap", async () => {
    render(<GetStartedPage />);
    await waitFor(() => expect(screen.getByText("Musgrave")).toBeTruthy());

    expect(screen.getByRole("link", { name: /manage suppliers/i }).getAttribute("href")).toBe(
      "/suppliers",
    );
  });

  it("does not test any supplier on load", async () => {
    listMock.mockResolvedValue([credential()]);
    render(<GetStartedPage />);
    await waitFor(() => expect(screen.getByText("Musgrave")).toBeTruthy());

    // Four real logins on every page view is how trade accounts get locked.
    expect(testMock).not.toHaveBeenCalled();
  });

  it("reports a load failure with a way to retry", async () => {
    onboardingMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<GetStartedPage />);

    expect(await screen.findByText(/could not load your account setup/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});

describe("Suppliers page", () => {
  it("lists one trade account per LOGIN and Barry only once", async () => {
    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Trade accounts")).toBeTruthy());

    const accounts = screen.getByText("Trade accounts").parentElement!;
    // Barry appears once as an account…
    expect(within(accounts).getAllByText(/^Barry Group$/)).toHaveLength(1);
  });

  it("still shows both Barry baskets under buying rules", async () => {
    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Buying rules")).toBeTruthy());

    // …and twice as commercial suppliers, which is the honest split.
    expect(screen.getByText("Barry Group · Ambient")).toBeTruthy();
    expect(screen.getByText("Barry Group · Chill")).toBeTruthy();
  });

  it("shows Connect for an unconnected supplier and no destructive actions", async () => {
    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Trade accounts")).toBeTruthy());

    expect(screen.getAllByRole("button", { name: /^connect$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /test connection/i })).toBeNull();
  });

  it("shows Update password, Test and Disconnect once connected", async () => {
    listMock.mockResolvedValue([credential()]);
    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Trade accounts")).toBeTruthy());

    expect(screen.getByRole("button", { name: /update password/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /test connection/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
  });

  it("shows the account name and the last verified time, never a password", async () => {
    listMock.mockResolvedValue([credential()]);
    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("shop@example.com")).toBeTruthy());

    expect(screen.getByText(/verified/i)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/password.*[:=]\s*\S{6,}/i);
  });

  it("tests only when asked, and reports the supplier's own refusal", async () => {
    listMock.mockResolvedValue([credential()]);
    testMock.mockResolvedValue({ ok: false, error: "Account locked" });

    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Trade accounts")).toBeTruthy());
    expect(testMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    expect(await screen.findByText(/Account locked/)).toBeTruthy();
  });

  it("confirms before disconnecting, because it stops real orders", async () => {
    listMock.mockResolvedValue([credential()]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Trade accounts")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(confirm).toHaveBeenCalled();
    expect(disconnectMock).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("removes the account when the retailer confirms", async () => {
    listMock.mockResolvedValue([credential()]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Trade accounts")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() => expect(disconnectMock).toHaveBeenCalledWith("musgrave"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull(),
    );
    confirm.mockRestore();
  });

  it("blames the server, not the retailer, for an unreadable secret", async () => {
    listMock.mockResolvedValue([credential({ secretUnreadable: true, status: "verified" })]);
    render(<SuppliersPage />);

    expect(await screen.findByText(/server configuration problem/i)).toBeTruthy();
    expect(screen.getByText(/not at fault/i)).toBeTruthy();
  });

  it("says the session expired on a 401 rather than 'could not load'", async () => {
    const { ApiError } = await import("@/lib/api/client");
    onboardingMock.mockRejectedValue(new ApiError("Sign in", 401));

    render(<SuppliersPage />);
    expect(await screen.findByText(/session has expired/i)).toBeTruthy();
  });
});

describe("first-login redirect", () => {
  it("sends a brand-new retailer with nothing connected to Get Started", async () => {
    onboardingMock.mockResolvedValue({
      userId: "user-1",
      firstLogin: true,
      hasConnectedSuppliers: false,
      connectedCount: 0,
      connectable: CONNECTABLE,
    });

    render(<FirstLoginRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"));
  });

  it("leaves a returning retailer alone", async () => {
    onboardingMock.mockResolvedValue({
      firstLogin: false,
      hasConnectedSuppliers: true,
      connectedCount: 2,
      connectable: CONNECTABLE,
    });

    render(<FirstLoginRedirect />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves a first-time retailer who already connected something", async () => {
    // They connected during this session; re-routing them the moment they
    // navigate would be a loop.
    onboardingMock.mockResolvedValue({
      firstLogin: true,
      hasConnectedSuppliers: true,
      connectedCount: 1,
      connectable: CONNECTABLE,
    });

    render(<FirstLoginRedirect />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends an EXISTING retailer with nothing connected, not just a new one", async () => {
    /**
     * The condition is "can they trade", not "is this their first visit". It
     * used to gate on `firstLogin`, which compared two timestamps written by
     * different statements and was false for everybody — so nobody was ever
     * sent here, including brand-new accounts.
     */
    onboardingMock.mockResolvedValue({
      firstLogin: false,
      hasConnectedSuppliers: false,
      connectedCount: 0,
      connectable: CONNECTABLE,
    });

    render(<FirstLoginRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"));
  });

  it("re-arms after the last supplier is disconnected", async () => {
    // Connected: the latch is cleared rather than set…
    onboardingMock.mockResolvedValue({
      firstLogin: false,
      hasConnectedSuppliers: true,
      connectedCount: 1,
      connectable: CONNECTABLE,
    });
    const connected = render(<FirstLoginRedirect />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
    connected.unmount();

    // …so disconnecting the last one surfaces the offer again this visit.
    onboardingMock.mockResolvedValue({
      firstLogin: false,
      hasConnectedSuppliers: false,
      connectedCount: 0,
      connectable: CONNECTABLE,
    });
    render(<FirstLoginRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"));
  });

  it("offers the flow only ONCE per visit", async () => {
    onboardingMock.mockResolvedValue({
      firstLogin: false,
      hasConnectedSuppliers: false,
      connectedCount: 0,
      connectable: CONNECTABLE,
    });

    const first = render(<FirstLoginRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    first.unmount();

    // A retailer who navigated away deliberately must be able to stay away.
    render(<FirstLoginRedirect />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the check fails", async () => {
    onboardingMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<FirstLoginRedirect />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("an administrator viewing Suppliers", () => {
  const asAdmin = {
    firstLogin: false,
    hasConnectedSuppliers: false,
    connectedCount: 0,
    role: "admin" as const,
    usesSharedAccounts: true,
    connectable: CONNECTABLE,
  };

  it("is not redirected into onboarding", async () => {
    onboardingMock.mockResolvedValue(asAdmin);

    render(<FirstLoginRedirect />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it("is not shown the Trade accounts section at all", async () => {
    onboardingMock.mockResolvedValue(asAdmin);
    listMock.mockResolvedValue([]);

    render(<SuppliersPage />);
    // Buying rules still render — the page is not empty for an admin.
    await waitFor(() => expect(screen.getByText("Buying rules")).toBeTruthy());

    // The whole section is about a retailer's OWN trade accounts, and an admin
    // has none. Showing it read-only was still showing it.
    expect(screen.queryByText("Trade accounts")).toBeNull();
    expect(screen.queryByText(/No account connected/i)).toBeNull();
  });

  it("is told where the accounts actually live", async () => {
    onboardingMock.mockResolvedValue(asAdmin);
    listMock.mockResolvedValue([]);

    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Buying rules")).toBeTruthy());

    expect(screen.getByText(/shared diagnostic accounts configured on the server/i)).toBeTruthy();
  });

  it("is offered NOTHING to connect, update or disconnect", async () => {
    onboardingMock.mockResolvedValue(asAdmin);
    listMock.mockResolvedValue([]);

    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Buying rules")).toBeTruthy());

    // None of these would be theirs to press — the accounts are configured on
    // the server and belong to nobody using this page.
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /update password/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
  });

  it("leaves the RETAILER view untouched", async () => {
    // The same page, for somebody who does connect their own accounts.
    onboardingMock.mockResolvedValue({
      ...asAdmin,
      role: "retailer",
      usesSharedAccounts: false,
    });
    listMock.mockResolvedValue([]);

    render(<SuppliersPage />);
    await waitFor(() => expect(screen.getByText("Trade accounts")).toBeTruthy());

    expect(screen.getAllByRole("button", { name: /^connect$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/shared diagnostic accounts configured/i)).toBeNull();
  });
});

describe("the onboarding latch belongs to a PERSON, not a tab", () => {
  /**
   * `sessionStorage` survives a sign-out. Keyed on the flow alone, a retailer
   * signing in after somebody else signed out in the same tab inherited their
   * latch and was silently never offered onboarding — which is exactly what a
   * brand-new account hits on a browser that has been used for testing.
   */
  const unconnected = (userId: string) => ({
    userId,
    firstLogin: false,
    hasConnectedSuppliers: false,
    connectedCount: 0,
    connectable: CONNECTABLE,
  });

  it("does not let one retailer's latch silence the next one's", async () => {
    // First retailer is offered the flow and navigates away.
    onboardingMock.mockResolvedValue(unconnected("user-a"));
    const first = render(<FirstLoginRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"));
    first.unmount();
    replace.mockReset();

    // Second retailer signs in on the same tab. Same storage, different person.
    onboardingMock.mockResolvedValue(unconnected("user-b"));
    render(<FirstLoginRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"));
  });

  it("still offers it only once to the SAME retailer", async () => {
    onboardingMock.mockResolvedValue(unconnected("user-a"));

    const first = render(<FirstLoginRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<FirstLoginRedirect />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("the onboarding check survives a session that is not ready yet", () => {
  /**
   * THE BUG THIS PINS.
   *
   * The check runs on mount, and the mount right after signing in can beat the
   * Supabase session into storage — `accessToken()` answers `undefined`, the
   * request goes out unauthenticated, and the backend returns 401. That was
   * swallowed by a silent catch and never retried, because the effect only
   * re-runs when the path changes. A brand-new retailer was never offered
   * onboarding, with nothing on screen or in the console to say why.
   */
  it("retries past an initial 401 and still redirects", async () => {
    const { ApiError } = await import("@/lib/api/client");

    onboardingMock
      .mockRejectedValueOnce(new ApiError("Sign in", 401))
      .mockResolvedValue({
        userId: "user-late",
        firstLogin: true,
        hasConnectedSuppliers: false,
        connectedCount: 0,
        connectable: CONNECTABLE,
      });

    render(<FirstLoginRedirect />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"), {
      timeout: 3000,
    });
    expect(onboardingMock).toHaveBeenCalledTimes(2);
  });

  it("gives up quietly rather than looping when it never succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onboardingMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<FirstLoginRedirect />);

    // Bounded attempts, then a line in the console — never a spinner, never a
    // redirect the retailer did not ask for.
    await waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 4000 });
    expect(replace).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
