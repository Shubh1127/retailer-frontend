/**
 * Processing-job API: upload, live progress, history.
 *
 * The frontend NEVER processes a file. It uploads, gets a `jobId`, and
 * subscribes — so a 50-product file and a 5000-product file are the same code
 * path and the same amount of client work. That is the whole reason the job
 * abstraction exists.
 */

import { env } from "./env";
import { requireAccessToken } from "../supabase";

// ---- Wire types (mirror backend/src/services/dashboardPipeline.service.ts) --

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobSummary {
  jobId: string;
  fileName: string;
  storeName?: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  totalProducts: number;
  processedProducts: number;
  readyProducts: number;
  needsAttentionProducts: number;
  progress: number;
  error?: string;
}

export interface DashboardOffer {
  supplier: string;
  supplierName: string;
  product: string;
  sku?: string;
  ean?: string;
  exVatCasePrice?: number;
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  /** Absolute thumbnail URL, when the supplier publishes one. */
  imageUrl?: string;
}

export interface CommercialAlternative extends DashboardOffer {
  difference: string;
  differenceCodes: string[];
}

export interface ProductDetail {
  requestedProduct: string;
  requestedPack?: string;
  selected?: DashboardOffer;
  alternatives: CommercialAlternative[];
  offers: DashboardOffer[];
}

export interface ReadyToOrderRow {
  kind: "ready";
  row: number;
  articleCode: string;
  product: string;
  bestSupplier: string;
  bestSupplierName: string;
  price: number;
  cases: number;
  /**
   * Present ONLY when the supplier genuinely beats the retailer's current cost:
   *   savings = baselineCost − price, when positive.
   */
  savings?: number;
  savingsPct?: number;
  /** The retailer's current cost per case, from the Excel "Cost" column. */
  baselineCost?: number;
  /** Signed baselineCost − price. Negative means the supplier is dearer. */
  costDelta?: number;
  savingsStatus: "saving" | "no-saving" | "no-baseline";
  addedToCart: "Yes" | "No";
  /** Non-blocking caveats. The line is orderable; these say what was inexact. */
  warnings: { code: string; message: string }[];
  /** Set when an admin chose this product rather than the matcher finding it. */
  adminConfirmed?: {
    supplier: string;
    supplierSku: string;
    by?: string;
    differsFromRequest: boolean;
  };
  detail: ProductDetail;
}

export interface NeedsAttentionRow {
  kind: "attention";
  row: number;
  articleCode: string;
  product: string;
  status: string;
  reason: string;
  suggestion: string;
  codes: string[];
  /** The pack the file asked for, e.g. "24 × 330ml". Absent when it stated none. */
  requestedPack?: string;
  /** Cases ordered. Defaults to 1 upstream, so this is always a real number. */
  cases: number;
}

export interface JobBatchEvent {
  jobId: string;
  batchIndex: number;
  processedProducts: number;
  totalProducts: number;
  progress: number;
  readyToOrder: ReadyToOrderRow[];
  needsAttention: NeedsAttentionRow[];
  isComplete: boolean;
  status: JobStatus;
}

/**
 * A decision an admin made on one of your lines, pushed to this screen while it
 * is open.
 *
 * The retailer no longer has to reload to discover that somebody settled a line
 * for them — which was the difference between an admin's correction being useful
 * now and being useful tomorrow.
 */
export type RowDecision =
  | {
      type: "row-confirmed";
      at: string;
      jobId: string;
      row: number;
      product: string;
      supplier: string;
      supplierSku: string;
      supplierProduct?: string;
      by?: string;
    }
  | {
      type: "row-removed";
      at: string;
      jobId: string;
      row: number;
      reason?: string;
      by?: string;
    }
  | { type: "row-restored"; at: string; jobId: string; row: number; by?: string };

/**
 * Turn a line an admin settled into a Ready To Order row.
 *
 * WHY PROMOTE IT RATHER THAN LIST IT SEPARATELY
 *
 * An admin confirming a line has already made the decision the retailer would
 * otherwise have to make. Leaving it in its own panel means every settled
 * product needs its own click to reach a basket — so the more work an admin
 * does, the more clicks the retailer inherits, which is backwards. Promoted, it
 * joins the ready table and is swept up by "Add All" like any other line.
 *
 * The override is the ONLY source for the supplier and price here: the pipeline
 * never produced a match for this line, which is why a human settled it.
 * Savings are therefore `no-baseline` rather than zero — the comparison the
 * pipeline would have made never happened, and reporting "no saving" would
 * claim it did.
 *
 * Returns null when the override cannot be ordered from — a decision without a
 * supplier and SKU is a record, not something a basket can act on.
 */
