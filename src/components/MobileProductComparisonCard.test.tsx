/**
 * What the phone card must never get wrong.
 *
 * The card is a second PRESENTATION of a decision, not a second decision, and
 * every test here is about that boundary. The dangerous failures are not visual:
 * a card that names a different winner than the table, an Add button pointing at
 * a supplier the pipeline did not choose, or an Add button at all on a line
 * already sent — each of those buys something at a real wholesaler.
 *
 * The layout itself is not tested and could not be: jsdom applies no Tailwind,
 * so `lg:hidden` is invisible to it. What IS pinned is that the card and the
 * table read the same fields.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import MobileProductComparisonCard from "./MobileProductComparisonCard";
import type { CartState } from "./Cart";
import type { SupplierColumn } from "./SupplierPrices";
import type { DashboardOffer, ReadyToOrderRow } from "@/lib/api/jobs";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COLUMNS: SupplierColumn[] = [
  { id: "kadona", name: "Kadona" },
  { id: "musgrave", name: "Musgrave" },
  { id: "oreilly", name: "O'Reilly" },
];

const offer = (over: Partial<DashboardOffer> & { supplier: string }): DashboardOffer => ({
  supplierName: over.supplier,
  product: "Smarties Hexatube Std",
  sku: "035885",
  ...over,
});

function readyRow(over: Partial<ReadyToOrderRow> = {}): ReadyToOrderRow {
  return {
    kind: "ready",
    row: 7,
    articleCode: "A-7",
    product: "SMARTIES HEXATUBE",
    bestSupplier: "oreilly",
    bestSupplierName: "O'Reilly",
    price: 16.75,
    cases: 1,
    savings: 4.45,
    savingsPct: 0.21,
    baselineCost: 21.2,
    costDelta: 4.45,
    savingsStatus: "saving",
    addedToCart: "No",
    warnings: [],
    detail: {
      requestedProduct: "SMARTIES HEXATUBE",
      selected: offer({ supplier: "oreilly", exVatCasePrice: 16.75, inStock: true }),
      alternatives: [],
      offers: [
        offer({ supplier: "oreilly", exVatCasePrice: 16.75, inStock: true }),
        offer({ supplier: "kadona", exVatCasePrice: 17.89, inStock: true }),
        offer({ supplier: "musgrave", exVatCasePrice: 21.99, inStock: false }),
      ],
    },
    ...over,
  };
}

/** A cart that is connected, holds nothing, and records what it is asked to do. */
function cartStub(over: Partial<CartState> = {}): CartState {
  return {
    baskets: {},
    isLoading: false,
    errors: {},
    status: { oreilly: "ready", musgrave: "ready", kadona: "ready" },
    busyKey: null,
    refresh: vi.fn(),
    changeQuantity: vi.fn(),
    addOne: vi.fn(),
    lineFor: () => undefined,
    needsVerification: {},
    clearVerificationBlock: vi.fn(),
    ...over,
  } as CartState;
}

function draw(
  props: Partial<React.ComponentProps<typeof MobileProductComparisonCard>> = {},
) {
  const onQuantityChange = vi.fn();
  render(
    <MobileProductComparisonCard
      row={readyRow()}
      cart={cartStub()}
      columns={COLUMNS}
      onQuantityChange={onQuantityChange}
      {...props}
    />,
  );
  return { onQuantityChange };
}

// ---------------------------------------------------------------------------

describe("the winner is the headline", () => {
  it("leads with the supplier the pipeline chose and its price", () => {
    draw();

    expect(screen.getByText("Best price")).toBeTruthy();
    expect(screen.getByText("O'Reilly")).toBeTruthy();
    expect(screen.getByText("€16.75")).toBeTruthy();
  });

  it("shows the order line and the product matched to it", () => {
    draw();

    expect(screen.getByText("SMARTIES HEXATUBE")).toBeTruthy();
    expect(screen.getByText("Smarties Hexatube Std")).toBeTruthy();
    expect(screen.getByText(/SKU 035885/)).toBeTruthy();
  });

  it("puts the saving beside the winning price rather than in a column", () => {
    draw();
    expect(screen.getByText(/Save €4\.45/)).toBeTruthy();
  });

  it("says so when a supplier beats nothing, rather than staying silent", () => {
    draw({
      row: readyRow({
        savingsStatus: "no-saving",
        savings: undefined,
        savingsPct: undefined,
        costDelta: -1.2,
      }),
    });

    expect(screen.getByText(/No saving/)).toBeTruthy();
  });

  it("claims no saving at all when the file carried no cost", () => {
    draw({
      row: readyRow({
        savingsStatus: "no-baseline",
        savings: undefined,
        savingsPct: undefined,
        baselineCost: undefined,
        costDelta: undefined,
      }),
    });

    expect(screen.queryByText(/Save /)).toBeNull();
    expect(screen.queryByText(/No saving/)).toBeNull();
  });
});

