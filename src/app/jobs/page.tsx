"use client";

/**
 * Job history — every upload the retailer has run.
 *
 * A 2000-product run is real work; losing it because the tab was closed would be
 * a bad experience. Jobs persist in Supabase, so yesterday's run is still here
 * with its counts, its timings and its downloadable report.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import {
  clockOf,
  downloadReport,
  listJobs,
  type JobStatus,
  type JobSummary,
} from "@/lib/api/jobs";

const STATUS_STYLES: Record<JobStatus, string> = {
  completed: "bg-emerald-50 text-emerald-700",
  running: "bg-teal-50 text-link",
  queued: "bg-canvas text-ink-soft",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-amber-50 text-amber-700",
};

function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (opts: { passive?: boolean } = {}) => {
    try {
      setJobs(await listJobs(opts));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A job that is still running is the only reason to re-read this page, so poll
  // only while one is in flight. Live progress belongs on the dashboard, not here.
  useEffect(() => {
    const hasRunning = jobs.some(
      (job) => job.status === "running" || job.status === "queued",
    );
    if (!hasRunning) return;
    // Passive: this fires because a job is running, not because anybody is
    // here. Counting it as presence would keep a tab signed in through a long
    // job with the room empty.
    const timer = setInterval(() => void load({ passive: true }), 5000);
    return () => clearInterval(timer);
  }, [jobs, load]);

  return (
    <AppShell active="Dashboard">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">
            Job history
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            Every order file processed, newest first.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700"
        >
          New upload
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-line bg-surface px-4 py-10 text-center text-[13px] text-ink-soft">
          Loading…
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
          <h2 className="text-[15px] font-semibold text-ink">No jobs yet</h2>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-soft">
            Upload an order file from the dashboard and it will appear here.
            History requires Supabase to be configured.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="border-b border-line bg-canvas text-[12px] text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">File</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Products</th>
                  <th className="px-3 py-2 text-right font-medium">Matched</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Needs attention
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Started</th>
                  <th className="px-3 py-2 text-right font-medium">Completed</th>
                  <th className="px-3 py-2 text-right font-medium">Report</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.jobId}
                    className="border-b border-line last:border-0 hover:bg-canvas/60"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/jobs/${job.jobId}`}
                        className="font-medium text-ink hover:text-link"
                      >
                        {job.fileName}
                      </Link>
                      <div className="text-[11.5px] text-ink-faint">
                        {job.storeName ?? job.jobId.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={job.status} />
                      {job.status === "running" && (
                        <span className="ml-1.5 tabular-nums text-[11.5px] text-ink-soft">
                          {job.progress}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {job.totalProducts}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                      {job.readyProducts}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                      {job.needsAttentionProducts}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {clockOf(job.startedAt)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {clockOf(job.completedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          void downloadReport(job.jobId, job.fileName);
                        }}
                        className="text-link hover:underline"
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
