/**
 * The search table's phone card.
 *
 * SCOPED TO THE CARD, deliberately. jsdom applies no Tailwind, so `lg:hidden`
 * does nothing and BOTH layouts render into the same document — which is
 * exactly the property worth testing against. Every query below runs inside the
 * card's own `article`, so a passing assertion is a statement about the card
 * and not about the table that happens to be sitting beside it.
 *
 * What is pinned is the boundary: the card must show the winner
 * `withWinner` chose, must not offer to add anything before prices have been
 * fetched, and must point Add at that winner's basket rather than at a supplier
 * of its own choosing.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { fetchBasketAddsMock, addItemsMock, onboardingMock, fetchPricesMock } = vi.hoisted(() => ({
  fetchBasketAddsMock: vi.fn(),
  addItemsMock: vi.fn(),
  onboardingMock: vi.fn(),
  fetchPricesMock: vi.fn(),
}));

vi.mock("@/lib/api/supplierCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/supplierCredentials")>();
  return { ...actual, getOnboardingState: onboardingMock };
});

vi.mock("@/lib/api/endpoint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoint")>();
  return { ...actual, fetchLivePrices: fetchPricesMock };
});

vi.mock("@/lib/api/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/cart")>();
  return { ...actual, fetchBasketAdds: fetchBasketAddsMock, addItems: addItemsMock };
});

const ProductPriceTable = (await import("./ProductPriceTable")).default;

import type { SupplierSearchProduct } from "@/lib/api/endpoint";

afterEach(() => {
  cleanup();
  fetchBasketAddsMock.mockReset();
  addItemsMock.mockReset();
  fetchPricesMock.mockReset();
});

beforeEach(() => {
  // Connected by default; the gate tests below override it.
  onboardingMock.mockReset().mockResolvedValue({
    firstLogin: false,
    hasConnectedSuppliers: true,
    connectedCount: 1,
    connectable: [],
  });
});

// ---------------------------------------------------------------------------

/**
 * A listing carrying a LIVE price.
 *
 * `repriced` is what makes it one. A catalogue price is as old as the last sync
 * and cannot win a line, so without this flag every card would correctly show
 * no winner at all and none of these tests would be about anything.
 */
const listing = (
  supplier: string,
  price: number,
  over: Partial<SupplierSearchProduct> = {},
): SupplierSearchProduct => ({
  supplier,
  name: "Smarties Hexatube Std",
  sku: `SKU-${supplier}`,
  ean: "5000168001234",
  exVatCasePrice: price,
  repriced: true,
  ...over,
});

const PRODUCTS: SupplierSearchProduct[] = [
  listing("oreilly", 16.75, { inStock: true }),
  listing("kadona", 17.89, { inStock: true }),
  listing("musgrave", 21.99, { inStock: false }),
];

async function drawCard(products: SupplierSearchProduct[] = PRODUCTS) {
  fetchBasketAddsMock.mockResolvedValue([]);
  render(<ProductPriceTable products={products} />);
  // Both layouts render; everything below is scoped to the card.
  return await screen.findByRole("article", { name: "Smarties Hexatube Std" });
}

// ---------------------------------------------------------------------------