export function settledAsReadyRow(
  row: NeedsAttentionRow,
  override: JobRowOverride,
  supplierName: string,
): ReadyToOrderRow | null {
  if (override.action !== "confirmed") return null;
  if (!override.supplier || !override.supplierSku) return null;

  return {
    kind: "ready",
    row: row.row,
    articleCode: row.articleCode,
    product: row.product,
    bestSupplier: override.supplier,
    bestSupplierName: supplierName,
    // The admin's price when they recorded one. Zero is honest here: it means
    // nobody stated a price, and the supplier basket will quote the real one.
    price: override.priceExVat ?? 0,
    cases: row.cases,
    savingsStatus: "no-baseline",
    addedToCart: "No",
    warnings: [],
    adminConfirmed: {
      supplier: override.supplier,
      supplierSku: override.supplierSku,
      ...(override.createdByEmail ? { by: override.createdByEmail } : {}),
      // The pipeline made no competing selection, so there is nothing for the
      // admin's choice to differ FROM.
      differsFromRequest: false,
    },
    detail: {
      requestedProduct: row.product,
      ...(row.requestedPack ? { requestedPack: row.requestedPack } : {}),
      selected: {
        supplier: override.supplier,
        supplierName,
        product: override.supplierProduct ?? override.supplierSku,
        // The cart needs this: it is the join key for "is this in the basket".
        sku: override.supplierSku,
        ...(override.priceExVat !== undefined
          ? { exVatCasePrice: override.priceExVat }
          : {}),
      },
      alternatives: [],
      offers: [],
    },
  };
}

export interface CreateJobResponse extends JobSummary {
  aiService?: { reachable: boolean; status?: string; model?: string; error?: string };
  persistence?: "supabase" | "memory-only";
  warning?: string;
}

// ---- Client ----------------------------------------------------------------

function url(path: string): string {
  return new URL(path, env.apiBaseUrl).toString();
}

/**
 * Every job call carries the signed-in retailer's token.
 *
 * The API is no longer open. It scopes each answer to the caller — a retailer
 * sees the jobs they uploaded and nobody else's — so a call without a token is
 * not "less specific", it is rejected.
 */
