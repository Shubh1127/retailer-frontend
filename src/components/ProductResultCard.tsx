/**
 * One product, its suppliers, and what can be done about it.
 *
 * ── WHY THERE IS ONE OF THESE ───────────────────────────────────────────────
 *
 * The same product used to look like different things depending on which
 * screen you reached it from. This owns the PRESENTATION for the central order
 * cart: it knows nothing about carts, jobs, scans or searches — it is handed a
 * `ProductResultView` and draws it. The translation from each source's own
 * shape lives in `@/lib/productResult`, so source-specific concerns stay with
 * the source and the visual format stops depending on where a product
 * happened to come from.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * No fetching, no cart writes, no supplier calls. Every action arrives as a
 * callback.
 *
 * It also renders NO SAVINGS FIGURE. Savings are computed by the job pipeline
 * and shown by the job result's own table; putting them here would mean a
 * second implementation of a number the business depends on.
 */

import StockLine from "@/components/StockLine";
import { bySupplierOrder } from "@/lib/suppliers";
import { eur } from "@/lib/mock-data";

/** One wholesaler's answer about one product. */
export interface ProductResultOffer {
  supplierId: string;
  /** Already resolved to a display name by the adapter — Barry's two ids included. */
  supplierName: string;
  supplierSku?: string;
  exVatCasePrice?: number;
  /**
   * WHY there is no price, when there is none.
   *
   * `not-connected`, `unavailable` and `not-found` are three different facts
   * and only the last is about the product. Collapsing them into a blank cell
   * tells a retailer a wholesaler does not stock something when the truth may
   * be that we never asked.
   */
  status?: "priced" | "not-found" | "unavailable" | "not-connected";
  /** Absent when the supplier did not say — Barry and O'Reilly never do. */
  inStock?: boolean;
  availabilityText?: string;
  /** What you get for the money. Without it a single and its case are two numbers. */
  unitsPerCase?: number;
  unitSize?: number;
  uom?: string;
  isSingle?: boolean;
}

export interface ProductResultView {
  /** Stable across renders. The cart line id, the job row, or the search key. */
  key: string;
  title: string;
  /** Barcode, article code or supplier SKU — whatever identifies this line. */
  identity?: string;
  identityLabel?: string;
  imageUrl?: string;
  sizeText?: string;
  /**
   * Where this product came from. Shown as context, never as layout.
   *
   * `title` carries the TRACEABILITY — which job, which row — because that is
   * the whole reason `job_result` is its own source rather than folded into
   * `order_list`. Losing it would make a chip decorative.
   */
  sources?: { label: string; title?: string }[];
  offers: ProductResultOffer[];
  /** The offer that would actually be bought, when one has been chosen. */
  best?: { supplierId: string; supplierSku?: string };
  /** A short status line — "Not priced yet", "Pricing failed", and so on. */
  note?: string;
  /** When the offers were taken. Absent means never priced. */
  pricedAt?: string;
}

function OfferPrice({ offer }: { offer: ProductResultOffer }) {
  if (offer.exVatCasePrice !== undefined) return <>{eur(offer.exVatCasePrice)}</>;

  /**
   * THE THREE ABSENCES, KEPT APART. This is the whole reason `status` travels
   * from the supplier all the way to the screen.
   */
  if (offer.status === "not-connected") return <span className="text-ink-faint">not connected</span>;
  if (offer.status === "unavailable") return <span className="text-amber-700">no answer</span>;
  if (offer.status === "not-found") return <span className="text-ink-faint">not stocked</span>;
  return <span className="text-ink-faint">—</span>;
}

function Pack({ offer }: { offer: ProductResultOffer }) {
  const parts: string[] = [];
  if (offer.unitsPerCase !== undefined) parts.push(`${offer.unitsPerCase} ×`);
  if (offer.unitSize !== undefined) parts.push(`${offer.unitSize}${offer.uom ?? ""}`);
  if (offer.isSingle) parts.push("single");

  if (parts.length === 0) return null;
  return <span className="text-ink-faint">{parts.join(" ")}</span>;
}

const SUPPLIER_COLUMNS: { label: string; ids: string[] }[] = [
  { label: "Musgrave", ids: ["musgrave"] },
  { label: "O'Reilly", ids: ["oreilly"] },
  { label: "Barry Group", ids: ["barrygroup-ambient", "barrygroup-chill"] },
  { label: "Kadona", ids: ["kadona"] },
];

function OfferAvailability({ offer }: { offer: ProductResultOffer }) {
  if (offer.inStock !== undefined) {
    return (
      <StockLine
        inStock={offer.inStock}
        {...(offer.availabilityText ? { availabilityText: offer.availabilityText } : {})}
        supplierName={offer.supplierName}
      />
    );
  }

  if (offer.status === "unavailable") {
    return <span className="text-[10.5px] font-medium text-amber-700">no answer</span>;
  }

  if (offer.status === "not-connected" || offer.status === "not-found") {
    return <span className="text-[10.5px] font-medium text-ink-faint">unavailable</span>;
  }

  return null;
}

