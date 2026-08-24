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
  /**
   * Set when two or more INDEPENDENT suppliers published the SAME barcode.
   *
   * Not always two: with three suppliers a line can be confirmed by any two of
   * them, or by all three. Read the length of `suppliers` rather than assuming.
   * Barry's ambient and chill baskets count as ONE supplier here — they are a
   * single catalogue, and it agreeing with itself is not corroboration.
   *
   * An IDENTITY claim only: two independent catalogues published the same GS1
   * number, so it is the same retail product. It says nothing about the pack —
   * one barcode can cover a display unit and a single box at different
   * suppliers — so pack differences still appear in `warnings` and are still
   * what commercial equivalence decides.
   */
  eanConfirmed?: {
    /** The canonical GTIN-14 the suppliers agreed on. */
    gtin14: string;
    /** Each supplier's own code and its own spelling of the barcode. */
    suppliers: {
      supplier: string;
      supplierName: string;
      sku?: string;
      ean?: string;
    }[];
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
/**
 * Apply a confirmation to a line the pipeline ALREADY matched.
 *
 * `settledAsReadyRow` builds a ready row out of an attention row; this rewrites
 * one that already exists. Both are needed, because an admin can confirm either
 * kind and the two arrive by different routes.
 *
 * Without this, confirming an already-matched line did nothing visible: the
 * override was stored, returned by the API, and then ignored, so the row kept
 * showing whatever the matcher picked. `processed_products` is written once
 * when the job runs and never rewritten — so the merge has to happen here, at
 * the read boundary, or not at all.
 *
 * The pipeline's own verdict is deliberately NOT discarded. Its offers stay in
 * `detail.offers`, so the panel can still show what else was available and at
 * what price — which is exactly how a buyer notices that a pinned line costs
 * more than an alternative.
 */
export function confirmedOverReadyRow(
  row: ReadyToOrderRow,
  override: JobRowOverride,
  supplierName: string,
): ReadyToOrderRow {
  if (override.action !== "confirmed") return row;
  if (!override.supplier || !override.supplierSku) return row;

  // Already the chosen supplier and code — the admin confirmed what the matcher
  // had picked, so there is nothing to rewrite and the pipeline's richer record
  // (savings, warnings, offers) is worth keeping intact.
  if (
    override.supplier === row.bestSupplier &&
    override.supplierSku === row.detail.selected?.sku
  ) {
    return row;
  }

  const selected = {
    supplier: override.supplier,
    supplierName,
    product: override.supplierProduct ?? override.supplierSku,
    sku: override.supplierSku,
    ...(override.priceExVat !== undefined
      ? { exVatCasePrice: override.priceExVat }
      : {}),
    ...(override.ean ? { ean: override.ean } : {}),
    ...(override.imageUrl ? { imageUrl: override.imageUrl } : {}),
    ...(override.unitsPerCase !== undefined
      ? { unitsPerCase: override.unitsPerCase }
      : {}),
    ...(override.unitSize !== undefined ? { unitSize: override.unitSize } : {}),
    ...(override.uom ? { uom: override.uom } : {}),
  };

  // The price the override recorded, or — failing that — the one the OTHER
  // supplier's listing happens to have.
  //
  // `row.price` belongs to the supplier the matcher picked. Carrying it across
  // was actively wrong: the panel showed Musgrave's name against O'Reilly's
  // €20.89, which is not a number anyone can act on and is indistinguishable
  // from a real quote. A confirmation that recorded no price genuinely does not
  // know one, and 0 renders as "—" rather than inventing a figure.
  const price = override.priceExVat ?? 0;

  return {
    ...row,
    bestSupplier: override.supplier,
    bestSupplierName: supplierName,
    price,
    // The saving was computed against a supplier nobody is buying from now.
    // Reporting it against the admin's choice would be inventing a comparison
    // that never happened, so it reverts to "no baseline".
    savingsStatus: "no-baseline",
    savings: undefined,
    savingsPct: undefined,
    // Said out loud rather than left as a blank cell. A line whose price is
    // unknown still has to be ordered, and the buyer needs to know the figure
    // is missing rather than zero.
    warnings: price
      ? row.warnings
      : [
          ...row.warnings,
          {
            code: "MISSING_PRICE",
            message:
              "The confirmed product was recorded without a price. The supplier " +
              "basket will quote it.",
          },
        ],
    adminConfirmed: {
      supplier: override.supplier,
      supplierSku: override.supplierSku,
      ...(override.createdByEmail ? { by: override.createdByEmail } : {}),
      // Whether it matches the FILE is a question the pipeline answered about a
      // different product; it cannot be carried across to this one.
      differsFromRequest: false,
    },
    detail: {
      ...row.detail,
      selected,
      // The matcher's offers are kept — that is what lets the panel say
      // "O'Reilly lists it at less".
    },
  };
}

/**
 * A matched line an admin struck off, as a line that now needs attention.
 *
 * REMOVING A PRODUCT IS NOT REMOVING A LINE.
 *
 * The retailer's file asked for this article. An admin rejecting the product
 * the matcher picked has said "not this one" — they have not said the shop no
 * longer wants the item. Dropping the row from both tables, which is what
 * happened before, made the line vanish from the screen entirely: it was not
 * orderable, not outstanding, and nothing on the page admitted it existed. The
 * only trace was in the activity trail.
 *
 * So it moves to Needs Attention, which is exactly what it now is — a line with
 * no chosen product, waiting on somebody to pick one. `restore` puts the
 * original match back, and confirming a different product settles it the same
 * way any other attention line is settled.
 *
 * The counterpart of `settledAsReadyRow`, which moves a line the other way.
 */
export function removedAsAttentionRow(
  row: ReadyToOrderRow,
  override: JobRowOverride,
): NeedsAttentionRow | null {
  if (override.action !== "removed") return null;

  return {
    kind: "attention",
    row: row.row,
    articleCode: row.articleCode,
    product: row.product,
    status: "Removed by admin",
    // The admin's own words when they gave any. A removal with a reason is the
    // most useful thing on this row — it usually says what was wrong with the
    // match, which is the next person's starting point.
    reason:
      override.reason ??
      "An admin rejected the product that was matched to this line.",
    suggestion: "Choose a different product, or restore the original match.",
    codes: [],
    ...(row.detail?.requestedPack ? { requestedPack: row.detail.requestedPack } : {}),
    cases: row.cases,
  };
}

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
        // The rest of the product, recorded at confirm time. A promoted line
        // sits in the same table as matched ones, so it needs the same
        // furniture — a picture and a pack — or it reads as a broken row.
        // Each is absent rather than blank when the supplier published none:
        // "no image" and "image failed" already render identically.
        ...(override.ean ? { ean: override.ean } : {}),
        ...(override.imageUrl ? { imageUrl: override.imageUrl } : {}),
        ...(override.unitsPerCase !== undefined
          ? { unitsPerCase: override.unitsPerCase }
          : {}),
        ...(override.unitSize !== undefined ? { unitSize: override.unitSize } : {}),
        ...(override.uom ? { uom: override.uom } : {}),
      },
      alternatives: [],
      // The one offer there is. Populated so the row renders its supplier and
      // price through the same path as a matched line rather than a special
      // case — an empty `offers` was why the promoted row showed no price
      // column at all.
      offers: [
        {
          supplier: override.supplier,
          supplierName,
          product: override.supplierProduct ?? override.supplierSku,
          sku: override.supplierSku,
          ...(override.priceExVat !== undefined
            ? { exVatCasePrice: override.priceExVat }
            : {}),
          ...(override.ean ? { ean: override.ean } : {}),
          ...(override.imageUrl ? { imageUrl: override.imageUrl } : {}),
          ...(override.unitsPerCase !== undefined
            ? { unitsPerCase: override.unitsPerCase }
            : {}),
          ...(override.unitSize !== undefined ? { unitSize: override.unitSize } : {}),
          ...(override.uom ? { uom: override.uom } : {}),
        },
      ],
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

