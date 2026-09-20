/**
 * RetailCompare Desktop — where a retailer gets the desktop app.
 *
 * TWO PLATFORMS, TWO INDEPENDENT RELEASES. Windows and macOS are published
 * separately, signed by different authorities, and warn about different things
 * when they are not signed. Each has its own module under `lib/` and its own
 * card below; neither reads the other's. They share only `latest.json`, which
 * holds one entry per platform.
 *
 * WHY IT IS INSIDE THE SIGNED-IN APP rather than on a public marketing page.
 * The build is a closed beta, and the first thing it asks for is the same
 * RetailCompare account this page is being read from. Putting it behind the
 * gate every other page sits behind means the people who can reach it are
 * exactly the people it will let in — and it needed no new auth to do that:
 * `AuthGate` in the root layout covers any path not named in its public list.
 *
 * NO STATE, SO NO `"use client"`. Everything here is a fact about a published
 * release; the only interactive element is a link. A client component would
 * ship JavaScript to render a page that never changes after it arrives — an
 * async server component fetches once on the server and still ships none.
 *
 * THE VERSION AND URL COME FROM `lib/desktopRelease`, not from this file.
 * `getLatestWindowsRelease` reads the version straight out of `latest.json`
 * in the release bucket, so shipping 0.1.3 is dropping a file in Supabase
 * Storage, not a change to this page. See that module.
 */

import type { Metadata } from "next";

import AppShell from "@/components/AppShell";
import { getLatestWindowsRelease } from "@/lib/desktopRelease";
import { getLatestMacosRelease } from "@/lib/macosRelease";

export const metadata: Metadata = {
  title: "RetailCompare Desktop — download for Windows and macOS",
  description:
    "Install the RetailCompare desktop app to run supplier-connected features directly on your computer.",
};

/** One labelled fact in the platform table. */
function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[12.5px] text-ink-faint">{label}</dt>
      <dd className="text-[12.5px] font-medium text-ink">{value}</dd>
    </div>
  );
}

