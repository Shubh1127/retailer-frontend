/**
 * What a supplier said about supplying it — printed under their price.
 *
 * UNDER THE PRICE, because that is the pair a buyer reads: €24.00 is only an
 * offer if the wholesaler can actually send it. Split out into one component
 * because it appears on four screens — the dashboard's job rows, the job page,
 * the shared search table and the admin's confirm panel — and four renderings
 * of a three-state field is four chances to flatten one of the states.
 *
 * THREE STATES, AND THE THIRD IS BLANK.
 *
 *   true       "in stock"     the supplier said so.
 *   false      "out of stock" the supplier said so, and the line cannot be
 *                             awarded to them — see `chooseBestSupplier`.
 *   undefined  nothing        THE SUPPLIER DID NOT SAY.
 *
 * Musgrave publishes it in its search API and Kadona in WooCommerce's card
 * class. Barry's listing states nothing and O'Reilly's search page has no
 * marker, so most offers carry `undefined` — and rendering that as "in stock"
 * would invent an assurance on a wholesaler's behalf, while rendering it as
 * "out of stock" would stop a buyer ordering something perfectly available.
 * Silence renders as silence.
 */

export default function StockLine({
  inStock,
  availabilityText,
  supplierName,
  className = "",
}: {
  inStock?: boolean;
  /** The supplier's own wording — "back order", "discontinued". */
  availabilityText?: string;
  /** Used in the tooltip, so "who says so" is one hover away. */
  supplierName?: string;
  className?: string;
}) {
  if (inStock === undefined) return null;

  const who = supplierName ? `${supplierName} lists this as` : "Listed as";

  return (
    <div
      title={
        inStock
          ? `${who} in stock.`
          : `${who} out of stock, so it cannot be selected for this line.`
      }
      className={`text-[10.5px] font-medium ${
        inStock ? "text-good-600" : "text-amber-700"
      } ${className}`}
    >
      {availabilityText ?? (inStock ? "in stock" : "out of stock")}
    </div>
  );
}