/**
 * The header that stops a poll counting as somebody being present.
 *
 * The backend's 30-minute inactivity timeout reads an ordinary authenticated
 * request as activity. These pages refresh on a timer while a job runs, and a
 * tab left open through a long job would otherwise keep the session alive with
 * nobody in the room.
 */
const PASSIVE = { "X-Activity": "passive" } as const;

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

export async function listJobs(opts: { passive?: boolean } = {}): Promise<JobSummary[]> {
  const res = await fetch(url("/api/jobs"), {
    headers: await authHeaders(opts.passive ? PASSIVE : {}),
  });
  if (!res.ok) throw await failure(res, `Could not load jobs (${res.status})`);
  const body = (await res.json()) as { jobs: JobSummary[] };
  return body.jobs ?? [];
}

export async function getJob(
  jobId: string,
  opts: { passive?: boolean } = {},
): Promise<JobSummary> {
  const res = await fetch(url(`/api/jobs/${jobId}`), {
    headers: await authHeaders(opts.passive ? PASSIVE : {}),
  });
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
  /**
   * The product the admin chose, as they saw it. Carried so a promoted line
   * shows a picture, a pack and a price like the matched lines beside it —
   * without these it arrived as a bare name and looked broken.
   */
  ean?: string;
  imageUrl?: string;
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  supplier?: string;
  supplierSku?: string;
  supplierProduct?: string;
  priceExVat?: number;
  reason?: string;
  createdByEmail?: string;
  createdAt?: string;
}