/**
 * The offer rows.
 *
 * ONE SUPPLIER ORDER EVERYWHERE — Musgrave, O'Reilly, Barry, Kadona — from
 * `@/lib/suppliers`. A comparison is read by scanning down a column, and a
 * column whose rows move between screens is one nobody can scan.
 */
export function ProductResultOffers({
  offers,
  best,
}: {
  offers: readonly ProductResultOffer[];
  best?: ProductResultView["best"];
}) {
  return (
    <div className="mt-2 grid grid-cols-4 gap-1.5">
      {SUPPLIER_COLUMNS.map((column) => {
        const columnOffers = bySupplierOrder(
          offers.filter((offer) => column.ids.includes(offer.supplierId)),
          (offer) => offer.supplierId,
        );
        const columnIsBest = columnOffers.some(
          (offer) =>
            best !== undefined &&
            best.supplierId === offer.supplierId &&
            (best.supplierSku === undefined || best.supplierSku === offer.supplierSku),
        );

        return (
          <div
            key={column.label}
            className={`min-w-0 rounded-md border px-2 py-1.5 ${
              columnIsBest ? "border-good-400 bg-good-50/60" : "border-line bg-canvas/40"
            }`}
          >
            <p
              className={`truncate text-[10.5px] font-semibold ${
                columnIsBest ? "text-good-600" : "text-ink-soft"
              }`}
            >
              {column.label}
            </p>
            {columnOffers.length === 0 ? (
              <span className="mt-1 block text-[12px] text-ink-faint">—</span>
            ) : (
              <div className="mt-1 space-y-1">
                {columnOffers.map((offer) => {
                  const isBest =
                    best !== undefined &&
                    best.supplierId === offer.supplierId &&
                    (best.supplierSku === undefined || best.supplierSku === offer.supplierSku);

                  return (
                    <div key={`${offer.supplierId}:${offer.supplierSku ?? ""}`}>
                      <p
                        className={`nums flex items-baseline gap-2 text-[12px] ${
                          isBest ? "font-semibold text-good-600" : "text-ink"
                        }`}
                      >
                        <OfferPrice offer={offer} />
                        <Pack offer={offer} />
                      </p>
                      <OfferAvailability offer={offer} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The whole card: what the product is, who sells it, and what it costs.
 *
 * `actions` and `quantity` are rendered by the CALLER, because what you can do
 * with a product genuinely differs by screen — a cart line has a stepper and a
 * bin, a search result has a checkbox and a basket button — while what a
 * product IS does not.
 */
export default function ProductResultCard({
  view,
  badge,
  footer,
  quantity,
  actions,
}: {
  view: ProductResultView;
  /** A status chip shown beside the source chips — the caller's own vocabulary. */
  badge?: React.ReactNode;
  /**
   * Prose UNDER the offers, owned by the caller.
   *
   * Why this is a slot and not a string on the view: the cart's explanations
   * of "no offers" and of partial supplier coverage are carefully worded and
   * each screen has earned its own.
   */
  footer?: React.ReactNode;
  quantity?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
      {view.imageUrl ? (
        <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-lg border border-line bg-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={view.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
        </div>
      ) : (
        <div className="h-[76px] w-[76px] shrink-0 rounded-lg border border-line bg-canvas" aria-hidden="true" />
      )}

      <div className="min-w-0 flex-1 self-stretch">
        <p className="break-words text-[13.5px] font-medium leading-snug text-ink">{view.title}</p>

        {view.identity && (
          <p className="mt-0.5 text-[11.5px] tabular-nums text-ink-soft">
            {view.identityLabel ? `${view.identityLabel} ` : "EAN "}
            {view.identity}
          </p>
        )}

        {view.sizeText && (
          <p className="mt-0.5 truncate text-[11.5px] font-medium text-ink-soft">{view.sizeText}</p>
        )}

        {(badge || view.sources?.length) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {badge}
            {view.sources?.map((source) => (
              <span
                key={source.label}
                {...(source.title ? { title: source.title } : {})}
                className="rounded bg-canvas px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft"
              >
                {source.label}
              </span>
            ))}
          </div>
        )}

        {view.note && <p className="mt-1 text-[11.5px] text-ink-soft">{view.note}</p>}
      </div>

      <div className="min-w-0 flex-[2.6] self-stretch">
        <ProductResultOffers offers={view.offers} {...(view.best ? { best: view.best } : {})} />
        {footer}
      </div>

      {(quantity || actions) && (
        <div className="flex shrink-0 items-center gap-1">
          {quantity}
          {actions}
        </div>
      )}
    </div>
  );
}