async function authHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await requireAccessToken()}`, ...extra };
}

/** Turn a failed response into the backend's message rather than a bare code. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const text = await res.text().catch(() => "");
  try {
    return new Error((JSON.parse(text) as { error?: string }).error ?? fallback);
  } catch {
    return new Error(text || fallback);
  }
}

/** Read a File as base64 without the data: prefix. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** Upload a file and start a job. Returns as soon as the job is queued. */
export async function createJob(
  file: File,
  opts: { defaultCases?: number; batchSize?: number } = {},
): Promise<CreateJobResponse> {
  const fileBase64 = await fileToBase64(file);

  const res = await fetch(url("/api/jobs"), {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fileBase64, fileName: file.name, ...opts }),
  });

  if (!res.ok) throw await failure(res, `Upload failed (${res.status})`);
  return (await res.json()) as CreateJobResponse;
}

export async function listJobs(): Promise<JobSummary[]> {
  const res = await fetch(url("/api/jobs"), { headers: await authHeaders() });
  if (!res.ok) throw await failure(res, `Could not load jobs (${res.status})`);
  const body = (await res.json()) as { jobs: JobSummary[] };
  return body.jobs ?? [];
}

export async function getJob(jobId: string): Promise<JobSummary> {
  const res = await fetch(url(`/api/jobs/${jobId}`), { headers: await authHeaders() });
  if (!res.ok) throw await failure(res, `Could not load job (${res.status})`);
  return (await res.json()) as JobSummary;
}

/**
 * A decision an admin has already made on one of your lines.
 *
 * The same facts `RowDecision` carries live, but read back on load rather than
 * pushed. Both are needed: the stream keeps an open page current, and this is
 * what makes the decision survive a reload.
 */
export interface JobRowOverride {
  jobId: string;
  rowNumber: number;
  action: "confirmed" | "removed";
  supplier?: string;
  supplierSku?: string;
  supplierProduct?: string;
  priceExVat?: number;
  reason?: string;
  createdByEmail?: string;
  createdAt?: string;
}

/** Everything accumulated so far — used when opening a finished job. */
export async function getJobRows(jobId: string): Promise<{
  summary: JobSummary;
  readyToOrder: ReadyToOrderRow[];
  needsAttention: NeedsAttentionRow[];
  /** Standing admin decisions, keyed by row number. */
  overrides?: Record<number, JobRowOverride>;
}> {
  const res = await fetch(url(`/api/jobs/${jobId}/rows`), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw await failure(res, `Could not load job rows (${res.status})`);
  return await res.json();
}

/**
 * Download the CSV report.
 *
 * Fetched and saved as a blob rather than linked with an `<a href>`. A plain
 * link cannot carry an Authorization header, and the alternative — putting the
 * token in the URL — writes a live credential into browser history and every
 * access log on the way.
 */
export async function downloadReport(jobId: string, fileName?: string): Promise<void> {
  const res = await fetch(url(`/api/jobs/${jobId}/report`), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw await failure(res, `Could not download the report (${res.status})`);

  const blob = await res.blob();

  // The server names the file; fall back to something meaningful if the header
  // is missing (or hidden by CORS, which is why it is explicitly exposed).
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const named = /filename="?([^"]+)"?/.exec(disposition)?.[1];

  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = named ?? fileName ?? `retailcompare-${jobId.slice(0, 8)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Subscribe to a job's batches over Server-Sent Events.
 *
 * One-way progress, so SSE rather than a WebSocket: it is plain HTTP and it
 * survives proxies.
 *
 * WHY THIS IS NOT `EventSource`
 *
 * `EventSource` cannot set request headers, and the API now requires a bearer
 * token. The usual workaround is `?access_token=…`, which puts a live
 * credential into the URL — browser history, the server's access log, and every
 * proxy log in between. So the stream is read with `fetch` instead, which keeps
 * the token in the Authorization header where it belongs.
 *
 * What that costs is the automatic reconnect `EventSource` gives for free, so it
 * is reimplemented here — including `Last-Event-ID`, which the backend already
 * honours by resuming at the next unseen batch rather than replaying or, worse,
 * skipping rows.
 *
 * Returns an unsubscribe function.
 */
export function subscribeToJob(
  jobId: string,
  handlers: {
    onStatus?: (summary: JobSummary) => void;
    onBatch?: (event: JobBatchEvent) => void;
    onDone?: (summary: JobSummary) => void;
    /** An admin confirmed, removed or restored one of this job's lines. */
    onOverride?: (decision: RowDecision) => void;
    onError?: (message: string) => void;
  },
): () => void {
  const controller = new AbortController();
  let stopped = false;
  /** The last batch index seen, so a reconnect resumes rather than restarts. */
  let lastEventId: string | undefined;

  const dispatch = (frame: string) => {
    let event = "message";
    let id: string | undefined;
    const data: string[] = [];

    for (const line of frame.split("\n")) {
      // A line starting with ':' is a comment — the heartbeat uses one.
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      // Exactly one optional leading space is part of the format.
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }

    if (id !== undefined) lastEventId = id;
    if (data.length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return; // a truncated frame is not worth taking the stream down for
    }

    if (event === "status") handlers.onStatus?.(payload as JobSummary);
    else if (event === "batch") handlers.onBatch?.(payload as JobBatchEvent);
    else if (event === "override") handlers.onOverride?.(payload as RowDecision);
    else if (event === "done") {
      handlers.onDone?.(payload as JobSummary);
      // The job is over. Stop, rather than reconnecting to a finished stream.
      stopped = true;
      controller.abort();
    }
  };

  const run = async () => {
    let attempt = 0;

    while (!stopped) {
      try {
        const res = await fetch(url(`/api/jobs/${jobId}/events`), {
          headers: await authHeaders({
            Accept: "text/event-stream",
            ...(lastEventId !== undefined ? { "Last-Event-ID": lastEventId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // 401/403/404 will not fix themselves by retrying, and retrying a 401
          // in a loop is how a signed-out tab hammers the API forever.
          if (res.status < 500) {
            throw Object.assign(await failure(res, `Stream failed (${res.status})`), {
              fatal: true,
            });
          }
          throw await failure(res, `Stream failed (${res.status})`);
        }
        if (!res.body) throw new Error("This browser cannot read the progress stream.");

        attempt = 0; // a successful connect resets the backoff
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Frames are separated by a blank line. Tolerate CRLF, which a proxy
          // is entitled to introduce even though the server writes LF.
          let boundary = buffer.search(/\r?\n\r?\n/);
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + /\r?\n\r?\n/.exec(buffer.slice(boundary))![0].length);
            dispatch(frame);
            boundary = buffer.search(/\r?\n\r?\n/);
          }
        }
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        if ((error as { fatal?: boolean }).fatal) {
          handlers.onError?.(error instanceof Error ? error.message : String(error));
          return;
        }
      }

      if (stopped) return;

      // The stream ended without a `done` event — the job is still running and
      // something dropped the connection. Back off, then resume.
      attempt += 1;
      if (attempt > 6) {
        handlers.onError?.("Connection to the processing job was lost.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
    }
  };

  void run();

  return () => {
    stopped = true;
    controller.abort();
  };
}

// ---- Formatting ------------------------------------------------------------

export function eur(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function packOf(offer: {
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
}): string {
  if (offer.unitsPerCase === undefined || offer.unitSize === undefined) return "—";
  return `${offer.unitsPerCase} × ${offer.unitSize}${offer.uom ?? ""}`;
}

export function clockOf(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