/**
 * What a re-check found, for one line.
 *
 * The verdict codes are the backend's, deliberately: this screen renders them
 * and the cart route enforces them, and inventing a second vocabulary here is
 * how a greyed button and a 409 end up disagreeing about why.
 */
export type VerificationResult =
  | "passed"
  | "price-decreased"
  | "price-increased"
  | "pack-changed"
  | "product-changed"
  | "price-missing"
  | "unavailable";

export interface VerificationChange {
  field: "sku" | "unitsPerCase" | "unitSize" | "uom" | "price" | "availability";
  previous?: string | number;
  next?: string | number;
}

export interface RowVerification {
  rowNumber: number;
  supplier: string;
  supplierSku: string;
  /** When the supplier was actually asked. What "fresh" is measured from. */
  verifiedAt: string;
  result: VerificationResult;
  /** Whether this clears the product for the basket. */
  passed: boolean;
  available: boolean;
  priceExVat?: number;
  previousPriceExVat?: number;
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  changes?: VerificationChange[];
  /** Set when a later edit voided this check. */
  invalidatedAt?: string;
  invalidatedReason?: string;
  /**
   * Still inside the validity window, as the BACKEND measures it.
   *
   * Sent rather than computed here on purpose. The window is backend policy,
   * and a page deciding for itself when a check expired would eventually
   * disagree with the route that enforces it — showing an enabled button over
   * a refusal.
   */
  fresh: boolean;
}

/** Why one product cannot go in the basket. Mirrors the backend's codes. */
export type CartBlockCode =
  | "verification-required"
  | "verification-stale"
  | "verification-invalidated"
  | "verification-failed"
  | "verification-other-product";

export interface JobRowsResponse {
  summary: JobSummary;
  readyToOrder: ReadyToOrderRow[];
  needsAttention: NeedsAttentionRow[];
  /** Standing admin decisions, keyed by row number. */
  overrides?: Record<number, JobRowOverride>;
  /**
   * Whether this job can still change.
   *
   * Nothing on the retailer's side edits a job, so this is not a permission —
   * it answers "is anyone still working on this". A closed job will never
   * change again, so the page can say so and stop polling for an update that
   * cannot arrive.
   */
  lock?: { locked: boolean; code?: "in-cart" | "expired"; reason?: string };
  /**
   * A SEPARATE question from `lock`, and the one that decides Add to Cart.
   *
   * A job can be perfectly open and completely unorderable: editing asks "is
   * this record still being worked on" (a day), ordering asks "are these prices
   * still real" (three hours). The page previously knew only the first, so it
   * could not explain a cart refusal it had no way to predict.
   */
  cartLock?: { locked: boolean; code?: "expired"; reason?: string };
  /**
   * The job finished more than a day ago and is kept as a record.
   *
   * AGE ALONE, and deliberately its own field rather than something this page
   * derives. `lock.code === "expired"` looks like the same question and is not:
   * `jobEditLock` reports `in-cart` before it looks at the clock, so a job whose
   * lines reached a basket reads as `in-cart` however old it is — and a page
   * deriving "older than a day" from it would show its order controls on a
   * four-day-old job.
   */
  recordOnly?: boolean;
  /** Standing verifications, keyed by row number. */
  verifications?: Record<number, RowVerification>;
}

/** Everything accumulated so far — used when opening a finished job. */
export async function getJobRows(
  jobId: string,
  opts: { passive?: boolean } = {},
): Promise<JobRowsResponse> {
  const res = await fetch(url(`/api/jobs/${jobId}/rows`), {
    headers: await authHeaders(opts.passive ? PASSIVE : {}),
  });
  if (!res.ok) throw await failure(res, `Could not load job rows (${res.status})`);
  return await res.json();
}

export interface VerifyRowsResponse {
  jobId: string;
  results: {
    rowNumber: number;
    verification?: RowVerification;
    /** Set when the line could not be checked at all, rather than failing one. */
    error?: string;
  }[];
  /** The rows now cleared for the basket. */
  verified: number[];
}

/**
 * Re-check these lines against their suppliers, now.
 *
 * Called when the retailer tries to add something from a job whose prices have
 * gone stale — never on a timer, and never for the whole job. Each row is a
 * live request to a supplier, so this is slow by nature and the caller is
 * expected to show progress rather than pretend it is instant.
 */
export async function verifyJobRows(
  jobId: string,
  rows: number[],
): Promise<VerifyRowsResponse> {
  const res = await fetch(url(`/api/jobs/${jobId}/verify`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw await failure(res, `Could not check these products (${res.status})`);
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
