/**
 * The scan card.
 *
 * Scanning contacts no supplier, so the state this card spends most of its life
 * in is the one BEFORE any price exists — and the failure that matters there is
 * quiet: a catalogue price rendered as though somebody had stood behind it
 * today. The rest is the same boundary the other cards defend. The winner is
 * `line.best`, which is what the "Add to baskets" button above sends; a card
 * naming a different supplier than the one the line is ordered from is the bug
 * with a real wholesaler behind it.
 *
 * The layout is not tested and could not be: jsdom applies no Tailwind, so
 * `lg:hidden` is invisible to it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import ScanCard from "./ScanProductCard";
import type { MasterSupplierSku, ScanLine } from "@/lib/api/scan";

afterEach(cleanup);

// ---------------------------------------------------------------------------

const sku = (
  supplierId: string,
  over: Partial<MasterSupplierSku> = {},
): MasterSupplierSku => ({
  supplierId,
  supplierSku: `SKU-${supplierId}`,
  isSingle: false,
  ...over,
});

function scanLine(over: Partial<ScanLine> = {}): ScanLine {
  return {
    id: 1,
    lineKey: "l-1",
    gtin14: "05000168001234",
    scannedCode: "5000168001234",
    quantity: 1,
    position: 1,
    resolvedFrom: "master",
    product: {
      gtin14: "05000168001234",
      name: "Smarties Hexatube Std",
      sizeText: "24 × 38g",
      vendorCount: 3,
      suppliers: [
        sku("oreilly", { exVatCasePrice: 16.75, inStock: true }),
        sku("kadona", { exVatCasePrice: 17.89, inStock: true }),
        sku("musgrave", { exVatCasePrice: 21.99, inStock: false }),
      ],
    },
    best: { supplierId: "oreilly", supplierSku: "SKU-oreilly", exVatCasePrice: 16.75 },
    ...over,
  };
}

function draw(over: Partial<ScanLine> = {}) {
  const onQuantity = vi.fn();
  render(<ScanCard line={scanLine(over)} onQuantity={onQuantity} />);
  return { onQuantity };
}

// ---------------------------------------------------------------------------

describe("once prices have been fetched", () => {
  it("leads with the supplier the server chose and its price", () => {
    draw();

    expect(screen.getByText("Best price")).toBeTruthy();
    expect(screen.getByText("O'Reilly")).toBeTruthy();
    expect(screen.getByText("€16.75")).toBeTruthy();
    expect(screen.getByText("in stock")).toBeTruthy();
  });

  it("keeps the confidence signal the row carries", () => {
    draw();
    expect(screen.getByText("mapped")).toBeTruthy();

    cleanup();
    draw({ resolvedFrom: "catalogue" });
    expect(screen.getByText("catalogue")).toBeTruthy();
  });

  it("collapses the suppliers it beat", () => {
    draw();

    expect(screen.getByText(/2 other suppliers/)).toBeTruthy();
    expect(screen.queryByText("€17.89")).toBeNull();
  });

  it("opens to their prices, the gap to the winner and their stock", () => {
    draw();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Kadona")).toBeTruthy();
    expect(screen.getByText("€17.89")).toBeTruthy();
    expect(screen.getByText("+€1.14")).toBeTruthy();
    expect(screen.getByText("out of stock")).toBeTruthy();
  });

  it("says a line found by asking was not a comparison", () => {
    draw({
      liveOnly: true,
      product: undefined,
      resolvedFrom: "none",
    });

    expect(screen.getByText("Found live")).toBeTruthy();
    expect(screen.queryByText("Best price")).toBeNull();
  });
});

describe("before anybody has asked", () => {
  /**
   * A scan that has not been priced.
   *
   * The offers carry `cataloguePrice` and NOTHING else — that is what the API
   * returns until `fetchScanPrices` runs, and it is the whole reason the field
   * is separate from `exVatCasePrice`. A catalogue figure is as old as the last
   * sync and on screen is indistinguishable from a current one.
   */
  const unpriced = (): Partial<ScanLine> => ({
    best: undefined,
    product: {
      gtin14: "05000168001234",
      name: "Smarties Hexatube Std",
      vendorCount: 3,
      suppliers: [
        sku("oreilly", { cataloguePrice: 16.75 }),
        sku("kadona", { cataloguePrice: 17.89 }),
        sku("musgrave", { cataloguePrice: 21.99 }),
      ],
    },
  });

  it("shows no price rather than a catalogue one", () => {
    draw(unpriced());

    expect(screen.getByText(/No live price yet/)).toBeTruthy();
    expect(screen.queryByText("Best price")).toBeNull();
    expect(screen.queryByText("€16.75")).toBeNull();
  });

  it("still lists who stocks it, with a dash where a price will go", () => {
    draw(unpriced());

    fireEvent.click(screen.getByRole("button", { name: /3 suppliers/ }));

    expect(screen.getByText("O'Reilly")).toBeTruthy();
    // The catalogue's numbers are held, and none of them is drawn.
    expect(screen.getAllByText("—").length).toBe(3);
    expect(screen.queryByText("€17.89")).toBeNull();
  });
});

describe("stock stays a three-state field", () => {
  it("prints nothing when the winning supplier said nothing", () => {
    const line = scanLine();
    line.product!.suppliers = line.product!.suppliers.map((offer) =>
      offer.supplierId === "oreilly" ? { ...offer, inStock: undefined } : offer,
    );

    render(<ScanCard line={line} onQuantity={vi.fn()} />);

    expect(screen.queryByText("in stock")).toBeNull();
    expect(screen.queryByText("out of stock")).toBeNull();
  });
});

describe("the list itself", () => {
  it("stays wired to the page's own quantity handler", () => {
    const { onQuantity } = draw({ quantity: 3 });

    fireEvent.click(screen.getByLabelText("Increase 5000168001234"));
    expect(onQuantity).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByLabelText("Decrease 5000168001234"));
    expect(onQuantity).toHaveBeenCalledWith(2);
  });

  it("offers a bin rather than a minus at one, so removal is deliberate", () => {
    draw({ quantity: 1 });
    expect(screen.getByLabelText("Decrease 5000168001234").textContent).toBe("🗑");
  });

  it("says when a line is already on a real order", () => {
    draw({ addedToBasket: true, addedSupplierId: "oreilly" });
    expect(screen.getByText(/In O'Reilly basket/)).toBeTruthy();
  });

  it("says nothing about baskets when nothing has been sent", () => {
    draw();
    expect(screen.queryByText(/basket/)).toBeNull();
  });
});
