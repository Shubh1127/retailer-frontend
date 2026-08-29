/**
 * The three ways in, and the one of them that can go wrong quietly.
 *
 * Two boxes are links wearing buttons; the third takes typed input and has to
 * decide when it is a barcode. Getting that wrong is not loud — it runs a
 * search for half a number, and "nothing found" for an unfinished query reads
 * as a real answer about what the suppliers stock.
 *
 * The layout itself is not tested here and could not be: jsdom applies no
 * Tailwind, so `md:` is invisible to it. What IS pinned is that all three
 * options exist with their own controls, because the failure mode of a
 * responsive grid is one of them silently going missing.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import StartOptions from "./StartOptions";

beforeEach(() => push.mockReset());
afterEach(cleanup);

function typeBarcode(value: string): void {
  fireEvent.change(screen.getByLabelText("Barcode"), { target: { value } });
}

describe("the three ways to start", () => {
  it("offers all three", () => {
    render(<StartOptions />);

    expect(screen.getByText("Scan a product")).toBeTruthy();
    expect(screen.getByText("Enter a barcode")).toBeTruthy();
    expect(screen.getByText("Upload a sheet")).toBeTruthy();
  });

  it("says they are alternatives rather than steps", () => {
    render(<StartOptions />);

    // Three boxes in a row read as three things to do in order. Two separators
    // is what makes them a choice.
    expect(screen.getAllByText("or")).toHaveLength(2);
  });

  it("opens the viewfinder from the scan box", () => {
    render(<StartOptions />);
    fireEvent.click(screen.getByRole("button", { name: "Scan product" }));

    // `camera=1`, the same flag the mobile tab bar sends: tapping a button that
    // says Scan means "I want to scan", not "show me a page with a scan button".
    expect(push).toHaveBeenCalledWith("/scan?camera=1");
  });

  it("sends a sheet through the order list", () => {
    render(<StartOptions />);
    fireEvent.click(screen.getByRole("button", { name: "Build an order list" }));

    // NOT straight into a job. Uploading used to fan two hundred lines out to
    // four live trade accounts before anyone had read the file.
    expect(push).toHaveBeenCalledWith("/orders");
  });
});

describe("typing a barcode", () => {
  it("searches it rather than adding it to a cart", () => {
    render(<StartOptions />);
    typeBarcode("5054267013926");
    fireEvent.click(screen.getByRole("button", { name: "Search this barcode" }));

    // A LOOKUP, NOT A SCAN. It used to go to /scan, which quietly put the
    // product in a virtual cart the person was not looking at. Somebody typing
    // a number off a note is asking who stocks it and what they charge.
    expect(push).toHaveBeenCalledWith("/product-search?q=5054267013926");
  });

  it("submits on Enter", () => {
    render(<StartOptions />);
    typeBarcode("5054267013926");
    fireEvent.submit(screen.getByLabelText("Barcode").closest("form")!);

    expect(push).toHaveBeenCalledWith("/product-search?q=5054267013926");
  });

  it("strips the spaces a handheld scanner or a human leaves in", () => {
    render(<StartOptions />);
    typeBarcode(" 5054267 013926 ");
    fireEvent.click(screen.getByRole("button", { name: "Search this barcode" }));

    expect(push).toHaveBeenCalledWith("/product-search?q=5054267013926");
  });

  it("does nothing until there are enough digits", () => {
    render(<StartOptions />);
    typeBarcode("505");

    const add = screen.getByRole("button", {
      name: "Search this barcode",
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    // Half a barcode reaches the search as a number no catalogue holds, and a
    // "nothing found" for an unfinished query reads as a real answer.
    fireEvent.submit(screen.getByLabelText("Barcode").closest("form")!);
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing for text that is not a barcode at all", () => {
    render(<StartOptions />);
    typeBarcode("coca cola");

    fireEvent.submit(screen.getByLabelText("Barcode").closest("form")!);
    expect(push).not.toHaveBeenCalled();
  });

  it("is an arrow, not a word", () => {
    render(<StartOptions />);

    // The control belongs to the field it ends, not to the box: a labelled
    // button beside a text input reads as a second, separate action.
    const button = screen.getByRole("button", { name: "Search this barcode" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("asks for a numeric keypad on a phone", () => {
    render(<StartOptions />);

    // The field takes digits off a pack. A full QWERTY keyboard for that is a
    // small tax paid every time, in an aisle, one-handed.
    expect(screen.getByLabelText("Barcode").getAttribute("inputmode")).toBe("numeric");
  });
});
