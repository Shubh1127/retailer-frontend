/**
 * The order wholesalers are shown in, everywhere in the app.
 *
 * ── WHY THIS IS A MODULE AND NOT AN ARRAY IN EACH COMPONENT ─────────────────
 *
 * A price comparison is read by scanning down a column, and a column whose
 * rows move between screens is a column nobody can scan. This is the one
 * place the order is declared, so the order cart, the product tables and the
 * job result all read down the same column.
 *
 * ── THE ORDER, AND WHY IT IS THIS ONE ───────────────────────────────────────
 *
 *   1. Musgrave      the main supplier. Allocation anchors on it, the tie-break
 *                    in every winner rule prefers it, and it is the account most
 *                    retailers already hold — so it is what a buyer looks for
 *                    first.
 *   2. O'Reilly
 *   3. Barry Group   two accounts, one wholesaler. Ambient before chill, so the
 *                    pair always reads the same way round.
 *   4. Kadona
 *
 * Anything unknown sorts to the END rather than the start. A supplier we have
 * not heard of is not one to lead a comparison with, and putting it last keeps
 * the four familiar rows where the eye expects them.
 */

/** Canonical display order, by supplier id. */
export const SUPPLIER_ORDER: readonly string[] = [
  "musgrave",
  "oreilly",
  "barrygroup-ambient",
  "barrygroup-chill",
  "kadona",
];

const RANK = new Map(SUPPLIER_ORDER.map((id, index) => [id, index]));

/** Where a supplier sits. Unknown ids sort last, in a stable order among themselves. */
export function supplierRank(id: string | undefined): number {
  if (!id) return Number.MAX_SAFE_INTEGER;
  return RANK.get(id.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * A comparator for anything carrying a supplier id.
 *
 * Ties fall back to the id itself, so two unknown suppliers still order
 * predictably rather than by whatever the input happened to be.
 */
export function compareSuppliers(a: string | undefined, b: string | undefined): number {
  const byRank = supplierRank(a) - supplierRank(b);
  if (byRank !== 0) return byRank;
  return (a ?? "").localeCompare(b ?? "");
}

/**
 * Sort a list of offers into the canonical order.
 *
 * NON-MUTATING. Several callers render straight from props, and sorting those
 * in place would reorder somebody else's array as a side effect of drawing.
 */
export function bySupplierOrder<T>(items: readonly T[], idOf: (item: T) => string | undefined): T[] {
  return [...items].sort((a, b) => compareSuppliers(idOf(a), idOf(b)));
}

/**
 * ── THE FOUR THINGS A BUYER SEES ────────────────────────────────────────────
 *
 * Five ids, four wholesalers. Barry Group holds two accounts — ambient and
 * chill — and they are one company to the person ordering, so they collapse
 * into one group rather than taking two of the four slots a phone has room for.
 *
 * Shared between `ProductResultCard` (the desktop grid) and the mobile product
 * sheet. When this list lived in the component, the two screens disagreed about
 * whether Barry was one row or two, which made the same product look like two
 * different products depending on the width of the window.
 */
export const SUPPLIER_COLUMNS: readonly { label: string; ids: readonly string[] }[] = [
  { label: "Musgrave", ids: ["musgrave"] },
  { label: "O'Reilly", ids: ["oreilly"] },
  { label: "Barry Group", ids: ["barrygroup-ambient", "barrygroup-chill"] },
  { label: "Kadona", ids: ["kadona"] },
];
