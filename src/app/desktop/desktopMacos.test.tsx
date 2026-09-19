/**
 * The macOS half of the desktop download page.
 *
 * A SEPARATE FILE FROM `desktop.test.tsx`, which covers Windows and is not
 * modified. The two platforms publish independently, so their tests should be
 * able to fail independently too — a broken macOS link should not read as a
 * Windows regression.
 *
 * WHAT IS WORTH PINNING HERE, beyond what the Windows tests already pin:
 *
 *  1. THE DMG LINK, NOT THE TARBALL. `latest.json` names the `.app.tar.gz`
 *     under `platforms["darwin-aarch64"].url`, because that is what the
 *     auto-updater fetches. A person needs the `.dmg`. These are different
 *     files, and linking the wrong one hands a retailer an archive with no
 *     instructions. Windows has no equivalent trap — there the two are the
 *     same file — so nothing in the existing tests would catch it.
 *
 *  2. NO BUTTON WHEN macOS IS NOT PUBLISHED. The manifest carries one
 *     top-level `version` plus a per-platform map. When only Windows has
 *     shipped, that version is the WINDOWS version and there is no macOS
 *     entry. Rendering a download button from the top-level version alone
 *     would point at a `.dmg` that was never uploaded — a 404 a retailer
 *     cannot diagnose.
 *
 *  3. THE GATEKEEPER STEPS ARE THE ONES THAT WORK. Telling someone on macOS
 *     15+ to right-click and choose Open sends them in a circle: that route
 *     was removed for apps signed this way. Privacy & Security must be the
 *     primary instruction.
 *
 *  4. THE PAGE DOES NOT CLAIM THE BUILD IS SIGNED. Pinned as a negative, the
 *     same way the Windows test pins its own.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const DesktopPage = (await import("./page")).default;

const BUCKET =
  "https://ijqxpoutyvgynspywgqf.supabase.co/storage/v1/object/public/desktop-updates";

/** A manifest carrying both platforms, as a real one does once both have shipped. */
function mockBothPublished(windowsVersion: string, macVersion: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: windowsVersion,
        platforms: {
          "windows-x86_64": {
            url: `${BUCKET}/RetailCompare_${windowsVersion}_x64-setup.exe`,
          },
          "darwin-aarch64": {
            url: `${BUCKET}/RetailCompare_${macVersion}_aarch64.app.tar.gz`,
          },
        },
      }),
    }),
  );
}

/** Windows shipped, macOS has not. The state the bucket was in before this work. */
function mockWindowsOnly(version: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version,
        platforms: {
          "windows-x86_64": { url: `${BUCKET}/RetailCompare_${version}_x64-setup.exe` },
        },
      }),
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("desktop download page — macOS", () => {
  it("links to the .dmg, not the updater tarball", async () => {
    mockBothPublished("0.1.3", "1.0.1");

    render(await DesktopPage());

    const link = screen.getByRole("link", { name: /download for macos/i });
    const href = link.getAttribute("href") ?? "";

    expect(href).toBe(`${BUCKET}/RetailCompare_1.0.1_aarch64.dmg`);
    // The trap this test exists for.
    expect(href).not.toContain(".app.tar.gz");
    expect(link.getAttribute("download")).toBe("RetailCompare_1.0.1_aarch64.dmg");
  });

  it("shows the macOS version, not the manifest's top-level Windows version", async () => {
    // The two disagree whenever the platforms are published out of step.
    mockBothPublished("0.1.3", "1.0.1");

    render(await DesktopPage());

    expect(
      screen.getByRole("link", { name: /download for macos/i }).getAttribute("href"),
    ).toContain("1.0.1");
    // ...and the Windows link is untouched by any of this.
    expect(
      screen.getByRole("link", { name: /download for windows/i }).getAttribute("href"),
    ).toContain("0.1.3");
  });

  it("offers no macOS download when the manifest has no macOS entry", async () => {
    mockWindowsOnly("0.1.3");

    render(await DesktopPage());

    expect(screen.queryByRole("link", { name: /download for macos/i })).toBeNull();
    expect(screen.getByText(/macOS build is not published yet/i)).toBeTruthy();
    // Windows is unaffected.
    expect(screen.getByRole("link", { name: /download for windows/i })).toBeTruthy();
  });

  it("gives Gatekeeper steps that work on current macOS, without claiming it is signed", async () => {
    mockBothPublished("0.1.3", "1.0.1");

    render(await DesktopPage());

    expect(screen.getByText(/Gatekeeper/)).toBeTruthy();
    // The route that still works. Split across elements, so matched on the container.
    expect(screen.getByText(/Privacy & Security/)).toBeTruthy();
    expect(screen.getByText(/Open Anyway/)).toBeTruthy();
    expect(screen.getByText(/not signed with an Apple Developer ID/i)).toBeTruthy();
    // Never claim otherwise.
    expect(screen.queryByText(/notarized|signed by Apple/i)).toBeNull();
  });

  it("states the Apple Silicon requirement", async () => {
    mockBothPublished("0.1.3", "1.0.1");

    render(await DesktopPage());

    expect(screen.getByText(/Apple Silicon only/i)).toBeTruthy();
    expect(screen.getByText(/Intel Macs are not supported/i)).toBeTruthy();
  });

  it("falls back to 'not published' rather than breaking when the manifest is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(await DesktopPage());

    expect(screen.queryByRole("link", { name: /download for macos/i })).toBeNull();
    expect(screen.getByText(/macOS build is not published yet/i)).toBeTruthy();
  });
});
