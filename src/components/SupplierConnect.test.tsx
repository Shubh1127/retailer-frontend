/**
 * Connecting a trade account, from the retailer's side.
 *
 * The load-bearing assertions are about what must NOT happen: a password must
 * not survive the submit, must not reach the DOM, must not reach storage, and a
 * button must not be pressable twice into two credential writes. Everything
 * else on this screen is recoverable; those are not.
 *
 * jsdom applies no Tailwind, so layout is not tested and could not be. What IS
 * pinned is behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { connectMock, testMock, disconnectMock, listMock, onboardingMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  testMock: vi.fn(),
  disconnectMock: vi.fn(),
  listMock: vi.fn(),
  onboardingMock: vi.fn(),
}));

vi.mock("@/lib/api/supplierCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/supplierCredentials")>();
  return {
    ...actual,
    connectSupplier: connectMock,
    testSupplierConnection: testMock,
    disconnectSupplier: disconnectMock,
    listSupplierCredentials: listMock,
    getOnboardingState: onboardingMock,
  };
});

const SupplierConnectForm = (await import("./SupplierConnectForm")).default;
const { credentialStatus } = await import("./SupplierConnectForm");
const { useSupplierGate, SupplierGateModal } = await import("./SupplierGate");

import { ApiError } from "@/lib/api/client";
import type { SupplierCredential } from "@/lib/api/supplierCredentials";

const SAVED: SupplierCredential = {
  supplierId: "musgrave",
  username: "shop@example.com",
  authMethod: "credentials",
  secretSet: true,
  secretUnreadable: false,
  status: "unverified",
};

const PASSWORD = "wholesale-p@ssw0rd";

beforeEach(() => {
  connectMock.mockReset().mockResolvedValue(SAVED);
  testMock.mockReset().mockResolvedValue({ ok: true, connection: { ...SAVED, status: "verified" } });
  disconnectMock.mockReset().mockResolvedValue(undefined);
  listMock.mockReset().mockResolvedValue([]);
  onboardingMock.mockReset().mockResolvedValue({
    firstLogin: true,
    hasConnectedSuppliers: false,
    connectedCount: 0,
    connectable: [{ supplierId: "musgrave", name: "Musgrave" }],
  });
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

afterEach(cleanup);

function drawForm(props: Partial<React.ComponentProps<typeof SupplierConnectForm>> = {}) {
  const onConnected = vi.fn();
  render(
    <SupplierConnectForm
      supplierId="musgrave"
      supplierName="Musgrave"
      onConnected={onConnected}
      {...props}
    />,
  );
  return { onConnected };
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

// ---------------------------------------------------------------------------

describe("connecting a supplier", () => {
  it("saves, then runs exactly ONE test", async () => {
    const { onConnected } = drawForm();

    type(/account email or username/i, "shop@example.com");
    type(/^password$/i, PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => expect(onConnected).toHaveBeenCalled());

    expect(connectMock).toHaveBeenCalledWith("musgrave", "shop@example.com", PASSWORD);
    // Saving is not proving — but one test runs right after, because that is
    // the moment somebody wants to know.
    expect(testMock).toHaveBeenCalledTimes(1);
    expect(onConnected.mock.calls[0]![0].tested.ok).toBe(true);
  });

  it("reports a refused sign-in without treating it as a crash", async () => {
    testMock.mockResolvedValue({ ok: false, error: "Invalid username or password" });
    const { onConnected } = drawForm();

    type(/account email or username/i, "shop@example.com");
    type(/^password$/i, "wrong");
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    const outcome = onConnected.mock.calls[0]![0];
    expect(outcome.tested.ok).toBe(false);
    expect(outcome.tested.error).toMatch(/Invalid username/);
  });

  it("says the session expired on a 401, not 'wrong password'", async () => {
    connectMock.mockRejectedValue(new ApiError("Sign in", 401));
    drawForm();

    type(/account email or username/i, "a@b.c");
    type(/^password$/i, PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    expect(await screen.findByText(/session has expired/i)).toBeTruthy();
  });

  it("distinguishes a network failure from a rejected credential", async () => {
    connectMock.mockRejectedValue(new TypeError("Failed to fetch"));
    drawForm();

    type(/account email or username/i, "a@b.c");
    type(/^password$/i, PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    expect(await screen.findByText(/could not reach the server/i)).toBeTruthy();
  });

  it("renders 'Update password' when one is already stored", () => {
    drawForm({ existing: SAVED });
    expect(screen.getByRole("button", { name: /update password/i })).toBeTruthy();
    expect(screen.getByLabelText(/new password/i)).toBeTruthy();
  });
});

describe("the password does not linger", () => {
  it("is cleared from the field once the save resolves", async () => {
    const { onConnected } = drawForm();

    type(/account email or username/i, "shop@example.com");
    type(/^password$/i, PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).toBe("");
  });

  it("is cleared even when the save FAILS", async () => {
    connectMock.mockRejectedValue(new ApiError("Could not save", 500));
    drawForm();

    type(/account email or username/i, "a@b.c");
    type(/^password$/i, PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await screen.findByText(/could not save/i);
    // Retyping is cheaper than leaving it in a component that might be
    // serialised into a devtools snapshot or an error report.
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).toBe("");
  });

  it("never reaches localStorage or sessionStorage", async () => {
    const { onConnected } = drawForm();

    type(/account email or username/i, "shop@example.com");
    type(/^password$/i, PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());

    const dump = JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    });
    expect(dump).not.toContain(PASSWORD);
  });

  it("is never rendered as text anywhere on the page", async () => {
    const { onConnected } = drawForm();

    type(/account email or username/i, "shop@example.com");
    type(/^password$/i, PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());

    expect(document.body.textContent ?? "").not.toContain(PASSWORD);
  });

  it("uses a masked input, so it is not shoulder-readable", () => {
    drawForm();
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).type).toBe("password");
  });
});

describe("duplicate submissions", () => {
  it("disables the button while saving, so one press is one write", async () => {
    let release: (value: SupplierCredential) => void = () => {};
    connectMock.mockReturnValue(new Promise<SupplierCredential>((resolve) => {
      release = resolve;
    }));

    drawForm();
    type(/account email or username/i, "a@b.c");
    type(/^password$/i, PASSWORD);

    const button = screen.getByRole("button", { name: /connect/i });
    fireEvent.click(button);

    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    fireEvent.click(button);

    release(SAVED);
    await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1));
  });

  it("cannot be submitted with an empty password", () => {
    drawForm();
    type(/account email or username/i, "a@b.c");
    expect((screen.getByRole("button", { name: /connect/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("status is reported honestly", () => {
  it("separates saved-but-untested from verified", () => {
    expect(credentialStatus({ ...SAVED, status: "unverified" }).label).toMatch(/not yet checked/i);
    expect(credentialStatus({ ...SAVED, status: "verified" }).label).toBe("Verified");
    expect(credentialStatus({ ...SAVED, status: "failed" }).tone).toBe("bad");
  });

  it("reports nothing stored as 'Not connected'", () => {
    expect(credentialStatus(undefined).label).toBe("Not connected");
    expect(credentialStatus({ ...SAVED, secretSet: false }).label).toBe("Not connected");
  });

  it("does NOT blame the retailer's password when the secret cannot be decrypted", () => {
    // An encryption-key problem. Telling somebody their password is wrong here
    // sends them to reset a password that was never at fault.
    const status = credentialStatus({ ...SAVED, secretUnreadable: true });
    expect(status.tone).toBe("bad");
    expect(status.detail).toMatch(/server configuration/i);
    expect(status.detail).toMatch(/not at fault/i);
    expect(status.detail?.toLowerCase()).not.toMatch(/incorrect password|wrong password/);
  });
});

// ---------------------------------------------------------------------------

describe("the no-supplier gate", () => {
  function Harness() {
    const gate = useSupplierGate();
    return (
      <div>
        <button type="button" onClick={() => gate.guard() && console.info("STARTED")}>
          Scan
        </button>
        {gate.modal}
      </div>
    );
  }

  it("blocks the action and explains why when nothing is connected", async () => {
    const started = vi.spyOn(console, "info").mockImplementation(() => {});
    render(<Harness />);

    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/connect a supplier account first/i)).toBeTruthy();
    // The operation itself must not begin.
    expect(started).not.toHaveBeenCalledWith("STARTED");
    started.mockRestore();
  });

  it("offers a route to Get Started", async () => {
    render(<Harness />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));

    const link = await screen.findByRole("link", { name: /connect an account/i });
    expect(link.getAttribute("href")).toBe("/get-started");
  });

  it("lets the work through once one supplier is connected", async () => {
    onboardingMock.mockResolvedValue({
      firstLogin: false,
      hasConnectedSuppliers: true,
      connectedCount: 1,
      connectable: [],
    });
    const started = vi.spyOn(console, "info").mockImplementation(() => {});

    render(<Harness />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));

    expect(started).toHaveBeenCalledWith("STARTED");
    expect(screen.queryByRole("dialog")).toBeNull();
    started.mockRestore();
  });

  it("FAILS OPEN when the check itself cannot be made", async () => {
    // Blocking a retailer whose accounts are fine, because a status endpoint
    // was unreachable, is worse than the empty result the gate prevents.
    onboardingMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const started = vi.spyOn(console, "info").mockImplementation(() => {});

    render(<Harness />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));

    expect(started).toHaveBeenCalledWith("STARTED");
    started.mockRestore();
  });

  it("never tests a supplier login just to decide the gate", async () => {
    render(<Harness />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    // A gate check is a database read. Logging into a wholesaler on page load
    // is how a trade account gets rate-limited.
    expect(testMock).not.toHaveBeenCalled();
  });

  it("can be dismissed", async () => {
    render(<Harness />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("the gate modal on its own", () => {
  it("renders nothing when closed", () => {
    render(<SupplierGateModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("an administrator on the retailer app", () => {
  /**
   * An admin reads suppliers on the shared `.env` accounts — the approved
   * diagnostic path — so they have connected nothing and never will. Both the
   * onboarding flow and the gate were answering a question that does not apply
   * to them: they were sent to Get Started, and then blocked from searching, on
   * a system that would have answered them perfectly well.
   */
  function Harness() {
    const gate = useSupplierGate();
    return (
      <div>
        <button type="button" onClick={() => gate.guard() && console.info("STARTED")}>
          Scan
        </button>
        {gate.modal}
      </div>
    );
  }

  const asAdmin = {
    firstLogin: false,
    hasConnectedSuppliers: false,
    connectedCount: 0,
    role: "admin" as const,
    usesSharedAccounts: true,
    connectable: [{ supplierId: "musgrave", name: "Musgrave" }],
  };

  it("is never shown the connect-an-account modal", async () => {
    onboardingMock.mockResolvedValue(asAdmin);
    const started = vi.spyOn(console, "info").mockImplementation(() => {});

    render(<Harness />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));

    // Connected count is zero, and the work still goes ahead.
    expect(started).toHaveBeenCalledWith("STARTED");
    expect(screen.queryByRole("dialog")).toBeNull();
    started.mockRestore();
  });

  it("still gates a RETAILER with nothing connected", async () => {
    // The flag must not become a blanket exemption.
    onboardingMock.mockResolvedValue({ ...asAdmin, role: "retailer", usesSharedAccounts: false });
    const started = vi.spyOn(console, "info").mockImplementation(() => {});

    render(<Harness />);
    await waitFor(() => expect(onboardingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(started).not.toHaveBeenCalledWith("STARTED");
    started.mockRestore();
  });
});

describe("revealing the password", () => {
  /**
   * A wholesale password is typed from a note into an app that will use it
   * against somebody else's site. A wrong character comes back minutes later as
   * "sign-in refused" and nothing more, on an account that can lock — so being
   * able to check it before pressing Connect is worth a button.
   */
  it("starts hidden", () => {
    drawForm();
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).type).toBe("password");
  });

  it("reveals and hides again", () => {
    drawForm();
    const field = () => screen.getByLabelText(/^password$/i) as HTMLInputElement;

    fireEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(field().type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: /hide password/i }));
    expect(field().type).toBe("password");
  });

  it("does not submit the form", () => {
    // Inside a form a button with no type is a SUBMIT button, so revealing the
    // password would post it.
    drawForm();
    type(/account email or username/i, "a@b.c");
    type(/^password$/i, PASSWORD);

    fireEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("stays out of the tab order", () => {
    drawForm();
    // Tab from the password field should reach Connect, not a decoration.
    expect(
      screen.getByRole("button", { name: /show password/i }).getAttribute("tabindex"),
    ).toBe("-1");
  });
});