describe("stock stays a three-state field", () => {
  it("prints what the winning supplier said", () => {
    draw();
    expect(screen.getByText("in stock")).toBeTruthy();
  });

  it("prints NOTHING when the supplier said nothing", () => {
    const row = readyRow();
    row.detail.offers = row.detail.offers.map((entry) =>
      entry.supplier === "oreilly" ? { ...entry, inStock: undefined } : entry,
    );

    draw({ row });

    expect(screen.queryByText("in stock")).toBeNull();
    expect(screen.queryByText("out of stock")).toBeNull();
  });
});

describe("the losing quotes are folded away", () => {
  it("collapses them behind one line by default", () => {
    draw();

    expect(screen.getByText(/2 other suppliers/)).toBeTruthy();
    expect(screen.queryByText("€17.89")).toBeNull();
    expect(screen.queryByText("€21.99")).toBeNull();
  });

  it("opens to the other suppliers, their stock and the gap to the winner", () => {
    draw();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Kadona")).toBeTruthy();
    expect(screen.getByText("€17.89")).toBeTruthy();
    // €17.89 − €16.75, the same subtraction the table's column prints.
    expect(screen.getByText("+€1.14")).toBeTruthy();
    // A supplier who said they cannot supply it still says so here.
    expect(screen.getByText("out of stock")).toBeTruthy();
  });

  it("offers nothing to open when the winner is the only supplier", () => {
    const row = readyRow();
    row.detail.offers = row.detail.offers.filter((entry) => entry.supplier === "oreilly");

    draw({ row, columns: [{ id: "oreilly", name: "O'Reilly" }] });

    expect(screen.queryByText(/other supplier/)).toBeNull();
  });
});

describe("adding", () => {
  it("names the winning supplier as the destination", () => {
    draw();
    expect(screen.getByRole("button", { name: /Add to O'Reilly/ })).toBeTruthy();
  });

  it("sends the drafted quantity to the winner's basket", () => {
    const addOne = vi.fn();
    draw({ cart: cartStub({ addOne }), quantity: 3 });

    fireEvent.click(screen.getByRole("button", { name: /Add 3 to O'Reilly/ }));

    expect(addOne).toHaveBeenCalledWith("oreilly", "035885", 3, "SMARTIES HEXATUBE");
  });

  it("offers no Add button once the line is in the basket", () => {
    draw({
      cart: cartStub({
        lineFor: (supplier, sku) =>
          supplier === "oreilly" && sku === "035885"
            ? { basketItemId: "b1", sku, name: "Smarties", quantity: 2 }
            : undefined,
      }),
    });

    expect(screen.getByText(/In O'Reilly basket/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
  });

  it("will not add into a basket it could not read", () => {
    draw({ cart: cartStub({ status: { oreilly: "unavailable" } }) });

    const button = screen.getByRole("button", { name: /Unavailable/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why a line cannot be ordered rather than showing a bare dash", () => {
    const row = readyRow();
    row.detail.selected = offer({ supplier: "oreilly", sku: undefined });

    draw({ row });

    expect(screen.getByText(/no supplier product code/)).toBeTruthy();
  });
});

describe("quantity", () => {
  it("stays wired to the page's own draft handler", () => {
    const { onQuantityChange } = draw({ quantity: 2 });

    fireEvent.click(screen.getByLabelText("Increase quantity of SMARTIES HEXATUBE"));
    expect(onQuantityChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByLabelText("Decrease quantity of SMARTIES HEXATUBE"));
    expect(onQuantityChange).toHaveBeenCalledWith(1);
  });

  it("shows the quantity the buyer drafted", () => {
    draw({ quantity: 4 });
    expect(screen.getByText("4")).toBeTruthy();
  });
});
