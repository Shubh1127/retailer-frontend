/**
 * The supplier basket panel.
 *
 * Two properties are load-bearing and everything here defends one of them:
 *
 *   1. A basket holds work this app never did. Those lines must be VISIBLE —
 *      they will be bought if the order is submitted — and must survive every
 *      removal, including one that fails half way.
 *   2. There is no way to clear a basket. Removal is scoped to a job, always,
 *      because the supplier offers no undo.
 *
 * Nothing here contacts a supplier: the API module is mocked and the polling
 * clock is injected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

const { removeJobLinesMock, removalStatusMock } = vi.hoisted(() => ({
  removeJobLinesMock: vi.fn(),
  removalStatusMock: vi.fn(),
}));

vi.mock("@/lib/api/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/cart")>();
  return { ...actual, removeJobLines: removeJobLinesMock, removalStatus: removalStatusMock };
});

const {
  SupplierBasketPanel,
  SupplierBaskets,
  SupplierBasketSkeleton,
  partitionBasket,
  pollRemoval,
  summariseRemoval,
} = await import("./SupplierBaskets");

import type { RemovalRun, SupplierBasket } from "@/lib/api/cart";

// ---------------------------------------------------------------------------

const line = (sku: string, name: string, quantity = 1) => ({
  basketItemId: `key-${sku}`,
  sku,
  name,
  quantity,
});

const basket = (lines: ReturnType<typeof line>[]): SupplierBasket =>
  ({
    isEmpty: lines.length === 0,
    lineItems: lines,
    totals: { netTotal: 0, grossTotal: 0, taxTotal: 0, currency: "EUR" },
    bySku: Object.fromEntries(lines.map((l) => [l.sku, l])),
  }) as unknown as SupplierBasket;

const run = (over: Partial<RemovalRun> = {}): RemovalRun => ({
  id: "run-1",
  jobId: "job-1",
  supplier: "kadona",
  status: "success",
  startedAt: new Date().toISOString(),
  progress: { completed: 2, total: 2 },
  report: { removed: [], failed: [], kept: [], notInBasket: [] },
  ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

describe("partitionBasket", () => {
  const BASKET = basket([
    line("3768", "Coke 500ml PK24", 4),
    line("5902", "Smarties 38g PK24"),
    line("9999", "Someone else Tayto", 2),
  ]);

  it("splits the job's lines from everything else", () => {
    const { jobLines, otherLines } = partitionBasket(BASKET, ["3768", "5902"]);

    expect(jobLines.map((l) => l.sku)).toEqual(["3768", "5902"]);
    expect(otherLines.map((l) => l.sku)).toEqual(["9999"]);
  });

  it("treats an unknown SKU as somebody else's line, never as the job's", () => {
    // The safe direction: mistaking another line for ours would offer it up
    // for removal, and there is no undo at the supplier.
    expect(partitionBasket(BASKET, []).jobLines).toEqual([]);
    expect(partitionBasket(BASKET, []).otherLines).toHaveLength(3);
  });

  it("matches SKUs regardless of case or padding", () => {
    const b = basket([line("aacV", "Coke")]);
    expect(partitionBasket(b, [" AACV "]).jobLines).toHaveLength(1);
  });

  it("copes with a basket that has not loaded yet", () => {
    expect(partitionBasket(undefined, ["A"])).toEqual({ jobLines: [], otherLines: [] });
  });
});

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

describe("pollRemoval", () => {
  const immediately = async () => {};

  it("keeps asking while the run is still going", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(run({ status: "running", progress: { completed: 1, total: 3 } }))
      .mockResolvedValueOnce(run({ status: "running", progress: { completed: 2, total: 3 } }))
      .mockResolvedValueOnce(run({ status: "success", progress: { completed: 3, total: 3 } }));

    const result = await pollRemoval(fetchStatus, { wait: immediately });

    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("success");
  });

  it("reports progress on every poll, so a bar can move", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(run({ status: "running", progress: { completed: 32, total: 64 } }))
      .mockResolvedValueOnce(run({ status: "success", progress: { completed: 64, total: 64 } }));
    const seen: string[] = [];

    await pollRemoval(fetchStatus, {
      wait: immediately,
      onProgress: (r) => seen.push(`${r.progress.completed}/${r.progress.total}`),
    });

    expect(seen).toEqual(["32/64", "64/64"]);
  });

  it("survives a dropped poll rather than calling the removal failed", async () => {
    // The work continues on the server. Reporting an error because one request
    // lost a race would tell a buyer nothing was removed while the basket was
    // being emptied behind them.
    const fetchStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(run({ status: "success" }));

    await expect(pollRemoval(fetchStatus, { wait: immediately })).resolves.toMatchObject({
      status: "success",
    });
  });

  it("gives up after three consecutive failures", async () => {
    const fetchStatus = vi.fn().mockRejectedValue(new Error("server gone"));

    await expect(pollRemoval(fetchStatus, { wait: immediately })).rejects.toThrow("server gone");
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("stops at the attempt ceiling rather than polling for ever", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(run({ status: "running" }));

    const result = await pollRemoval(fetchStatus, { wait: immediately, maxAttempts: 5 });

    expect(fetchStatus).toHaveBeenCalledTimes(5);
    expect(result.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// The summary line
// ---------------------------------------------------------------------------

describe("summariseRemoval", () => {
  it("always says how many other lines were left alone", () => {
    const summary = summariseRemoval(
      run({
        report: {
          removed: [{ sku: "A", outcome: "removed" }],
          failed: [],
          kept: [{ sku: "Z", name: "Alpen", quantity: 1 }],
          notInBasket: [],
        },
      }),
    );

    expect(summary).toContain("1 removed");
    expect(summary).toContain("1 other line left untouched");
  });

  it("names failures and already-absent lines separately", () => {
    const summary = summariseRemoval(
      run({
        status: "partial",
        report: {
          removed: [{ sku: "A", outcome: "removed" }],
          failed: [{ sku: "B", outcome: "failed", error: "refused" }],
          kept: [],
          notInBasket: ["C"],
        },
      }),
    );

    expect(summary).toContain("1 could not be removed");
    expect(summary).toContain("1 already gone");
  });
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

describe("SupplierBasketPanel", () => {
  const props = {
    supplier: "kadona" as const,
    jobId: "job-1",
    jobSkus: ["3768"],
    onRefresh: vi.fn(),
    basket: basket([
      line("3768", "Coke 500ml PK24", 4),
      line("9999", "Someone else Tayto", 2),
    ]),
  };

  it("shows pre-existing lines with name, SKU and quantity", () => {
    // Previously invisible. They will be ordered too, so the buyer has to see
    // them before submitting.
    render(<SupplierBasketPanel {...props} />);

    expect(screen.getByText(/Other existing lines/)).toBeTruthy();
    expect(screen.getByText(/Someone else Tayto/)).toBeTruthy();
    expect(screen.getByText("9999")).toBeTruthy();
    // Quantity is its own right-aligned cell now, not "×2" glued to the name.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("lays the lines out in labelled columns", () => {
    // A buyer checking a basket reads DOWN a column — is that quantity right,
    // does that total look wrong — which ragged rows make impossible. Both
    // groups use the same grid so they align with each other.
    render(<SupplierBasketPanel {...props} />);

    // One heading row per group: this job's lines, and the others.
    expect(screen.getAllByText("Product")).toHaveLength(2);
    expect(screen.getAllByText("Code")).toHaveLength(2);
    expect(screen.getAllByText("Qty")).toHaveLength(2);
    expect(screen.getAllByText("Total")).toHaveLength(2);
  });

  it("shows a line total where the supplier gave one, and a dash where it did not", () => {
    render(
      <SupplierBasketPanel
        {...props}
        jobSkus={["A"]}
        basket={
          {
            isEmpty: false,
            lineItems: [
              { basketItemId: "k1", sku: "A", name: "Priced", quantity: 2, totalPrice: 19.98 },
              { basketItemId: "k2", sku: "B", name: "Unpriced", quantity: 1 },
            ],
            totals: { netTotal: 19.98, currency: "EUR" },
            bySku: {},
          } as never
        }
      />,
    );

    expect(screen.getByText("€19.98")).toBeTruthy();
    // Never a fabricated zero: a missing figure is stated as missing.
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("puts the basket's ex-VAT total in the header", () => {
    render(<SupplierBasketPanel {...props} />);

    expect(screen.getByText(/ex-VAT/)).toBeTruthy();
  });

  it("separates this job's lines from the rest", () => {
    render(<SupplierBasketPanel {...props} />);

    expect(screen.getByText(/This job · 1/)).toBeTruthy();
    expect(screen.getByText(/Other existing lines · 1/)).toBeTruthy();
  });

  it("says the other lines will be left alone", () => {
    render(<SupplierBasketPanel {...props} />);

    expect(screen.getByText(/Removes only this job's 1\. The other 1 stay\./)).toBeTruthy();
  });

  it("offers NO clear-basket control", () => {
    // The refusal the whole feature is built on. A basket holds stock this app
    // never added and the supplier has no undo.
    render(<SupplierBasketPanel {...props} />);

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");

    expect(labels).toEqual(["Remove this job's lines"]);
    for (const forbidden of [/clear/i, /empty/i, /remove all/i, /delete all/i]) {
      expect(labels.join(" ")).not.toMatch(forbidden);
    }
  });

  it("disables removal when the job owns nothing in this basket", () => {
    render(<SupplierBasketPanel {...props} jobSkus={[]} />);

    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("polls to completion and shows the report", async () => {
    removeJobLinesMock.mockResolvedValue({ removalId: "run-1" });
    removalStatusMock
      .mockResolvedValueOnce(run({ status: "running", progress: { completed: 0, total: 1 } }))
      .mockResolvedValueOnce(
        run({
          status: "success",
          report: {
            removed: [{ sku: "3768", outcome: "removed" }],
            failed: [],
            kept: [{ sku: "9999", name: "Someone else Tayto", quantity: 2 }],
            notInBasket: [],
          },
        }),
      );

    render(<SupplierBasketPanel {...props} />);
    screen.getByRole("button").click();

    // Two polls with the component's real 1.5s interval, so this genuinely
    // exercises the wait rather than a single terminal response.
    await waitFor(() => expect(screen.getByTestId("removal-report-kadona")).toBeTruthy(), {
      timeout: 4000,
    });
    expect(screen.getByText(/1 removed/)).toBeTruthy();
    expect(screen.getByText(/Left untouched: 1 line/)).toBeTruthy();
    expect(removalStatusMock).toHaveBeenCalledTimes(2);
  });

  it("uses the EXACT supplier id, never the collapsed vendor", async () => {
    // barrygroup-ambient and barrygroup-chill are separate baskets with
    // separate delivery dates. "barrygroup" is a display label and not a basket
    // the route can act on.
    removeJobLinesMock.mockResolvedValue({ removalId: "run-1" });
    removalStatusMock.mockResolvedValue(run({ supplier: "barrygroup-ambient" }));

    render(
      <SupplierBasketPanel
        {...props}
        supplier="barrygroup-ambient"
        basket={basket([line("A1", "Ambient thing")])}
        jobSkus={["A1"]}
      />,
    );
    screen.getByRole("button").click();

    await waitFor(() => expect(removeJobLinesMock).toHaveBeenCalled());
    expect(removeJobLinesMock).toHaveBeenCalledWith("barrygroup-ambient", "job-1");
  });

  it("reports a partial removal as partial, listing what failed", async () => {
    removeJobLinesMock.mockResolvedValue({ removalId: "run-1" });
    removalStatusMock.mockResolvedValue(
      run({
        status: "partial",
        report: {
          removed: [{ sku: "3768", outcome: "removed" }],
          failed: [{ sku: "5902", name: "Smarties", outcome: "failed", error: "supplier refused" }],
          kept: [],
          notInBasket: [],
        },
      }),
    );

    render(<SupplierBasketPanel {...props} />);
    screen.getByRole("button").click();

    await waitFor(() => expect(screen.getByTestId("removal-report-kadona")).toBeTruthy());
    expect(screen.getByText(/Could not remove Smarties \(5902\)/)).toBeTruthy();
    expect(screen.getByText(/supplier refused/)).toBeTruthy();
  });

  it("surfaces a failure to start without claiming anything was removed", async () => {
    removeJobLinesMock.mockRejectedValue(new Error("A basket removal is already running"));

    render(<SupplierBasketPanel {...props} />);
    screen.getByRole("button").click();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/already running/);
    expect(screen.queryByTestId("removal-report-kadona")).toBeNull();
  });
});

describe("SupplierBaskets", () => {
  it("renders Barry's two baskets as two separate panels", () => {
    render(
      <SupplierBaskets
        jobId="job-1"
        suppliers={["barrygroup-ambient", "barrygroup-chill"]}
        baskets={{
          "barrygroup-ambient": basket([line("A1", "Ambient")]),
          "barrygroup-chill": basket([line("C1", "Chill")]),
        }}
        jobSkusBySupplier={{ "barrygroup-ambient": ["A1"], "barrygroup-chill": ["C1"] }}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId("basket-panel-barrygroup-ambient")).toBeTruthy();
    expect(screen.getByTestId("basket-panel-barrygroup-chill")).toBeTruthy();
    // Never merged into one "Barry Group" panel — that is not a basket.
    expect(screen.queryByTestId("basket-panel-barrygroup")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The loading skeleton
// ---------------------------------------------------------------------------

describe("SupplierBasketSkeleton", () => {
  it("renders a panel-shaped placeholder that animates", () => {
    const { container } = render(<SupplierBasketSkeleton />);
    const panel = screen.getByTestId("basket-panel-skeleton");

    expect(panel.className).toContain("animate-pulse");
    // Same outer shape as a real panel, so nothing reflows when data lands.
    expect(panel.className).toContain("rounded-xl");
    expect(container.querySelectorAll("div").length).toBeGreaterThan(3);
  });

  it("is hidden from screen readers, which get a status message instead", () => {
    // Eleven empty bars announced one by one is worse than silence; the page
    // pairs this with a role="status" saying it is loading.
    render(<SupplierBasketSkeleton />);

    expect(screen.getByTestId("basket-panel-skeleton").getAttribute("aria-hidden")).toBe("true");
  });

  it("offers nothing to click, so no action can fire before data exists", () => {
    render(<SupplierBasketSkeleton />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
