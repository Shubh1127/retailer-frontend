/**
 * Paging, and the two ways it lies about the data if you get it wrong.
 *
 *   a page past the end   renders empty, which reads as "there is nothing
 *                         here" — a claim about the DATA, not about the page.
 *                         It happens whenever the list shrinks under you: a
 *                         search narrows it, a job's rows are re-fetched.
 *   a page that persists  across a new search shows page 4 of results the
 *                         buyer has not seen page 1 of, which reads as the
 *                         search having returned something unrelated.
 *
 * The rest is arithmetic, and it is worth pinning because "11–20 of 213" is
 * the only place a buyer is told how much they have not looked at yet.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

import Pagination, { usePagination, PAGE_SIZE } from "./Pagination";

afterEach(cleanup);

const range = (n: number): number[] => Array.from({ length: n }, (_unused, i) => i + 1);

/** Renders the hook's output so the assertions can read it off the DOM. */
function Harness({ all, resetKey }: { all: number[]; resetKey?: unknown }) {
  const paged = usePagination(all, { ...(resetKey !== undefined ? { resetKey } : {}) });

  return (
    <div>
      <span data-testid="items">{paged.items.join(",")}</span>
      <span data-testid="page">{paged.page}</span>
      <span data-testid="pageCount">{paged.pageCount}</span>
      <span data-testid="range">
        {paged.from}-{paged.to}/{paged.total}
      </span>
      <button onClick={paged.next}>next</button>
      <button onClick={paged.prev}>prev</button>
      <Pagination paged={paged} label="products" />
    </div>
  );
}

const items = () => screen.getByTestId("items").textContent;
const page = () => screen.getByTestId("page").textContent;
const click = (name: string) => act(() => screen.getAllByText(name)[0]!.click());

describe("usePagination", () => {
  it("shows one batch at a time", () => {
    render(<Harness all={range(213)} />);

    // Ten, because a processing batch is ten — one batch is one screen.
    expect(PAGE_SIZE).toBe(10);
    expect(items()).toBe("1,2,3,4,5,6,7,8,9,10");
    expect(screen.getByTestId("pageCount").textContent).toBe("22");
    expect(screen.getByTestId("range").textContent).toBe("1-10/213");
  });

  it("walks forward and back", () => {
    render(<Harness all={range(35)} />);

    click("next");
    expect(items()).toBe("11,12,13,14,15,16,17,18,19,20");
    expect(screen.getByTestId("range").textContent).toBe("11-20/35");

    click("prev");
    expect(items()).toBe("1,2,3,4,5,6,7,8,9,10");
  });

  it("stops at both ends rather than running off them", () => {
    render(<Harness all={range(12)} />);

    click("prev");
    expect(page()).toBe("1");

    click("next");
    click("next");
    click("next");
    expect(page()).toBe("2");
    // The last page is short, and its range must say so.
    expect(screen.getByTestId("range").textContent).toBe("11-12/12");
  });

  it("pulls back to the last real page when the list shrinks under it", () => {
    const { rerender } = render(<Harness all={range(50)} />);

    click("next");
    click("next");
    click("next");
    expect(page()).toBe("4");

    // A filter narrows the list to twelve. Page 4 no longer exists — rendering
    // it empty would say "no products match", which is false.
    rerender(<Harness all={range(12)} />);

    expect(page()).toBe("2");
    expect(items()).toBe("11,12");
  });

  it("starts again at page one when the list changes meaning", () => {
    const { rerender } = render(<Harness all={range(50)} resetKey="coke" />);

    click("next");
    expect(page()).toBe("2");

    // A NEW search. Landing on page 2 of it would look like the search had
    // returned something the buyer never asked for.
    rerender(<Harness all={range(50)} resetKey="milk" />);
    expect(page()).toBe("1");
  });

  it("does not re-page when rows merely arrive", () => {
    const { rerender } = render(<Harness all={range(50)} resetKey="coke" />);

    click("next");
    click("next");
    expect(page()).toBe("3");

    // A batch lands mid-job. Yanking the buyer back to the top every fifteen
    // seconds is why the key is the SEARCH, not the row count.
    rerender(<Harness all={range(60)} resetKey="coke" />);
    expect(page()).toBe("3");
  });

  it("copes with an empty list", () => {
    render(<Harness all={[]} />);

    expect(items()).toBe("");
    expect(page()).toBe("1");
    expect(screen.getByTestId("range").textContent).toBe("0-0/0");
  });
});

describe("<Pagination>", () => {
  it("renders nothing when everything fits on one page", () => {
    render(<Harness all={range(7)} />);

    // A control that can only ever be disabled is furniture, and on a
    // seven-line list it is the only thing under the table.
    expect(screen.queryByText("← Prev")).toBeNull();
    expect(screen.queryByText("Next →")).toBeNull();
  });

  it("says what is on screen and what is not", () => {
    render(<Harness all={range(213)} />);

    expect(screen.getByText("1–10")).toBeTruthy();
    expect(screen.getByText("products", { exact: false })).toBeTruthy();
  });

  it("disables the end it is already at", () => {
    render(<Harness all={range(25)} />);

    const prev = screen.getByText("← Prev") as HTMLButtonElement;
    const next = screen.getByText("Next →") as HTMLButtonElement;

    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    click("Next →");
    click("Next →");

    expect((screen.getByText("← Prev") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("Next →") as HTMLButtonElement).disabled).toBe(true);
  });
});
