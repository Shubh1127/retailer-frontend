/**
 * RetailCompare Desktop — where a retailer gets the Windows app.
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
 * ship JavaScript to render a page that never changes after it arrives.
 *
 * THE VERSION AND URL COME FROM `lib/desktopRelease`, not from this file, so
 * shipping 0.1.3 is a change to release metadata rather than a change to a
 * page. See that module.
 */

import type { Metadata } from "next";

import AppShell from "@/components/AppShell";
import { windowsRelease } from "@/lib/desktopRelease";

export const metadata: Metadata = {
  title: "RetailCompare Desktop — download for Windows",
  description:
    "Install the RetailCompare Windows desktop app to run supplier-connected features directly on your PC.",
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

export default function DesktopDownloadPage() {
  const release = windowsRelease;

  return (
    <AppShell active="Desktop app">
      {/* Reads as one column of prose and cards, so it needs a measure rather
          than the full 1400px the tables on other pages want. */}
      <div className="max-w-2xl">
        <h1 className="text-[19px] font-semibold tracking-tight text-ink">
          RetailCompare Desktop
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Install the RetailCompare Windows desktop app to run supplier-connected
          features directly on your PC.
        </p>

        {/* ---- The download ---- */}
        <section className="mt-5 rounded-xl border border-line bg-surface p-5">
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

        {/* ---- Already installed ---- */}
        <p className="mt-4 rounded-xl border border-line bg-surface px-5 py-4 text-[12.5px] leading-relaxed text-ink-soft">
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