describe("the search card leads with the winner", () => {
  it("shows the cheapest in-stock supplier and its price", async () => {
    const card = await drawCard();

    expect(within(card).getByText("Best price")).toBeTruthy();
    expect(within(card).getByText("O'Reilly")).toBeTruthy();
    expect(within(card).getByText("€16.75")).toBeTruthy();
  });

  it("does not let a supplier who said they are out of stock win", async () => {
    const card = await drawCard([
      listing("musgrave", 9.99, { inStock: false }),
      listing("oreilly", 16.75, { inStock: true }),
    ]);

    // The cheaper number is Musgrave's, and it is still shown — but the line is
    // O'Reilly's, because Musgrave said they cannot fill it.
    expect(within(card).getByText("O'Reilly")).toBeTruthy();
    expect(within(card).getByText("€16.75")).toBeTruthy();
  });

  it("offers nothing to order before any supplier has been contacted", async () => {
    const card = await drawCard([
      listing("oreilly", 16.75, { repriced: false }),
      listing("kadona", 17.89, { repriced: false }),
    ]);

    expect(within(card).getByText(/No live price yet/)).toBeTruthy();
    const add = within(card).getByRole("button", { name: /Add/ });
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the losing quotes are folded away", () => {
  it("collapses them by default", async () => {
    const card = await drawCard();

    expect(within(card).getByText(/2 other suppliers/)).toBeTruthy();
    expect(within(card).queryByText("€17.89")).toBeNull();
  });

  it("opens to the other suppliers, their stock and the gap to the winner", async () => {
    const card = await drawCard();

    fireEvent.click(within(card).getByRole("button", { expanded: false }));

    expect(within(card).getByText("Kadona")).toBeTruthy();
    expect(within(card).getByText("€17.89")).toBeTruthy();
    expect(within(card).getByText("+€1.14")).toBeTruthy();
    expect(within(card).getByText("out of stock")).toBeTruthy();
  });
});

describe("adding from the card", () => {
  it("names the winner as the destination and sends the line there", async () => {
    addItemsMock.mockResolvedValue({ results: [{ outcome: "added" }] });
    const card = await drawCard();

    fireEvent.click(within(card).getByLabelText("Increase Smarties Hexatube Std"));
    fireEvent.click(within(card).getByRole("button", { name: /Add to O'Reilly/ }));

    await waitFor(() =>
      expect(addItemsMock).toHaveBeenCalledWith(
        [{ sku: "SKU-oreilly", quantity: 2, name: "Smarties Hexatube Std" }],
        "oreilly",
      ),
    );
  });

  it("replaces the button with a status once the line is on an order", async () => {
    fetchBasketAddsMock.mockResolvedValue([
      { supplierId: "oreilly", sku: "SKU-oreilly", quantity: 2 },
    ]);
    render(<ProductPriceTable products={PRODUCTS} />);

    const card = await screen.findByRole("article", { name: "Smarties Hexatube Std" });

    await waitFor(() =>
      expect(within(card).getByText(/added to O'Reilly/)).toBeTruthy(),
    );
    expect(within(card).queryByRole("button", { name: /Add to/ })).toBeNull();
  });
});

describe("fetching live prices needs a connected account", () => {
  /**
   * THE REGRESSION THIS PINS.
   *
   * Scanning and sending an order list were gated; this third door into
   * supplier contact was not. A retailer with nothing connected pressed Fetch
   * live prices, waited, and was told every supplier was "unavailable" — which
   * states the wholesaler could not be reached and explicitly says nothing
   * about stock, so it pointed away from the one thing they could fix.
   */
  it("stops the fetch and explains why when nothing is connected", async () => {
    onboardingMock.mockResolvedValue({
      firstLogin: false,
      hasConnectedSuppliers: false,
      connectedCount: 0,
      connectable: [],
    });
    fetchBasketAddsMock.mockResolvedValue([]);

    render(<ProductPriceTable products={PRODUCTS} />);
    await screen.findByRole("article", { name: "Smarties Hexatube Std" });

    fireEvent.click(screen.getAllByRole("button", { name: /fetch live prices/i })[0]!);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/connect a supplier account first/i)).toBeTruthy();
    // No supplier is contacted at all.
    expect(fetchPricesMock).not.toHaveBeenCalled();
  });

  it("fetches normally once an account is connected", async () => {
    fetchBasketAddsMock.mockResolvedValue([]);
    fetchPricesMock.mockResolvedValue({ prices: [], pricedAt: new Date().toISOString() });

    render(<ProductPriceTable products={PRODUCTS} />);
    await screen.findByRole("article", { name: "Smarties Hexatube Std" });

    fireEvent.click(screen.getAllByRole("button", { name: /fetch live prices/i })[0]!);

    await waitFor(() => expect(fetchPricesMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
