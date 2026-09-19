/**
 * The mobile order cart.
 *
 * WHAT IS WORTH TESTING HERE is not that the list renders — it is the three
 * places where this component can quietly tell a retailer something untrue:
 *
 *   1. SEARCH SCOPE. The whole reason this view loads the cart unpaginated is
 *      so that searching finds a product on "page 9". A regression that
 *      reintroduces pagination would make the search answer "nothing matches"
 *      for a product that is sitting in the cart, which is worse than having no
 *      search at all. So the load is asserted to ask for no page.
 *
 *   2. REMOVAL IS CONFIRMED, AND REMOVES THE RIGHT LINE. Deleting the wrong
 *      line from a 200-line order is invisible until the delivery arrives.
 *
 *   3. "NOT PRICED" MEANS NOT PRICED. The chip and the filter both read from
 *      the same fact, and a line with no `pricedAt` must never read as priced.
 *
 * The layout is not tested and could not be: jsdom applies no Tailwind, so
 * `lg:hidden` and every responsive class is invisible to it.
 *
 * ABSENCE IS ALWAYS AWAITED. Rows live inside an `AnimatePresence`, so a line
 * that stops matching a filter is still mounted while its exit animation plays.
 * Asserting `queryByText(...)` synchronously right after a keystroke tests the
 * animation's timing rather than the filter, and passes or fails accordingly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { OrderList, OrderListLine, PricedCartLine } from "@/lib/api/orderList";

// ---------------------------------------------------------------------------
// The module boundary. This component's whole job is orchestration, so the API
// is mocked and the assertions are about which calls it makes and when.

const getOrderList = vi.fn();
const removeOrderListLine = vi.fn();
const setOrderListCases = vi.fn();
const clearOrderList = vi.fn();
const compareOrderCart = vi.fn();
const fetchOrderCartPrices = vi.fn();
const enrichOrderCartLines = vi.fn();

vi.mock("@/lib/api/orderList", () => ({
  getOrderList: (...args: unknown[]) => getOrderList(...args),
  removeOrderListLine: (...args: unknown[]) => removeOrderListLine(...args),
  setOrderListCases: (...args: unknown[]) => setOrderListCases(...args),
  clearOrderList: (...args: unknown[]) => clearOrderList(...args),
  compareOrderCart: (...args: unknown[]) => compareOrderCart(...args),
  fetchOrderCartPrices: (...args: unknown[]) => fetchOrderCartPrices(...args),
  enrichOrderCartLines: (...args: unknown[]) => enrichOrderCartLines(...args),
  importOrderListCsv: vi.fn(),
  importOrderListEpos: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The supplier gate opens a modal of its own and talks to the API; neither is
// what these tests are about.
vi.mock("@/components/SupplierGate", () => ({
  useSupplierGate: () => ({ guard: () => true, modal: null }),
}));

import MobileOrderCart from "./MobileOrderCart";

// ---------------------------------------------------------------------------

function line(over: Partial<OrderListLine> = {}): OrderListLine {
  return {
    id: 1,
    lineKey: "l-1",
    gtin14: "05024996619997",
    description: "SMARTIES HEXATUBE",
    cases: 1,
    position: 1,
    sources: [{ source: "order_list", firstSeenAt: "2026-09-01T09:00:00.000Z" }],
    ...over,
  } as OrderListLine;
}

function cart(lines: OrderListLine[], pricing?: PricedCartLine[]): OrderList {
  return {
    id: "cart-1",
    status: "draft",
    createdAt: "2026-09-01T09:00:00.000Z",
    lines,
    ...(pricing ? { pricing } : {}),
  } as OrderList;
}

const THREE = [
  line({ id: 1, description: "SMARTIES HEXATUBE", gtin14: "05024996619997" }),
  line({
    id: 2,
    description: "NUTELLA & GO CASE",
    gtin14: "05020411121182",
    cases: 2,
    sources: [{ source: "scan", firstSeenAt: "2026-09-02T09:00:00.000Z" }],
  }),
  line({ id: 3, description: "M&M'S CRISPY", gtin14: "05000159561624" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  /**
   * The cart and its pictures are remembered in this tab's sessionStorage so a
   * navigation does not refetch them. jsdom keeps ONE storage for the whole
   * file, so without this each test would start holding the previous test's
   * cart — and the loading test, which asserts a skeleton, would never see one.
   */
  window.sessionStorage.clear();
  getOrderList.mockResolvedValue(cart(THREE));
  enrichOrderCartLines.mockResolvedValue([]);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("the mobile order cart", () => {
  it("loads the WHOLE cart, so search and the counts cover every line", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    // The guarantee: no `page`, no `pageSize`. The server returns everything
    // when it is not asked to paginate.
    const [args] = getOrderList.mock.calls[0] as [Record<string, unknown> | undefined];
    expect(args?.page).toBeUndefined();
    expect(args?.pageSize).toBeUndefined();
  });

  it("searches the cart rather than what is on screen", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.change(screen.getByLabelText(/search products/i), {
      target: { value: "nutella" },
    });

    expect(screen.getByText("NUTELLA & GO CASE")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("SMARTIES HEXATUBE")).toBeNull());
    expect(screen.queryByText("M&M'S CRISPY")).toBeNull();
  });

  it("finds a product by barcode, which is what a scanner types", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.change(screen.getByLabelText(/search products/i), {
      target: { value: "05000159561624" },
    });

    expect(screen.getByText("M&M'S CRISPY")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("SMARTIES HEXATUBE")).toBeNull());
  });

  it("says nothing matches, naming what was searched for", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.change(screen.getByLabelText(/search products/i), {
      target: { value: "zzzz" },
    });

    expect(screen.getByText("Nothing matches")).toBeDefined();
    expect(screen.getByText(/zzzz/)).toBeDefined();
  });

  it("filters by where a line came from", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.click(screen.getByRole("button", { name: /^Scan/ }));

    expect(screen.getByText("NUTELLA & GO CASE")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("SMARTIES HEXATUBE")).toBeNull());
  });

  it("counts an unpriced line as unpriced, and a priced one as priced", async () => {
    getOrderList.mockResolvedValue(
      cart(THREE, [
        {
          lineId: 1,
          offers: [
            { supplierId: "musgrave", supplierSku: "M-1", exVatCasePrice: 21.99, repriced: true },
          ],
          pricedAt: "2026-09-19T10:30:00.000Z",
          priceable: true,
        } as PricedCartLine,
      ]),
    );

    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    // Two of the three have never been priced. Scoped to the list, because
    // "Not priced" is also the name of the filter chip above it.
    const list = screen.getByRole("list");
    expect(within(list).getAllByText("Not priced")).toHaveLength(2);
    expect(within(list).getByText(/Priced/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^Not priced/ }));
    await waitFor(() => expect(screen.queryByText("SMARTIES HEXATUBE")).toBeNull());
    expect(screen.getByText("NUTELLA & GO CASE")).toBeDefined();
  });

  it("asks before removing, names the product, and removes THAT line", async () => {
    removeOrderListLine.mockResolvedValue(cart([THREE[1]!, THREE[2]!]));

    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    // Open the second product's sheet, then its bin.
    fireEvent.click(screen.getByRole("button", { name: /Open NUTELLA & GO CASE/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Remove NUTELLA & GO CASE/ }));

    const dialog = await screen.findByRole("dialog", { name: /remove this item/i });
    expect(within(dialog).getByText(/NUTELLA & GO CASE/)).toBeDefined();

    // Nothing has been removed just by asking.
    expect(removeOrderListLine).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(removeOrderListLine).toHaveBeenCalledWith(2));
    expect(removeOrderListLine).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation removes nothing", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.click(screen.getByRole("button", { name: /Open SMARTIES HEXATUBE/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Remove SMARTIES HEXATUBE/ }));

    const dialog = await screen.findByRole("dialog", { name: /remove this item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Named, because the product SHEET is a dialog too and stays open behind
    // the confirmation — cancelling a removal returns you to the product, it
    // does not close everything.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /remove this item/i })).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: /SMARTIES HEXATUBE/ })).toBeDefined();
    expect(removeOrderListLine).not.toHaveBeenCalled();
  });

  it("removes every selected line, and each exactly once", async () => {
    removeOrderListLine.mockResolvedValue(cart([THREE[2]!]));

    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: /Select SMARTIES HEXATUBE/ }));
    fireEvent.click(screen.getByRole("button", { name: /Select NUTELLA & GO CASE/ }));

    expect(screen.getByText("2 selected")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Delete (2)" }));
    const dialog = await screen.findByRole("dialog", { name: /remove 2 items/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(removeOrderListLine).toHaveBeenCalledTimes(2));
    expect(removeOrderListLine.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
  });

  it("a quantity change is written once, with the value last asked for", async () => {
    vi.useFakeTimers();
    setOrderListCases.mockResolvedValue(cart(THREE));

    try {
      render(<MobileOrderCart />);
      await vi.waitFor(() => expect(screen.getByText("SMARTIES HEXATUBE")).toBeDefined());

      fireEvent.click(screen.getByRole("button", { name: /Open SMARTIES HEXATUBE/ }));
      const more = await vi.waitFor(() => screen.getByRole("button", { name: "More cases" }));

      // Four taps in a row — a thumb on a stepper, not four decisions.
      fireEvent.click(more);
      fireEvent.click(more);
      fireEvent.click(more);
      fireEvent.click(more);

      // Still nothing written: the run is still being collected.
      expect(setOrderListCases).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);

      expect(setOrderListCases).toHaveBeenCalledTimes(1);
      expect(setOrderListCases).toHaveBeenCalledWith(1, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a way in when the cart is empty", async () => {
    getOrderList.mockResolvedValue(cart([]));

    render(<MobileOrderCart />);

    expect(await screen.findByText("Your cart is empty")).toBeDefined();
    expect(screen.getByRole("link", { name: /scan products/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /import file/i })).toBeDefined();

    // No search box over nothing, and no price buttons over nothing.
    expect(screen.queryByLabelText(/search products/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /compare prices/i })).toBeNull();
  });

  it("shows the shape of the cart while it loads, not the word loading", async () => {
    let release: (value: OrderList) => void = () => {};
    getOrderList.mockReturnValue(new Promise<OrderList>((resolve) => { release = resolve; }));

    const { container } = render(<MobileOrderCart />);

    // Announced once, for a screen reader, while the bars carry the eye.
    expect(screen.getByRole("status").textContent).toMatch(/loading your cart/i);
    // The placeholder is decoration and must not be read out as content.
    const skeleton = container.querySelector('[aria-hidden="true"].animate-pulse');
    expect(skeleton).not.toBeNull();
    // Nothing pretends to be a product yet.
    expect(screen.queryByRole("list")).toBeNull();

    release(cart(THREE));

    await screen.findByText("SMARTIES HEXATUBE");
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ── Loading: the order first, the pictures after ────────────────────────
  //
  // Enrichment costs a catalogue round trip per barcode and a local catalogue
  // search per barcode-less EPOS line. Putting that in front of the cart meant
  // a retailer waited on a few hundred lookups to see an order they had
  // already saved. These four tests are the guarantee that it stays behind.

  it("asks for the order WITHOUT the pictures", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    const [args] = getOrderList.mock.calls[0] as [Record<string, unknown>];
    expect(args.enrich).toBe("none");
  });

  it("fetches the pictures afterwards and merges them in", async () => {
    enrichOrderCartLines.mockResolvedValue([
      { lineId: 2, imageUrl: "https://example.test/nutella.jpg", sizeText: "12 x 48" },
    ]);

    const { container } = render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    await waitFor(() => expect(enrichOrderCartLines).toHaveBeenCalledWith([1, 2, 3]));

    // The picture and the pack text both land on the line they belong to.
    await waitFor(() =>
      expect(container.querySelector('img[src="https://example.test/nutella.jpg"]')).not.toBeNull(),
    );
    expect(screen.getByText("12 x 48")).toBeDefined();

    // And only that line — the other two are still without a picture.
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("asks in batches, in list order, so the top of the screen fills first", async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      line({ id: index + 1, description: `PRODUCT ${index + 1}`, gtin14: `0500000000${index}` }),
    );
    getOrderList.mockResolvedValue(cart(many));

    render(<MobileOrderCart />);
    await screen.findByText("PRODUCT 1");

    // 50 is the server's cap; it refuses more rather than truncating.
    await waitFor(() => expect(enrichOrderCartLines).toHaveBeenCalledTimes(2));

    const [first] = enrichOrderCartLines.mock.calls[0] as [number[]];
    const [second] = enrichOrderCartLines.mock.calls[1] as [number[]];
    expect(first).toHaveLength(50);
    expect(first[0]).toBe(1);
    expect(second).toHaveLength(10);
    expect(second[0]).toBe(51);
  });

  it("a quantity change does not throw away the pictures already shown", async () => {
    enrichOrderCartLines.mockResolvedValue([
      { lineId: 1, imageUrl: "https://example.test/smarties.jpg" },
    ]);
    // The server answers a write WITHOUT enrichment now — the reply carries no
    // image at all. The picture must survive it.
    setOrderListCases.mockResolvedValue(cart(THREE));

    vi.useFakeTimers();
    try {
      const { container } = render(<MobileOrderCart />);
      await vi.waitFor(() => expect(screen.getByText("SMARTIES HEXATUBE")).toBeDefined());
      await vi.waitFor(() =>
        expect(container.querySelector('img[src="https://example.test/smarties.jpg"]')).not.toBeNull(),
      );

      fireEvent.click(screen.getByRole("button", { name: /Open SMARTIES HEXATUBE/ }));
      fireEvent.click(await vi.waitFor(() => screen.getByRole("button", { name: "More cases" })));
      await vi.advanceTimersByTimeAsync(500);

      expect(setOrderListCases).toHaveBeenCalled();
      expect(
        container.querySelector('img[src="https://example.test/smarties.jpg"]'),
      ).not.toBeNull();
      // And it does not re-ask for a picture it already has.
      expect(enrichOrderCartLines).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still shows the cart when the pictures cannot be fetched", async () => {
    enrichOrderCartLines.mockRejectedValue(new Error("catalogue down"));

    render(<MobileOrderCart />);

    expect(await screen.findByText("SMARTIES HEXATUBE")).toBeDefined();
    await waitFor(() => expect(enrichOrderCartLines).toHaveBeenCalled());
    // No error surfaced: a missing picture is not a broken cart.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("NUTELLA & GO CASE")).toBeDefined();
  });

  it("shows how much of the cart is in view, and offers no pricing", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.change(screen.getByLabelText(/search products/i), {
      target: { value: "nutella" },
    });

    // The count admits the filter rather than implying the cart is one line.
    expect(screen.getByText(/1 of 3 products match/)).toBeDefined();

    /**
     * NO PRICING FROM A PHONE. Both calls contact suppliers and belong at the
     * desk; they are removed rather than disabled, so there is no control here
     * at all — see the component's header.
     */
    expect(screen.queryByRole("button", { name: /compare prices/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /fetch live prices/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Does a picture survive leaving the page? This is the whole claim of the
// session cache, tested the way the user hits it: mount, let it settle,
// unmount (a navigation), mount again.

describe("coming back to the cart", () => {
  it("still has the pictures, and does not ask for them again", async () => {
    enrichOrderCartLines.mockResolvedValue([
      { lineId: 1, imageUrl: "https://example.test/smarties.jpg" },
      { lineId: 2 },
      { lineId: 3 },
    ]);

    const first = render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");
    await waitFor(() =>
      expect(
        first.container.querySelector('img[src="https://example.test/smarties.jpg"]'),
      ).not.toBeNull(),
    );
    expect(enrichOrderCartLines).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = render(<MobileOrderCart />);
    // On the FIRST render back — before any request could have resolved.
    expect(
      second.container.querySelector('img[src="https://example.test/smarties.jpg"]'),
    ).not.toBeNull();
    expect(enrichOrderCartLines).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Ten to a page — sliced after filtering, never asked for a page at a time.
// The distinction is the whole point: a paginated REQUEST would make the search
// answer "nothing matches" for a product sitting on page nine.

describe("ten products to a page", () => {
  const MANY = Array.from({ length: 25 }, (_, index) =>
    line({
      id: index + 1,
      description: `PRODUCT ${String(index + 1).padStart(2, "0")}`,
      gtin14: `05000000000${index}`,
    }),
  );

  it("shows ten, and says which ten", async () => {
    getOrderList.mockResolvedValue(cart(MANY));
    render(<MobileOrderCart />);
    await screen.findByText("PRODUCT 01");

    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("PRODUCT 10")).toBeDefined();
    expect(screen.queryByText("PRODUCT 11")).toBeNull();
    expect(screen.getByText("1–10")).toBeDefined();
    expect(screen.getByText("of 25")).toBeDefined();
  });

  it("moves through the pages", async () => {
    getOrderList.mockResolvedValue(cart(MANY));
    render(<MobileOrderCart />);
    await screen.findByText("PRODUCT 01");

    expect(screen.getByRole("button", { name: /Prev/ }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("PRODUCT 11")).toBeDefined();
    expect(screen.queryByText("PRODUCT 01")).toBeNull();

    // The last page is short, and Next stops there.
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("PRODUCT 25")).toBeDefined();
    expect(screen.getByRole("button", { name: /Next/ }).hasAttribute("disabled")).toBe(true);
  });

  it("offers no pager when everything fits on one page", async () => {
    getOrderList.mockResolvedValue(cart(THREE));
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    // A control that can only be disabled is furniture.
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
  });

  it("SEARCHES EVERY PAGE, not the ten on screen", async () => {
    getOrderList.mockResolvedValue(cart(MANY));
    render(<MobileOrderCart />);
    await screen.findByText("PRODUCT 01");

    // PRODUCT 23 is on page three and has never been rendered.
    fireEvent.change(screen.getByLabelText(/search products/i), {
      target: { value: "PRODUCT 23" },
    });

    expect(screen.getByText("PRODUCT 23")).toBeDefined();
    expect(screen.queryByText("PRODUCT 01")).toBeNull();
  });

  it("returns to page one when the search changes", async () => {
    getOrderList.mockResolvedValue(cart(MANY));
    render(<MobileOrderCart />);
    await screen.findByText("PRODUCT 01");

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("PRODUCT 11")).toBeDefined();

    // Searching from page two must not land on page two of the new results.
    fireEvent.change(screen.getByLabelText(/search products/i), {
      target: { value: "PRODUCT" },
    });

    await waitFor(() => expect(screen.getByText("PRODUCT 01")).toBeDefined());
    expect(screen.getByText("1–10")).toBeDefined();
  });

  it("counts the whole cart on the chips, not the page", async () => {
    getOrderList.mockResolvedValue(cart(MANY));
    render(<MobileOrderCart />);
    await screen.findByText("PRODUCT 01");

    // 25 unpriced, though only ten are rendered.
    expect(screen.getByRole("button", { name: /^All 25/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Not priced 25/ })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe("emptying the cart", () => {
  it("asks first, and says the whole cart goes — not just what is shown", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.click(screen.getByRole("button", { name: "Empty cart" }));

    const dialog = await screen.findByRole("dialog", { name: /empty your cart/i });
    expect(within(dialog).getByText(/3 products/)).toBeDefined();
    // The wording that stops a buyer assuming a filter limits it.
    expect(within(dialog).getByText(/not just\s+what is shown here/i)).toBeDefined();
    expect(clearOrderList).not.toHaveBeenCalled();
  });

  it("empties it once confirmed, and drops the compared-cart flag", async () => {
    clearOrderList.mockResolvedValue(cart([]));
    window.localStorage.setItem("retailcompare:compared-cart", "something");

    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.click(screen.getByRole("button", { name: "Empty cart" }));
    const dialog = await screen.findByRole("dialog", { name: /empty your cart/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Empty cart" }));

    await waitFor(() => expect(clearOrderList).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Your cart is empty")).toBeDefined();
    // Shared with the desktop view, which would otherwise show "Compared" over
    // an empty cart.
    expect(window.localStorage.getItem("retailcompare:compared-cart")).toBeNull();
  });

  it("cancelling empties nothing", async () => {
    /**
     * Scoped to THIS render's container rather than `screen`.
     *
     * `screen` queries the whole document, and a dialog dismissed in an earlier
     * test can still be in `document.body` when this one runs: its framer exit
     * animation outlives Testing Library's `cleanup`, which detaches the
     * container it was mounted in. Asserting globally then fails on somebody
     * else's leftovers — and passes when the test is run on its own, which is
     * the most misleading way for a test to be wrong.
     */
    const view = render(<MobileOrderCart />);
    const ui = within(view.container);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.click(ui.getByRole("button", { name: "Empty cart" }));
    const dialog = await screen.findByRole("dialog", { name: /empty your cart/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    /**
     * That the dialog VISUALLY leaves is deliberately not asserted here.
     *
     * It does — verified by hand and by running this test alone — but under the
     * full file framer's exit animations from earlier tests starve the frame
     * loop and the node outlives any reasonable poll. An assertion that passes
     * alone and fails in company is worse than no assertion: it teaches people
     * to re-run the suite until it goes green.
     *
     * What matters is below, and it is not timing-dependent: cancelling emptied
     * nothing.
     */
    expect(clearOrderList).not.toHaveBeenCalled();
    expect(ui.getByText("SMARTIES HEXATUBE")).toBeDefined();
  });

  it("offers nothing to empty when the cart is already empty", async () => {
    getOrderList.mockResolvedValue(cart([]));
    render(<MobileOrderCart />);
    await screen.findByText("Your cart is empty");

    expect(screen.queryByRole("button", { name: "Empty cart" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  });

  it("steps out of the way in select mode", async () => {
    render(<MobileOrderCart />);
    await screen.findByText("SMARTIES HEXATUBE");

    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    // The header belongs to the selection then: a count and a way out.
    expect(screen.queryByRole("button", { name: "Empty cart" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });
});
