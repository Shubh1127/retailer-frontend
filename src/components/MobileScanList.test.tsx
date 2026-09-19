/**
 * The mobile scan screen.
 *
 * WHAT IS WORTH TESTING is the boundary this screen was rebuilt around: it
 * COLLECTS and it does not PRICE. Everything scanned is already in the order
 * cart, so the failures that matter are (a) showing a price — any price — on a
 * screen whose whole point is that it never waits on a supplier, (b) not
 * telling the buyer where the products went, and (c) removing a line without
 * asking, which on a shop floor is invisible until the delivery arrives.
 *
 * The pending row is tested too, because it is the thing that makes scanning
 * feel instant: the digits appear with the beep and fill in behind them.
 *
 * The layout is not tested and could not be: jsdom applies no Tailwind, so
 * `lg:hidden` is invisible to it. Absence after a filter or a removal is
 * awaited, because rows sit inside an `AnimatePresence` and outlive the state
 * change by the length of their exit animation.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";

import MobileScanList from "./MobileScanList";
import type { ScanLine } from "@/lib/api/scan";

afterEach(cleanup);

function line(over: Partial<ScanLine> = {}): ScanLine {
  return {
    id: 1,
    lineKey: "l-1",
    gtin14: "05024996619997",
    scannedCode: "5024996619997",
    quantity: 1,
    position: 1,
    resolvedFrom: "master",
    product: {
      gtin14: "05024996619997",
      name: "Smarties Hexatube Std",
      sizeText: "24 × 38g",
      vendorCount: 3,
      suppliers: [],
    },
    ...over,
  } as ScanLine;
}

const UNKNOWN = line({
  id: 2,
  gtin14: undefined as unknown as string,
  scannedCode: "9999999999999",
  resolvedFrom: "none",
  product: undefined as unknown as ScanLine["product"],
});

function renderList(over: Partial<React.ComponentProps<typeof MobileScanList>> = {}) {
  const props: React.ComponentProps<typeof MobileScanList> = {
    lines: [line()],
    pending: [],
    discovering: [],
    highlight: null,
    loading: false,
    typed: "",
    onTyped: vi.fn(),
    onSubmit: vi.fn(),
    inputRef: createRef<HTMLInputElement>(),
    scannerSeen: false,
    cameraOn: false,
    onCamera: vi.fn(),
    cameraError: null,
    feedback: null,
    onQuantity: vi.fn(),
    onClear: vi.fn(),
    clearing: false,
    ...over,
  };

  return { ...render(<MobileScanList {...props} />), props };
}

// ---------------------------------------------------------------------------

describe("the screen collects rather than prices", () => {
  it("shows no price, even when the line carries one", () => {
    // `best` survives on the type because the order cart writes it. This screen
    // must not render it: a price here is one nobody asked a supplier for.
    const { container } = renderList({
      lines: [
        line({
          best: { supplierId: "oreilly", supplierSku: "SKU-1", exVatCasePrice: 16.75 },
          pricedAt: "2026-09-19T10:30:00.000Z",
        }),
      ],
    });

    expect(container.textContent).not.toMatch(/€/);
    expect(container.textContent).not.toMatch(/16\.75/);
  });

  it("offers no way to fetch prices or fill a basket", () => {
    renderList();

    expect(screen.queryByRole("button", { name: /price/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /basket/i })).toBeNull();
  });

  it("says where the scanned products went, and links there", () => {
    renderList();

    const links = screen.getAllByRole("link", { name: /order cart/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.getAttribute("href")).toBe("/order-cart?tab=scan");
  });
});

describe("what a beep looks like", () => {
  it("shows the digits before the server has answered", () => {
    renderList({ pending: [{ code: "5010029000047", at: Date.now() }] });

    expect(screen.getByText("5010029000047")).toBeDefined();
    expect(screen.getByText("Looking it up…")).toBeDefined();
  });

  // Scoped to the list in both: "Not found" is also the name of the filter
  // chip above it, so an unscoped query cannot tell a verdict about a product
  // from a control that filters by one.
  it("says it is still asking, rather than calling a product missing", () => {
    renderList({ lines: [UNKNOWN], discovering: [2] });

    const list = screen.getByRole("list");
    expect(within(list).getByText("Checking suppliers…")).toBeDefined();
    expect(within(list).queryByText("Not found")).toBeNull();
  });

  it("calls it not found once the asking has stopped", () => {
    renderList({ lines: [UNKNOWN], discovering: [] });

    const list = screen.getByRole("list");
    expect(within(list).getByText("Not found")).toBeDefined();
    expect(within(list).getByText("not recognised")).toBeDefined();
  });

  it("submits a typed barcode", () => {
    const onSubmit = vi.fn();
    renderList({ typed: "5010029000047", onSubmit });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("will not submit an empty box", () => {
    renderList({ typed: "" });
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("changing what was scanned", () => {
  it("steps the quantity through the page's own handler", () => {
    const onQuantity = vi.fn();
    renderList({ lines: [line({ quantity: 2 })], onQuantity });

    fireEvent.click(screen.getByRole("button", { name: /More of/ }));
    expect(onQuantity).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 3);

    fireEvent.click(screen.getByRole("button", { name: /Fewer of/ }));
    expect(onQuantity).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 1);
  });

  it("will not step below one — removing is a separate, asked-for act", () => {
    renderList({ lines: [line({ quantity: 1 })] });
    expect(screen.getByRole("button", { name: /Fewer of/ }).hasAttribute("disabled")).toBe(true);
  });

  it("asks before removing, and names the product", async () => {
    const onQuantity = vi.fn();
    renderList({ onQuantity });

    fireEvent.click(screen.getByRole("button", { name: /Remove Smarties/ }));

    const dialog = await screen.findByRole("dialog", { name: /remove this item/i });
    expect(within(dialog).getByText(/Smarties Hexatube Std/)).toBeDefined();
    expect(onQuantity).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    // Zero is how this page removes — the page's handler owns that rule.
    expect(onQuantity).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 0);
  });

  it("cancelling removes nothing", async () => {
    const onQuantity = vi.fn();
    renderList({ onQuantity });

    fireEvent.click(screen.getByRole("button", { name: /Remove Smarties/ }));
    const dialog = await screen.findByRole("dialog", { name: /remove this item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onQuantity).not.toHaveBeenCalled();
  });

  it("asks before clearing, and says what survives", async () => {
    const onClear = vi.fn();
    renderList({ lines: [line(), UNKNOWN], onClear });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    const dialog = await screen.findByRole("dialog", { name: /remove all 2/i });
    expect(within(dialog).getByText(/added another way stays/i)).toBeDefined();
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove all" }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe("finding one line among many", () => {
  it("filters down to what nothing recognised", async () => {
    renderList({ lines: [line(), UNKNOWN] });

    fireEvent.click(screen.getByRole("button", { name: /^Not found/ }));

    expect(screen.getByText("9999999999999", { exact: false })).toBeDefined();
    await waitFor(() => expect(screen.queryByText("Smarties Hexatube Std")).toBeNull());
  });

  it("searches by name and by barcode", async () => {
    renderList({ lines: [line(), line({ id: 3, product: undefined as never, scannedCode: "123" })] });

    fireEvent.change(screen.getByLabelText(/search scanned products/i), {
      target: { value: "smarties" },
    });

    expect(screen.getByText("Smarties Hexatube Std")).toBeDefined();
    await waitFor(() => expect(screen.queryByText(/EAN 123/)).toBeNull());
  });
});

describe("the states around the list", () => {
  it("shows a skeleton while loading, not the word loading", () => {
    const { container } = renderList({ lines: [], loading: true });

    expect(screen.getByRole("status").textContent).toMatch(/loading your scanned/i);
    expect(container.querySelector('[aria-hidden="true"].animate-pulse')).not.toBeNull();
  });

  it("offers the camera when nothing has been scanned", () => {
    const onCamera = vi.fn();
    renderList({ lines: [], onCamera });

    expect(screen.getByText("Nothing scanned yet")).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: /scan with camera/i })[0]!);
    expect(onCamera).toHaveBeenCalled();
  });

  it("confirms the handheld scanner was noticed", () => {
    renderList({ scannerSeen: true });
    expect(screen.getByText(/scanner detected/i)).toBeDefined();
  });

  it("surfaces a camera failure without losing the list", () => {
    renderList({ cameraError: "Camera permission denied" });

    expect(screen.getByText("Camera permission denied")).toBeDefined();
    expect(screen.getByText("Smarties Hexatube Std")).toBeDefined();
  });
});
