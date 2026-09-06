/**
 * The desktop download page.
 *
 * WHAT IS WORTH PINNING HERE is the link. Everything else on the page is prose,
 * but a download button pointing at a filename that no longer exists is a dead
 * end a retailer cannot work around — and the filename is derived from a
 * version string, which is exactly the kind of thing a release bumps in one
 * place and forgets in another. The version shown and the version in the URL
 * are asserted to be the SAME value for that reason.
 *
 * The beta warning is pinned too, and pinned as a *negative*: the page must not
 * claim the installer is signed while it is not.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// AppShell pulls in the whole nav, /api/me and the theme. None of it is what
// this page is about.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const DesktopPage = (await import("./page")).default;
const { windowsRelease } = await import("@/lib/desktopRelease");

afterEach(() => cleanup());

describe("desktop download page", () => {
  it("points the download at the published installer in the public bucket", () => {
    render(<DesktopPage />);

    const link = screen.getByRole("link", { name: /download for windows/i });

    expect(link).toHaveProperty(
      "href",
      "https://ijqxpoutyvgynspywgqf.supabase.co/storage/v1/object/public/desktop-updates/RetailCompare_0.1.2_x64-setup.exe",
    );
    expect(link.getAttribute("download")).toBe("RetailCompare_0.1.2_x64-setup.exe");
  });

  it("shows the same version it links to", () => {
    render(<DesktopPage />);

    expect(screen.getAllByText(new RegExp(`Version ${windowsRelease.version}`)).length)
      .toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /download for windows/i }).getAttribute("href"),
    ).toContain(windowsRelease.version);
  });

  it("warns about SmartScreen without claiming the beta is signed", () => {
    render(<DesktopPage />);

    expect(screen.getByText(/SmartScreen/)).toBeTruthy();
    expect(screen.getByText(/not code-signed yet/i)).toBeTruthy();
    expect(screen.queryByText(/code.?signed by|Microsoft.certified/i)).toBeNull();
  });

  it("tells an existing install that updates are automatic", () => {
    render(<DesktopPage />);

    expect(screen.getByText(/checks for updates automatically/i)).toBeTruthy();
  });
});