/** A numbered install step. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas text-[11px] font-semibold text-ink-soft">
        {n}
      </span>
      <span className="text-[13px] leading-relaxed text-ink-soft">{children}</span>
    </li>
  );
}

export default async function DesktopDownloadPage() {
  /*
   * BOTH MANIFEST READS AT ONCE. They hit the same object in the same bucket,
   * and awaiting them in sequence would put two round trips on the critical
   * path of a page that is otherwise static. Neither can fail the render —
   * each falls back to its own last-known release.
   */
  const [release, mac] = await Promise.all([
    getLatestWindowsRelease(),
    getLatestMacosRelease(),
  ]);

  return (
    <AppShell active="Desktop app">
      {/*
        TWO COLUMNS ON A WIDE SCREEN, ONE ON A NARROW ONE. Windows and macOS are
        independent of each other — nothing in the macOS column follows from the
        Windows column — so stacking them wasted the right half of the page and
        pushed macOS below the fold. Each column keeps a readable measure; the
        grid collapses to a single column below `lg`, which is the stacked
        layout a phone wants anyway.
      */}
      <div className="max-w-5xl">
        <h1 className="text-[19px] font-semibold tracking-tight text-ink">
          RetailCompare Desktop
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Install the RetailCompare desktop app to run supplier-connected
          features directly on your computer.
        </p>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          {/* ================= Windows ================= */}
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Windows</h2>

            {/* ---- The download ---- */}
            <section className="mt-3 rounded-xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[14px] font-medium text-ink">Version {release.version}</span>
                {release.beta && (
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    Closed beta
                  </span>
                )}
              </div>

              {/*
                A plain <a>, straight to the public bucket. Next's <Link> is for
                in-app routes and would prefetch a 26 MB installer; `download` asks
                the browser to save rather than navigate. It is a cross-origin link,
                so `rel` is set for the usual reason.
              */}
              <a
                href={release.installerUrl}
                download={release.installerFilename}
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-teal-600 sm:w-auto"
              >
                <DownloadIcon />
                Download for Windows
              </a>

              <p className="mt-2.5 break-all text-[11.5px] text-ink-faint">
                {release.installerFilename}
              </p>
            </section>

            {/* ---- What it is ---- */}
            <section className="mt-4 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-[13.5px] font-semibold text-ink">Platform</h2>
              <dl className="mt-2 divide-y divide-line">
                <Spec label="Operating system" value={release.platform} />
                <Spec label="Architecture" value={release.architecture} />
                <Spec label="Type" value="Desktop application" />
                <Spec label="Current version" value={release.version} />
              </dl>
            </section>

            {/* ---- How to install ---- */}
            <section className="mt-4 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-[13.5px] font-semibold text-ink">Installing it</h2>
              <ol className="mt-3 space-y-2.5">
                <Step n={1}>Download the installer.</Step>
                <Step n={2}>
                  Run the <code className="rounded bg-canvas px-1 py-0.5 text-[12px]">.exe</code>{" "}
                  file your browser saved.
                </Step>
                <Step n={3}>Follow the installation steps.</Step>
                <Step n={4}>Open RetailCompare after installation.</Step>
                <Step n={5}>Sign in with your existing RetailCompare account.</Step>
              </ol>
            </section>

            {/* ---- The warning Windows will show ----
                Said plainly and BEFORE it happens. A retailer who meets SmartScreen
                with no warning assumes the file is unsafe and stops; one who was
                told to expect it carries on. It must not be dressed up: this build
                is genuinely not code-signed, and claiming otherwise would be the
                one thing that makes the next warning untrustworthy. */}
            {!release.codeSigned && (
              <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="text-[13.5px] font-semibold text-amber-900">
                  This is a closed beta
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-amber-900/90">
                  The beta installer is not code-signed yet, so Windows may show a{" "}
                  <span className="font-medium">SmartScreen</span> warning
                  (&ldquo;Windows protected your PC&rdquo;) when you run it. If you see it,
                  choose <span className="font-medium">More info</span>, then{" "}
                  <span className="font-medium">Run anyway</span>.
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-amber-900/80">
                  Only download RetailCompare Desktop from this page.
                </p>
              </section>
            )}
          </div>

          {/* ================= macOS ================= */}
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">macOS</h2>

            {/*
              The macOS build may legitimately not be published while Windows is —
              the two ship independently. Rendering a download button in that case
              would point at a .dmg that was never uploaded, so the page says what
              is true instead. See `published` in lib/macosRelease.
            */}
            {!mac.published ? (
              <section className="mt-3 rounded-xl border border-line bg-surface p-5">
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  The macOS build is not published yet. It will appear here as soon
                  as it is available.
                </p>
              </section>
            ) : (
              <>
                <section className="mt-3 rounded-xl border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-[14px] font-medium text-ink">Version {mac.version}</span>
                    {mac.beta && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                        Closed beta
                      </span>
                    )}
                  </div>

                  <a
                    href={mac.installerUrl}
                    download={mac.installerFilename}
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-teal-600 sm:w-auto"
                  >
                    <DownloadIcon />
                    Download for macOS
                  </a>

                  <p className="mt-2.5 break-all text-[11.5px] text-ink-faint">
                    {mac.installerFilename}
                  </p>
                </section>

                <section className="mt-4 rounded-xl border border-line bg-surface p-5">
                  <h3 className="text-[13.5px] font-semibold text-ink">Platform</h3>
                  <dl className="mt-2 divide-y divide-line">
                    <Spec label="Operating system" value={`${mac.platform} ${mac.minimumMacos} or later`} />
                    <Spec label="Architecture" value={mac.architecture} />
                    <Spec label="Type" value="Desktop application" />
                    <Spec label="Current version" value={mac.version} />
                  </dl>
                  {/*
                    Stated as a requirement rather than left to be discovered. This
                    build is arm64-only; an Intel Mac cannot run it at all, and the
                    failure if someone tries is not self-explanatory.
                  */}
                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
                    Apple Silicon only (M1 or newer). Intel Macs are not supported by
                    this build. To check, open{" "}
                    <span className="font-medium">Apple menu &rsaquo; About This Mac</span>.
                  </p>
                </section>

                <section className="mt-4 rounded-xl border border-line bg-surface p-5">
                  <h3 className="text-[13.5px] font-semibold text-ink">Installing it</h3>
                  <ol className="mt-3 space-y-2.5">
                    <Step n={1}>Download the disk image.</Step>
                    <Step n={2}>
                      Open the{" "}
                      <code className="rounded bg-canvas px-1 py-0.5 text-[12px]">.dmg</code> and drag{" "}
                      <span className="font-medium">RetailCompare</span> into{" "}
                      <span className="font-medium">Applications</span>.
                    </Step>
                    <Step n={3}>
                      Open it from Applications. macOS will block it the first time —
                      see below.
                    </Step>
                    <Step n={4}>Sign in with your existing RetailCompare account.</Step>
                  </ol>
                </section>
              </>
            )}

            {/* ---- The warning macOS will show ----
                Said plainly and BEFORE it happens, for the same reason as the
                Windows notice above: a retailer who meets Gatekeeper unprepared
                assumes the file is unsafe and stops.

                THE STEPS DIFFER BY macOS VERSION and both are given, because giving
                only one sends half of them in a circle. Up to macOS 14, right-click
                then Open is enough. From macOS 15 that route no longer works for an
                app signed this way, and the only way through is Privacy & Security.

                It must not be dressed up: this build genuinely carries no Apple
                Developer ID, and claiming otherwise would make the next warning
                untrustworthy. */}
            {mac.published && !mac.codeSigned && (
              <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h3 className="text-[13.5px] font-semibold text-amber-900">
                  macOS will block it the first time
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-amber-900/90">
                  This build is not signed with an Apple Developer ID yet, so{" "}
                  <span className="font-medium">Gatekeeper</span> will refuse to open
                  it until you allow it once. You only have to do this on the first
                  launch.
                </p>
                <ol className="mt-3 space-y-2.5">
                  <Step n={1}>
                    Open <span className="font-medium">RetailCompare</span> from
                    Applications. A message says it cannot be opened.
                  </Step>
                  <Step n={2}>
                    Go to <span className="font-medium">Apple menu &rsaquo; System Settings
                    &rsaquo; Privacy &amp; Security</span> and scroll down.
                  </Step>
                  <Step n={3}>
                    Next to the note about RetailCompare, choose{" "}
                    <span className="font-medium">Open Anyway</span>, then confirm.
                  </Step>
                </ol>
                <p className="mt-3 text-[12.5px] leading-relaxed text-amber-900/80">
                  On macOS 14 and earlier you can instead right-click the app and
                  choose <span className="font-medium">Open</span>.
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-amber-900/80">
                  Only download RetailCompare Desktop from this page.
                </p>
              </section>
            )}
          </div>
        </div>

        {/* ---- Already installed ----
            True of both platforms, so it sits under the grid rather than in
            either column. */}
        <p className="mt-6 rounded-xl border border-line bg-surface px-5 py-4 text-[12.5px] leading-relaxed text-ink-soft">
          Already have RetailCompare Desktop? The app checks for updates
          automatically.
        </p>
      </div>
    </AppShell>
  );
}

/** A tray with an arrow into it. Matches the nav icons' grid and stroke. */
function DownloadIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 4v10" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 18.5h15" />
    </svg>
  );
}
