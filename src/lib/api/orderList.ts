/**
 * The order list — the draft a retailer builds before anything is priced.
 *
 * Every call here is LOCAL. No supplier is contacted until `submitOrderList`,
 * which hands the reviewed lines to the same job pipeline an upload has always
 * used and returns the jobId to navigate to.
 */

import { apiFetch } from "./client";

export interface OrderListLine {
  id: number;
  /** The GTIN-14, or `epos:<article code>` — what the line is identified by. */
  lineKey: string;
  /** The barcode when known. An EPOS listing carries none. */
  gtin14?: string;
  /** The shop's own article code, for a line from an EPOS listing. */
  articleCode?: string;
  description?: string;
  /** Quantity in CASES. Always positive — removing a line is a delete. */
  cases: number;
  packRaw?: string;
  unitsPerCase?: number;
  unitSize?: number;
  /** Current cost per case. The savings baseline. */
  mainCost?: number;
  position: number;
}

export interface OrderList {
  id: string;
  status: "draft" | "submitted";
  sourceFileName?: string;
  submittedJobId?: string;
  createdAt: string;
  lines: OrderListLine[];
}

/** A CSV row whose barcode could not be read. Reported, never dropped. */
export interface SkippedRow {
  barcode: string;
  description?: string;
  reason: string;
}

export async function getOrderList(): Promise<OrderList> {
  return apiFetch<OrderList>("/api/order-list");
}

/**
 * Parse a CSV and merge it into the draft.
 *
 * Duplicate barcodes SUM rather than stacking — importing the same file twice
 * means twice the quantity, which is what merging means for an order and what
 * the retailer can undo by editing a line.
 */
export async function importOrderListCsv(
  csv: string,
  fileName?: string,
): Promise<{ list: OrderList; skipped: SkippedRow[] }> {
  return apiFetch<{ list: OrderList; skipped: SkippedRow[] }>("/api/order-list/import", {
    method: "POST",
    body: { csv, ...(fileName ? { fileName } : {}) },
  });
}

/**
 * Import an EPOS Article Order Listing — .xls, .xlsx or .csv.
 *
 * The same parser the dashboard's direct upload always used. The difference is
 * where it lands: a draft to review rather than a job already spending requests
 * at four trade accounts.
 *
 * Sent as base64 rather than multipart because the backend's existing job
 * upload takes base64, and one encoding for one file format beats two.
 */
export async function importOrderListEpos(
  fileBase64: string,
  fileName?: string,
): Promise<{ list: OrderList; skipped: SkippedRow[] }> {
  return apiFetch<{ list: OrderList; skipped: SkippedRow[] }>("/api/order-list/import-epos", {
    method: "POST",
    body: { fileBase64, ...(fileName ? { fileName } : {}) },
  });
}

export async function setOrderListCases(lineId: number, cases: number): Promise<OrderList> {
  return apiFetch<OrderList>(`/api/order-list/lines/${lineId}`, {
    method: "PATCH",
    body: { cases },
  });
}

export async function removeOrderListLine(lineId: number): Promise<OrderList> {
  return apiFetch<OrderList>(`/api/order-list/lines/${lineId}`, { method: "DELETE" });
}

/**
 * Empty the draft.
 *
 * Safe in a way clearing a supplier BASKET is not: nothing has been ordered and
 * no supplier has been told anything, so there is nothing to lose and nothing
 * to undo at the far end.
 */
export async function clearOrderList(): Promise<OrderList> {
  return apiFetch<OrderList>("/api/order-list/lines", { method: "DELETE" });
}

/**
 * Send the list for comparison.
 *
 * THIS is the moment suppliers are contacted, and the only one. Returns the
 * jobId of the run it started — the caller navigates to it.
 */
export async function submitOrderList(): Promise<{ jobId: string }> {
  return apiFetch<{ jobId: string }>("/api/order-list/submit", { method: "POST" });
}
