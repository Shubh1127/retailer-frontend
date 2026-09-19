"use client";

/**
 * One product per row, one column per supplier, prices on request.
 *
 * SHARED BY THE DASHBOARD AND THE PRODUCT SEARCH PAGE, because they ask the
 * same question and a buyer should not have to learn two answers to it. It also
 * reads like the job table — winner in green, a quantity, a button — which is
 * the third place the same decision is presented.
 *
 * SEARCHING DOES NOT FETCH PRICES. That is the whole shape of this component.
 * A search is answered from the master table or the local catalogues in
 * milliseconds; every price column shows "—" until somebody presses Fetch live
 * prices, and only then are suppliers contacted. Search used to price as it
 * went, which is what made it take seconds.
 *
 * THREE THINGS "NO PRICE" CAN MEAN, and the cell says which:
 *
 *   —            nobody has asked yet.
 *   not found    the supplier answered, and had nothing under that code. A real
 *                statement about their catalogue.
 *   unavailable  the search failed. NOT a statement about stock. Barry behind a
 *                Cloudflare block used to render as "not found", which tells a
 *                buyer that a wholesaler nobody could reach does not sell the
 *                product — and sends the order to somebody dearer.
 *
 * THE ROW'S IDENTITY FOLLOWS THE WINNER. Barcode, picture and the "View on
 * supplier" link all belong to the supplier the row is actually offering.
 *
 * GROUPED ON THE BARCODE, never the name. Four suppliers write the same product
 * four ways, and a matcher loose enough to join those would put two different
 * products in one row and offer the cheaper one for order.
 *
 * CHEAPEST WINS, with no main-supplier preference — the same rule as Scan, and
 * deliberately not the job pipeline's. Somebody asking what one product costs
 * wants the cheapest price now, not the cheapest after a margin rule meant to
 * stop a weekly order churning supplier relationships.
 *
 * TWO DESTINATIONS, NOT ONE. Every row can go on the retailer's own central
 * Order Cart — an identity, no price required — or straight into a real
 * supplier Basket, which needs a fetched, live price. See `AddToOrderCartButton`
 * for the first and `addOne`/`addRow` below for the second.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import ProductGlyph from "@/components/ProductGlyph";
import NavIcon from "@/components/NavIcons";
import AddToOrderCartButton from "@/components/AddToOrderCart";
import { useSupplierGate } from "@/components/SupplierGate";
import {
  lookupOrderCartLines,
  removeOrderListLine,
  setOrderListCases,
  type OrderCartItemInput,
  type OrderCartSource,
} from "@/lib/api/orderList";
import { ApiError } from "@/lib/api/client";
import {
  addItems,
  cartSupplierLabel,
  fetchBasketAdds,
  supportsCart,
  VerificationRequiredError,
  type CartSupplier,
} from "@/lib/api/cart";
import {
  basketQuantity,
  inBasket,
  invalidateBasket,
  readBaskets,
  type BasketSnapshot,
} from "@/lib/basketState";
import { addToOrderCart } from "@/lib/api/orderList";
import { SUPPLIER_ORDER } from "@/lib/suppliers";
import { eur } from "@/lib/mock-data";
import {
  fetchLivePrices,
  type DiscoveredOffer,
  type LivePriceStatus,
  type SupplierSearchProduct,
} from "@/lib/api/endpoint";

/**
 * The most (supplier, SKU) pairs one Fetch may ask for.
 *
 * The backend refuses more than this in a request, because every pair is a
 * request to a shared logged-in trade account. Rather than let the button fail
 * on a broad search, whole rows are priced until the budget runs out and the
 * rest are said out loud — a row is priced completely or not at all, because a
 * row missing half its columns would show a false cheapest.
 */
const MAX_PRICE_ITEMS = 60;

/**
 * BARRY IS ONE SITE WITH TWO BASKETS, and asking it twice for one barcode is
 * two requests to the same search for the same answer. The search is
 * department-scoped, so one ask covers whichever department the product lives
 * in and comes back tagged with the right basket.
 */
const DISCOVERY_ROSTER = SUPPLIER_ORDER.filter((id) => id !== "barrygroup-chill");

/** Rows whose gaps are worth a live look. Beyond this, nobody is reading. */
const MAX_DISCOVERY_ROWS = 4;

interface Offer extends SupplierSearchProduct {
  /** Set once this supplier answered with a price. */
  livePrice?: number;
  /** Absent until somebody asked. See the header. */
  status?: LivePriceStatus;
}

interface Row {
  key: string;
  name: string;
  /** The barcode the row was grouped on — the fallback identity. */
  ean?: string;
  size?: string;
  brand?: string;
  offers: Map<string, Offer>;
  best?: { supplierId: string; sku: string; price: number };
}

/** A link worth showing: a real page at the supplier, not a relative API path. */
function realPage(offer: SupplierSearchProduct): string | undefined {
  const url = offer.viewUrl ?? offer.productUrl;
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

function group(products: readonly SupplierSearchProduct[]): Row[] {
  const rows = new Map<string, Row>();

  for (const product of products) {
    // Significant digits, so a 13-digit shelf edge and a 14-digit outer are one
    // product. No barcode means its own row rather than a guess.
    const barcode = product.ean?.trim().replace(/^0+/, "");
    const key = barcode || `${product.supplier}:${product.sku ?? product.name}`;

    const row = rows.get(key) ?? {
      key,
      name: product.name,
      ...(barcode ? { ean: barcode } : {}),
      ...(product.size ? { size: product.size } : {}),
      ...(product.brand ? { brand: product.brand } : {}),
      offers: new Map<string, Offer>(),
    };

    /**
     * One listing per supplier, and THE CASE WINS OVER THE BREAK-PACK SINGLE.
     *
     * A price is carried over ONLY when the backend marked it `repriced`,
     * which means it came from the live-fallback tier and was read at the
     * supplier seconds ago. A catalogue price is as old as the last sync and
     * looks identical on screen, so it stays a dash until somebody asks.
     */
    const existing = row.offers.get(product.supplier);
    if (!existing || (existing.isSingle === true && product.isSingle !== true)) {
      row.offers.set(product.supplier, {
        ...product,
        ...(product.repriced === true && product.exVatCasePrice !== undefined
          ? { livePrice: product.exVatCasePrice, status: "priced" as const }
          : {}),
      });
    }
    rows.set(key, row);
  }

  // Products several suppliers stock first — those are the ones with a
  // decision in them.
  return [...rows.values()].sort((a, b) => b.offers.size - a.offers.size);
}

/**
 * Cheapest LIVE price, among suppliers who can actually supply it.
 *
 * A catalogue price cannot win; nor can a blank; nor can a supplier who has
 * SAID they are out of stock.
 *
 * `inStock === undefined` still wins. Barry's listing and O'Reilly's search
 * page publish no stock field at all, so treating silence as a refusal would
 * hand every product to the two suppliers who happen to answer the question.
 */
function withWinner(row: Row): Row {
  let best: Row["best"];
  for (const [supplierId, offer] of row.offers) {
    if (offer.livePrice === undefined || !offer.sku) continue;
    if (offer.inStock === false) continue;
    if (!best || offer.livePrice < best.price) {
      best = { supplierId, sku: offer.sku, price: offer.livePrice };
    }
  }
  return { ...row, ...(best ? { best } : {}) };
}

/**
 * The offer whose barcode, picture and product page the row should show.
 *
 * The WINNER once there is one, because that is the supplier the row is
 * offering and the only one whose page is worth opening.
 */
function identityOf(row: Row): Offer | undefined {
  if (row.best) {
    const winner = row.offers.get(row.best.supplierId);
    if (winner) return winner;
  }
  for (const offer of row.offers.values()) if (realPage(offer)) return offer;
  return row.offers.values().next().value;
}

type AddState = { kind: "ok" | "error" | "already"; text: string };

/** `supplier:sku`, matching the key the backend answers with. */
const pairKey = (supplierId: string, sku: string): string => `${supplierId}:${sku}`;

/**
 * The product picture, with a departmental glyph behind it.
 */
function Thumb({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <ProductGlyph department="General" size={40} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={{ width: 40, height: 40 }}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md border border-line bg-white object-contain"
      loading="lazy"
    />
  );
}

/** What `lookupOrderCartLines` found for one row, or what an add just produced. */
interface OrderCartLine {
  lineId: number;
  cases: number;
}

/**
 * Already on the order cart — a status, not a second quantity control.
 *
 * ONE STEPPER PER ROW, not two. The Qty column already asks "how many", and
 * once a row is on the cart that number IS the cart's own quantity — see
 * where `qty`/`onQuantityChange` is drawn below, which switches to editing
 * `cartLine.cases` directly instead of a pre-add draft. This badge is what
 * the Order Cart column says instead: the same plain-status treatment the
 * real supplier Basket column already uses once a line is there.
 */
function OrderCartBadge() {
  return (
    <span className="rounded bg-good-50 px-1.5 py-0.5 text-[10.5px] font-medium text-good-600">
      ✓ In cart
    </span>
  );
}

/**
 * What the supplier said about supplying it, under their price.
 */
function StockNote({ offer, supplierId }: { offer: Offer; supplierId: string }) {
  if (offer.inStock === undefined) return null;

  if (offer.inStock) {
    return (
      <div className="text-[10.5px] font-medium text-good-600">
        {offer.availabilityText ?? "in stock"}
      </div>
    );
  }

  return (
    <div
      title={
        offer.availabilityText ??
        `${cartSupplierLabel(supplierId)} lists this as out of stock, so it cannot win this line.`
      }
      className="text-[10.5px] font-medium text-amber-700"
    >
      {offer.availabilityText ?? "out of stock"}
    </div>
  );
}

/**
 * One supplier's answer about one product: the price, or why there isn't one.
 */
function OfferPrice({
  offer,
  supplierId,
  isBest,
}: {
  offer: Offer;
  supplierId: string;
  isBest: boolean;
}) {
  return (
    <>
      {offer.livePrice !== undefined ? (
        <div className={`nums font-medium ${isBest ? "text-good-600" : "text-ink"}`}>
          {eur(offer.livePrice)}
        </div>
      ) : offer.status === "not-connected" ? (
        <a
          href="/suppliers"
          title={`You have not connected a ${cartSupplierLabel(supplierId)} account yet.`}
          className="text-[11.5px] text-link hover:underline"
        >
          not connected
        </a>
      ) : offer.status === "unavailable" ? (
        <span
          title={`${cartSupplierLabel(supplierId)} could not be reached. This says nothing about whether they stock it.`}
          className="text-[11.5px] text-red-600"
        >
          unavailable
        </span>
      ) : offer.status === "not-found" ? (
        <span
          title={`${cartSupplierLabel(supplierId)} answered, and returned nothing for ${offer.sku ?? "this code"}.`}
          className="text-[11.5px] text-amber-700"
        >
          not found
        </span>
      ) : (
        <span className="text-ink-faint">—</span>
      )}

      <StockNote offer={offer} supplierId={supplierId} />

      {offer.isSingle && <div className="text-[10.5px] font-medium text-amber-700">single</div>}
    </>
  );
}

/** What one row needs in order to be drawn, in either layout. */
interface RowView {
  row: Row;
  quantity: number;
  state?: AddState;
  canOrder: boolean;
  /**
   * Can this product go on the ORDER CART?
   *
   * Identity, not a price. Kept apart from `canOrder`, which is about a real
   * supplier basket and genuinely needs a winner.
   */
  canSelect: boolean;
  identity?: Offer;
  link?: string;
  /** What `lookupOrderCartLines` found for this row, if it is already on the cart. */
  cartLine?: OrderCartLine;
}

/**
 * One searched product, on a phone.
 */
function SearchRowCard({
  view,
  columns,
  picked,
  onPick,
  onQuantityChange,
  adding,
  onAdd,
  cartSource,
  cartLineBusy,
  onCartAdded,
  onCartLineQuantityChange,
}: {
  view: RowView;
  columns: readonly string[];
  picked: boolean;
  onPick: (checked: boolean) => void;
  onQuantityChange: (next: number) => void;
  /** Which row, if any, is mid-add — the table's own `adding` state. */
  adding: string | null;
  onAdd: () => void;
  cartSource: OrderCartSource;
  /** Is THIS row's order-cart quantity mid-write? */
  cartLineBusy: boolean;
  onCartAdded: (line: OrderCartLine) => void;
  onCartLineQuantityChange: (line: OrderCartLine, next: number) => void;
}) {
  const { row, quantity, state, canOrder, canSelect, identity, link, cartLine } = view;
  const [showOthers, setShowOthers] = useState(false);

  const winnerId = row.best?.supplierId;
  const winnerOffer = winnerId ? row.offers.get(winnerId) : undefined;

  const others = columns.filter((id) => row.offers.has(id) && id !== winnerId);

  return (
    <article className="px-4 py-3.5" aria-label={row.name}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={picked}
          // SELECTION IS NOT PRICING. A product with an identity can go on
          // the order cart whether or not anybody has quoted for it.
          disabled={!canSelect}
          aria-label={`Select ${row.name}`}
          onChange={(event) => onPick(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-teal-600 disabled:opacity-30"
        />

        <Thumb {...(identity?.imageUrl ? { src: identity.imageUrl } : {})} alt={row.name} />

        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[14px] font-semibold leading-snug text-ink">
            {identity?.name ?? row.name}
          </h3>
          <p className="mt-0.5 break-words text-[11.5px] text-ink-faint">
            {row.brand && `${row.brand} · `}
            {(identity?.ean ?? row.ean) && (
              <span className="nums">EAN {identity?.ean ?? row.ean}</span>
            )}
            {row.size && `${identity?.ean ?? row.ean ? " · " : ""}${row.size}`}
            {` · ${row.offers.size} supplier${row.offers.size === 1 ? "" : "s"}`}
          </p>
          {link && identity && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="text-[11.5px] text-link hover:underline"
            >
              View at {cartSupplierLabel(identity.supplier)} ↗
            </a>
          )}
        </div>
      </div>

      {/* ---- The winner, or the reason there isn't one --------------------- */}
      {row.best && winnerOffer ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
            Best price
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-[13.5px] font-medium text-emerald-800">
              {cartSupplierLabel(row.best.supplierId)}
            </span>
            <div className="shrink-0 text-right">
              <OfferPrice offer={winnerOffer} supplierId={row.best.supplierId} isBest />
            </div>
          </div>
        </div>
      ) : (
        <div>
          
        </div>
        // <div className="mt-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12.5px] text-ink-soft">
        //   No live price yet. Press &ldquo;Fetch live prices&rdquo; above to compare{" "}
        //   {row.offers.size} supplier{row.offers.size === 1 ? "" : "s"}.
        // </div>
      )}

      {/* ---- The quotes that lost, folded away ----------------------------- */}
      {others.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowOthers((current) => !current)}
            aria-expanded={showOthers}
            className="flex w-full items-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-medium text-ink-soft hover:text-ink"
          >
            <span
              aria-hidden="true"
              className={`text-[10px] transition-transform ${showOthers ? "rotate-180" : ""}`}
            >
              ▼
            </span>
            {others.length} {row.best ? "other supplier" : "supplier"}
            {others.length === 1 ? "" : "s"}
          </button>

          {showOthers && (
            <ul className="mt-1 space-y-1.5 rounded-lg border border-line bg-canvas px-3 py-2.5">
              {others.map((supplierId) => {
                const offer = row.offers.get(supplierId)!;
                const delta =
                  row.best && offer.livePrice !== undefined
                    ? offer.livePrice - row.best.price
                    : undefined;

                return (
                  <li key={supplierId} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-[12.5px] text-ink-soft">
                      {cartSupplierLabel(supplierId)}
                    </span>
                    <div className="shrink-0 text-right">
                      <OfferPrice offer={offer} supplierId={supplierId} isBest={false} />
                      {delta !== undefined && delta > 0 && (
                        <div className="text-[11px] tabular-nums text-ink-faint">
                          +{eur(delta)}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ---- How many ------------------------------------------------------
          ONE STEPPER, TWO MEANINGS — the same rule the real supplier basket
          column uses elsewhere. Not yet on the order cart, this is a DRAFT the
          buyer adjusts before adding. Already there, every press is a live
          change to that cart line: the number IS the cart's own quantity, not
          a separate copy of it, so there is nothing to keep in sync. */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink-soft">Qty</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={cartLine ? cartLineBusy : quantity <= 1}
            onClick={() =>
              cartLine
                ? onCartLineQuantityChange(cartLine, cartLine.cases - 1)
                : onQuantityChange(quantity - 1)
            }
            aria-label={
              cartLine
                ? cartLine.cases <= 1
                  ? `Remove ${row.name} from the order cart`
                  : `Fewer ${row.name} in the order cart`
                : `Decrease ${row.name}`
            }
            className="h-9 w-9 rounded-md border border-line text-[16px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
          >
            {cartLine && cartLine.cases <= 1 ? "🗑" : "−"}
          </button>
          <span className="w-9 text-center text-[15px] tabular-nums text-ink">
            {cartLine ? cartLine.cases : quantity}
          </span>
          <button
            type="button"
            disabled={cartLine ? cartLineBusy : false}
            onClick={() =>
              cartLine
                ? onCartLineQuantityChange(cartLine, cartLine.cases + 1)
                : onQuantityChange(quantity + 1)
            }
            aria-label={cartLine ? `More ${row.name} in the order cart` : `Increase ${row.name}`}
            className="h-9 w-9 rounded-md border border-line text-[16px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
          >
            ＋
          </button>
        </div>
      </div>

      {/* ---- Onto the retailer's own list ----------------------------------
          ABOVE the basket, and available whether or not prices were fetched.
          Collecting a product is the step before deciding what it costs; the
          button underneath spends money at a wholesaler and this one does not. */}
      <div className="mt-2.5">
        {cartLine ? (
          <OrderCartBadge />
        ) : (
          <AddToOrderCartButton
            item={asCartItem(row, identity, quantity)}
            source={cartSource}
            onAdded={onCartAdded}
          />
        )}
      </div>

      {/* ---- Into whose basket --------------------------------------------- */}
      <div className="mt-2.5">
        {state ? (
          <div
            className={`w-full rounded-md px-3 py-2.5 text-center text-[13px] font-medium ${
              state.kind === "error"
                ? "bg-red-50 text-red-600"
                : state.kind === "ok"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-canvas text-ink-soft"
            }`}
            title={
              state.kind === "already"
                ? "Sent to this supplier's basket earlier. Open the basket to change it."
                : undefined
            }
          >
            {state.kind === "ok" ? "🟢 " : state.kind === "already" ? "✓ " : ""}
            {state.text}
          </div>
        ) : (
          <button
            type="button"
            disabled={!canOrder || adding !== null}
            onClick={onAdd}
            title={
              canOrder
                ? `Add ${quantity} × to the ${cartSupplierLabel(row.best!.supplierId)} basket`
                : row.best
                  ? `${cartSupplierLabel(row.best.supplierId)} has no basket integration`
                  : "Fetch live prices first — nothing is ordered on a catalogue price"
            }
            className="w-full rounded-md border border-teal-600 px-3 py-2.5 text-[13px] font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {adding === row.key
              ? "Adding…"
              : canOrder
                ? `＋ Add to ${cartSupplierLabel(row.best!.supplierId)}`
                : "＋ Add"}
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * What a row looks like as a cart item.
 *
 * IDENTITY IS NOT DECIDED HERE. Everything below is a straight copy of what
 * the search returned; which of these fields becomes the line's identity is
 * `cartLineKey`'s decision, server-side.
 */
function asCartItem(row: Row, identity: Offer | undefined, quantity: number): OrderCartItemInput {
  return {
    ...(identity?.ean ?? row.ean ? { gtin14: (identity?.ean ?? row.ean)! } : {}),
    ...(identity?.name ?? row.name ? { description: (identity?.name ?? row.name)! } : {}),
    ...(identity?.supplier ? { supplierId: identity.supplier } : {}),
    ...(identity?.sku ? { supplierSku: identity.sku } : {}),
    ...(identity?.isSingle === true ? { isSingle: true } : {}),
    ...(row.size ? { size: row.size } : {}),
    cases: quantity,
  };
}

export default function ProductPriceTable({
  products,
  emptyMessage,
  cartSource,
}: {
  products: readonly SupplierSearchProduct[];
  emptyMessage?: string;
  /**
   * Which screen collected this product.
   *
   * Written to the cart line's origin so the cart can say where it came from.
   * A prop rather than something inferred from the URL, because this
   * component is rendered by two screens and a guess would be right for one
   * of them.
   */
  cartSource: OrderCartSource;
}) {
  // Shared by /product-search and the dashboard's quick search, so gating here
  // covers both without either page having to remember to.
  const gate = useSupplierGate();

  const [prices, setPrices] = useState<
    Map<
      string,
      {
        price?: number;
        status: LivePriceStatus;
        error?: string;
        inStock?: boolean;
        availabilityText?: string;
      }
    >
  >(new Map());
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pricedAt, setPricedAt] = useState<string | null>(null);
  const [skippedRows, setSkippedRows] = useState(0);

  const [discovered, setDiscovered] = useState<DiscoveredOffer[]>([]);
  const [gapsUnchecked, setGapsUnchecked] = useState(0);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, AddState>>({});

  /**
   * Which rows are ALREADY on the retailer's order cart, and at what
   * quantity — keyed by row, refreshed from the server whenever the results
   * change and updated locally the moment an add or a quantity edit succeeds.
   */
  const [cartLines, setCartLines] = useState<Map<string, OrderCartLine>>(new Map());
  /** The one row, if any, whose order-cart quantity is mid-write. */
  const [cartLineBusyKey, setCartLineBusyKey] = useState<string | null>(null);

  const setCartLineFor = useCallback((rowKey: string, line: OrderCartLine) => {
    setCartLines((current) => new Map(current).set(rowKey, line));
  }, []);

  /**
   * What this buyer has ALREADY sent to a basket — `supplier:sku` → quantity.
   */
  const [alreadySent, setAlreadySent] = useState<Map<string, number | undefined>>(new Map());

  /**
   * What is ACTUALLY in each supplier's basket, read from the supplier.
   */
  const [baskets, setBaskets] = useState<BasketSnapshot>({ baskets: new Map(), unreadable: [] });

  const [addsUnavailable, setAddsUnavailable] = useState(false);

  const rows = useMemo(() => {
    const asProducts: SupplierSearchProduct[] = discovered.map((offer) => ({
      supplier: offer.supplierId,
      name: offer.name,
      sku: offer.supplierSku,
      ean: offer.barcode,
      ...(offer.exVatCasePrice !== undefined
        ? { exVatCasePrice: offer.exVatCasePrice, repriced: true }
        : {}),
      ...(offer.inStock !== undefined ? { inStock: offer.inStock } : {}),
      ...(offer.availabilityText ? { availabilityText: offer.availabilityText } : {}),
      ...(offer.sizeText ? { size: offer.sizeText } : {}),
      ...(offer.imageUrl ? { imageUrl: offer.imageUrl } : {}),
      ...(offer.productUrl ? { productUrl: offer.productUrl } : {}),
    }));

    const grouped = group([...products, ...asProducts]);
    return grouped
      .map((row) => ({
        ...row,
        offers: new Map(
          [...row.offers].map(([supplierId, offer]) => {
            const found = prices.get(`${supplierId}:${offer.sku ?? ""}`);
            if (!found) return [supplierId, offer] as const;
            return [
              supplierId,
              {
                ...offer,
                livePrice: found.price,
                status: found.status,
                inStock: found.inStock,
                ...(found.availabilityText ? { availabilityText: found.availabilityText } : {}),
              },
            ] as const;
          }),
        ),
      }))
      .map(withWinner);
  }, [products, prices, discovered]);

  const pairSignature = useMemo(
    () =>
      rows
        .flatMap((row) =>
          [...row.offers.values()].filter((o) => o.sku).map((o) => pairKey(o.supplier, o.sku!)),
        )
        .sort()
        .join("|"),
    [rows],
  );

  /**
   * Read the REAL baskets for the suppliers these results actually name.
   */
  const basketSuppliers = useMemo(
    () =>
      [
        ...new Set(
          rows
            .flatMap((row) => [...row.offers.values()].map((offer) => offer.supplier))
            .filter((id) => supportsCart(id)),
        ),
      ]
        .sort()
        .join("|"),
    [rows],
  );

  useEffect(() => {
    if (!basketSuppliers) {
      setBaskets({ baskets: new Map(), unreadable: [] });
      return;
    }

    let cancelled = false;
    void readBaskets(basketSuppliers.split("|")).then((snapshot) => {
      if (!cancelled) setBaskets(snapshot);
    });

    return () => {
      cancelled = true;
    };
  }, [basketSuppliers]);

  useEffect(() => {
    if (!pairSignature) {
      setAlreadySent(new Map());
      return;
    }

    let cancelled = false;
    const items = pairSignature.split("|").map((pair) => {
      const at = pair.indexOf(":");
      return { supplierId: pair.slice(0, at), sku: pair.slice(at + 1) };
    });

    void fetchBasketAdds(items)
      .then((adds) => {
        if (cancelled) return;
        setAddsUnavailable(false);
        setAlreadySent(new Map(adds.map((add) => [pairKey(add.supplierId, add.sku), add.quantity])));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAddsUnavailable(true);
        // eslint-disable-next-line no-console
        console.warn("[basket adds] could not be read —", error);
      });

    return () => {
      cancelled = true;
    };
  }, [pairSignature]);

  const columns = useMemo(() => {
    const present = new Set<string>();
    for (const row of rows) for (const supplierId of row.offers.keys()) present.add(supplierId);
    return SUPPLIER_ORDER.filter((id) => present.has(id)).concat(
      [...present].filter((id) => !SUPPLIER_ORDER.includes(id)),
    );
  }, [rows]);

  /** Rows that can actually be ordered right now. */
  const orderable = useMemo(
    () => rows.filter((row) => row.best !== undefined && supportsCart(row.best.supplierId)),
    [rows],
  );

  /** True when any of this row's suppliers already holds it. */
  const alreadyOnAnOrder = (row: Row): boolean =>
    [...row.offers.values()].some(
      (offer) => offer.sku && alreadySent.has(pairKey(offer.supplier, offer.sku)),
    );

  /**
   * ── SELECTING FOR THE ORDER CART NEEDS NO PRICES ──────────────────────────
   *
   * The central Order Cart and a supplier Basket are different things, and
   * only the second needs a winner. The cart is the retailer's own working
   * list: it needs an IDENTITY — a barcode, or a supplier's own code.
   */
  const selectableForCart = useMemo(
    () => rows.filter((row) => Boolean(row.ean) || Boolean(identityOf(row)?.sku)),
    [rows],
  );

  const selectedForCart = selectableForCart.filter((row) => picked.has(row.key));

  /** The BASKET selection is narrower, and stays that way. */
  const selected = orderable.filter((row) => picked.has(row.key) && !alreadyOnAnOrder(row));

  const [cartBusy, setCartBusy] = useState(false);
  const [cartResult, setCartResult] = useState<string | null>(null);

  /**
   * Ask the cart which of these results it already holds, in ONE request.
   *
   * `requestKey` is each row's own key — the identity the cart matched a line
   * on is server-side encoding this screen never needs to know — so a match
   * comes back already lined up with a row.
   *
   * Re-run whenever the searched rows change. A row that starts out not on
   * the cart is corrected the moment an add succeeds (see `setCartLineFor`),
   * so this is a background refresh rather than the only source of truth.
   */
  const refreshCartLines = useCallback(async () => {
    if (selectableForCart.length === 0) {
      setCartLines(new Map());
      return;
    }

    try {
      const items = selectableForCart.map((row) => ({
        ...asCartItem(row, identityOf(row), 1),
        requestKey: row.key,
      }));
      const matches = await lookupOrderCartLines(items);
      setCartLines(new Map(matches.map((match) => [match.requestKey, match])));
    } catch {
      // Best effort: a failed lookup just means rows show an Add button
      // instead of their true state, which is what they showed before this
      // existed. Nothing here is worth interrupting a search over.
    }
  }, [selectableForCart]);

  useEffect(() => {
    void refreshCartLines();
  }, [refreshCartLines]);

  /**
   * Change (or remove) how many of an already-added row are on the cart.
   *
   * Zero is not a quantity anywhere in the central cart — the − button
   * removes the line rather than writing one, the same rule the order cart
   * page's own stepper follows.
   */
  const changeCartLineQuantity = async (rowKey: string, line: OrderCartLine, next: number) => {
    const cases = Math.max(0, Math.floor(next));
    setCartLineBusyKey(rowKey);
    try {
      if (cases <= 0) {
        await removeOrderListLine(line.lineId);
        setCartLines((current) => {
          const copy = new Map(current);
          copy.delete(rowKey);
          return copy;
        });
        return;
      }

      const updated = await setOrderListCases(line.lineId, cases);
      const stored = updated.lines.find((entry) => entry.id === line.lineId);
      setCartLineFor(rowKey, { lineId: line.lineId, cases: stored?.cases ?? cases });
    } catch (error) {
      setCartResult(
        error instanceof ApiError ? error.message : "Could not update your order cart.",
      );
    } finally {
      setCartLineBusyKey(null);
    }
  };

  /**
   * Put every ticked product on the central Order Cart, in ONE action.
   */
  const addSelectedToCart = async () => {
    if (selectedForCart.length === 0) return;

    setCartBusy(true);
    setCartResult(null);

    try {
      const result = await addToOrderCart(
        selectedForCart.map((row) =>
          asCartItem(row, identityOf(row), Math.max(1, qty[row.key] ?? 1)),
        ),
        { source: cartSource },
      );

      const addedCount = result.lines.filter((line) => line.outcome === "added").length;
      const present = result.lines.length - addedCount;
      const skipped = result.skipped?.length ?? 0;

      setCartResult(
        [
          addedCount > 0 ? `${addedCount} added to your order cart` : null,
          present > 0 ? `${present} already there` : null,
          skipped > 0 ? `${skipped} could not be identified` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Nothing to add",
      );

      // Ticks cleared only for what actually landed, so a refused product
      // stays selected and visible rather than quietly disappearing.
      if (skipped === 0) setPicked(new Set());
      void refreshCartLines();
    } catch (error) {
      setCartResult(error instanceof ApiError ? error.message : "Could not reach your order cart.");
    } finally {
      setCartBusy(false);
    }
  };

  const fetchPrices = async () => {
    if (!gate.guard()) return;

    const items: { supplierId: string; sku: string }[] = [];
    let unpricedRows = 0;

    for (const row of rows) {
      const pairs = [...row.offers.values()]
        .filter((offer) => offer.sku)
        .map((offer) => ({ supplierId: offer.supplier, sku: offer.sku! }));

      if (pairs.length === 0) continue;
      if (items.length + pairs.length > MAX_PRICE_ITEMS) {
        unpricedRows += 1;
        continue;
      }
      items.push(...pairs);
    }

    const discover: { barcode: string; supplierIds: string[] }[] = [];

    for (const row of rows.slice(0, MAX_DISCOVERY_ROWS)) {
      if (!row.ean) continue;

      const covered = new Set<string>();
      for (const supplierId of row.offers.keys()) {
        covered.add(supplierId.startsWith("barrygroup") ? "barrygroup-ambient" : supplierId);
      }

      const missing = DISCOVERY_ROSTER.filter((supplierId) => !covered.has(supplierId));
      if (missing.length > 0) discover.push({ barcode: row.ean, supplierIds: missing });
    }

    const uncheckedRows = rows
      .slice(MAX_DISCOVERY_ROWS)
      .filter((row) => row.ean && row.offers.size < DISCOVERY_ROSTER.length).length;

    if (items.length === 0 && discover.length === 0) return;

    setPricing(true);
    setPriceError(null);
    try {
      const result = await fetchLivePrices(items, discover);
      setPrices(
        new Map(
          result.prices.map((entry) => [
            `${entry.supplierId}:${entry.sku}`,
            {
              ...(entry.exVatCasePrice !== undefined ? { price: entry.exVatCasePrice } : {}),
              status: entry.status ?? (entry.repriced ? "priced" : "not-found"),
              ...(entry.inStock !== undefined ? { inStock: entry.inStock } : {}),
              ...(entry.availabilityText ? { availabilityText: entry.availabilityText } : {}),
              ...(entry.error ? { error: entry.error } : {}),
            },
          ]),
        ),
      );
      for (const entry of result.prices) {
        if (entry.status === "unavailable" && entry.error) {
          // eslint-disable-next-line no-console
          console.warn(
            `[live prices] ${entry.supplierId} ${entry.sku} could not be priced — ${entry.error}`,
          );
        }
      }

      setDiscovered(
        (result.discovered ?? []).map((offer) => ({
          ...offer,
          barcode: offer.barcode.replace(/^0+/, ""),
        })),
      );

      for (const entry of result.discoveryErrors ?? []) {
        // eslint-disable-next-line no-console
        console.warn(
          `[live prices] ${entry.supplierId} could not be asked about ${entry.barcode} — ${entry.message}`,
        );
      }

      setGapsUnchecked(uncheckedRows + (result.discoverySkipped ?? 0));
      setPricedAt(result.pricedAt);
      setSkippedRows(unpricedRows);
    } catch (error) {
      setPriceError(error instanceof ApiError ? error.message : "Could not fetch prices.");
    } finally {
      setPricing(false);
    }
  };

  /** Send one row's winning line to that supplier's basket. */
  const addOne = async (row: Row): Promise<AddState> => {
    if (!row.best) return { kind: "error", text: "No live price to order on." };
    const quantity = Math.max(1, qty[row.key] ?? 1);

    try {
      const result = await addItems(
        [{ sku: row.best.sku, quantity, name: row.name }],
        row.best.supplierId as CartSupplier,
      );
      const failed = result.results.find((entry) => entry.outcome === "failed");

      // WE JUST CHANGED THIS BASKET, so the cached copy is wrong.
      invalidateBasket(row.best.supplierId);

      return failed
        ? { kind: "error", text: failed.error ?? "The supplier rejected this line." }
        : { kind: "ok", text: `${quantity} × in ${cartSupplierLabel(row.best.supplierId)}` };
    } catch (error) {
      return {
        kind: "error",
        text:
          error instanceof VerificationRequiredError
            ? "This product needs checking before it can be added."
            : error instanceof ApiError
              ? error.message
              : "Could not reach the basket.",
      };
    }
  };

  const addRow = async (row: Row) => {
    setAdding(row.key);
    const state = await addOne(row);
    setAdded((current) => ({ ...current, [row.key]: state }));
    setPicked((current) => {
      const next = new Set(current);
      next.delete(row.key);
      return next;
    });
    setAdding(null);
  };

  const addSelected = async () => {
    setAdding("__selection__");
    const outcomes = await Promise.all(
      selected.map(async (row) => [row.key, await addOne(row)] as const),
    );

    setAdded((current) => {
      const next = { ...current };
      for (const [key, state] of outcomes) next[key] = state;
      return next;
    });
    setPicked(new Set());
    setAdding(null);
  };

  if (rows.length === 0) {
    return emptyMessage ? (
      <p className="px-4 py-6 text-[12.5px] text-ink-soft">{emptyMessage}</p>
    ) : null;
  }

  const busy = adding === "__selection__";

  const views = rows.map((row) => {
    const quantity = Math.max(1, qty[row.key] ?? 1);

    /**
     * IN THE BASKET RIGHT NOW — asked of the supplier, not of our own records.
     */
    const sent = [...row.offers.values()]
      .map((offer) => ({
        supplierId: offer.supplier,
        sku: offer.sku,
        present: inBasket(baskets, offer.supplier, offer.sku),
      }))
      .find((offer) => offer.present === true);

    const state: AddState | undefined =
      added[row.key] ??
      (sent
        ? {
            kind: "already" as const,
            text: (() => {
              const quantity = basketQuantity(baskets, sent.supplierId, sent.sku);
              return `${quantity !== undefined ? `${quantity} × ` : ""}in ${cartSupplierLabel(sent.supplierId)} basket`;
            })(),
          }
        : undefined);

    const identity = identityOf(row);

    return {
      row,
      quantity,
      state,
      canOrder: row.best !== undefined && supportsCart(row.best.supplierId),
      canSelect: Boolean(row.ean) || Boolean(identityOf(row)?.sku),
      identity,
      link: identity ? realPage(identity) : undefined,
      cartLine: cartLines.get(row.key),
    };
  });

  return (
    <div>
      {gate.modal}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <p className="text-[12px] text-ink-soft">
          {pricedAt ? (
            <>
              Live prices fetched{" "}
              {new Date(pricedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {orderable.length} orderable
            </>
          ) : (
              " "
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pricing}
            onClick={() => void fetchPrices()}
            className="rounded-md bg-teal-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {pricing ? "Fetching live prices…" : pricedAt ? "Refresh prices" : "Fetch live prices"}
          </button>

          {/* ── THE ORDER CART, WHICH NEEDS NO PRICES ──────────────────────
              Always offered. The cart is the retailer's own working list and
              wants an identity, not a winner. */}
          <button
            type="button"
            disabled={selectedForCart.length === 0 || cartBusy}
            onClick={() => void addSelectedToCart()}
            title={
              selectedForCart.length === 0
                ? "Tick the products you want, then add them to your order cart"
                : `Add ${selectedForCart.length} product${selectedForCart.length === 1 ? "" : "s"} to your order cart`
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <NavIcon name="basket" size={15} strokeWidth={2} />
            {cartBusy
              ? "Adding…"
              : selectedForCart.length === 0
                ? "Add to Order Cart"
                : `Add ${selectedForCart.length} to Order Cart`}
          </button>

          {pricedAt && (
            <button
              type="button"
              disabled={selected.length === 0 || busy}
              onClick={() => void addSelected()}
              title={
                selected.length === 0
                  ? "Tick the products you want, then add them"
                  : `Add ${selected.length} product${selected.length === 1 ? "" : "s"} to their cheapest supplier`
              }
              className="rounded-md border border-teal-600 px-3.5 py-1.5 text-[12.5px] font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? "Adding…"
                : selected.length === 0
                  ? "Add to basket"
                  : `Add ${selected.length} to basket`}
            </button>
          )}

          {cartResult && (
            <span role="status" className="text-[12px] text-ink-soft">
              {cartResult}
            </span>
          )}
        </div>
      </div>

      {priceError && (
        <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-600">
          {priceError}
        </p>
      )}

      {addsUnavailable && (
        <p className="mx-4 mt-3 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          Could not check what is already in your baskets, so a product you have already
          ordered will still show an Add button here. Adding again sends a second case.
        </p>
      )}

      {gapsUnchecked > 0 && (
        <p className="mx-4 mt-3 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {gapsUnchecked} product{gapsUnchecked === 1 ? "" : "s"} further down were not
          checked at the suppliers our catalogues do not list them under — one press asks a
          limited number of times. Search the barcode on its own to check those.
        </p>
      )}

      {skippedRows > 0 && (
        <p className="mx-4 mt-3 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {skippedRows} product{skippedRows === 1 ? "" : "s"} were not priced — one press asks
          the suppliers at most {MAX_PRICE_ITEMS} times. Narrow the search to price them.
        </p>
      )}

      {/* ---- Phones ---- */}
      <div className="divide-y divide-line lg:hidden">
        {views.map((view) => (
          <SearchRowCard
            key={view.row.key}
            view={view}
            columns={columns}
            picked={picked.has(view.row.key)}
            onPick={(checked) =>
              setPicked((current) => {
                const next = new Set(current);
                if (checked) next.add(view.row.key);
                else next.delete(view.row.key);
                return next;
              })
            }
            onQuantityChange={(next) =>
              setQty((current) => ({ ...current, [view.row.key]: next }))
            }
            adding={adding}
            onAdd={() => void addRow(view.row)}
            cartSource={cartSource}
            cartLineBusy={cartLineBusyKey === view.row.key}
            onCartAdded={(line) => setCartLineFor(view.row.key, line)}
            onCartLineQuantityChange={(line, next) =>
              void changeCartLineQuantity(view.row.key, line, next)
            }
          />
        ))}
      </div>

      {/* ---- Everything wider ---- */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="border-b border-line bg-canvas text-[12px] text-ink-soft">
            <tr>
              <th className="w-8 px-2 py-2">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-3 py-2 text-left font-medium">Product</th>
              {columns.map((supplierId) => (
                <th key={supplierId} className="px-3 py-2 text-right font-medium">
                  {cartSupplierLabel(supplierId)}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">Qty</th>
              {/* TWO DESTINATIONS, AND THEY ARE NOT THE SAME THING. */}
              <th className="px-3 py-2 text-left font-medium">Order cart</th>
              <th className="px-3 py-2 text-left font-medium">Basket</th>
            </tr>
          </thead>

          <tbody>
            {views.map(({ row, quantity, state, canOrder, identity, link, cartLine }) => {
              return (
                <tr key={row.key} className="border-b border-line last:border-0">
                  <td className="px-2 py-2.5 align-top">
                    <input
                      type="checkbox"
                      checked={picked.has(row.key)}
                      disabled={!(Boolean(row.ean) || Boolean(identityOf(row)?.sku))}
                      aria-label={`Select ${row.name}`}
                      onChange={(event) =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(row.key);
                          else next.delete(row.key);
                          return next;
                        })
                      }
                      className="mt-1 h-3.5 w-3.5 accent-teal-600 disabled:opacity-30"
                    />
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="flex gap-2.5">
                      <Thumb src={identity?.imageUrl} alt={row.name} />
                      <div className="min-w-0">
                        <div className="text-ink">{identity?.name ?? row.name}</div>
                        <div className="text-[11.5px] text-ink-faint">
                          {row.brand && `${row.brand} · `}
                          {(identity?.ean ?? row.ean) && (
                            <span className="nums">EAN {identity?.ean ?? row.ean}</span>
                          )}
                          {row.size && `${identity?.ean ?? row.ean ? " · " : ""}${row.size}`}
                          {` · ${row.offers.size} supplier${row.offers.size === 1 ? "" : "s"}`}
                        </div>
                        {link && identity && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-link hover:underline"
                          >
                            View at {cartSupplierLabel(identity.supplier)} ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </td>

                  {columns.map((supplierId) => {
                    const offer = row.offers.get(supplierId);
                    const isBest = row.best?.supplierId === supplierId;

                    return (
                      <td
                        key={supplierId}
                        className={`px-3 py-2.5 text-right ${isBest ? "bg-good-50/60" : ""}`}
                      >
                        {!offer ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <OfferPrice offer={offer} supplierId={supplierId} isBest={isBest} />
                        )}
                      </td>
                    );
                  })}

                  {/* ONE STEPPER, TWO MEANINGS — see the phone card for the
                      full reasoning. Once the row is on the order cart, this
                      number IS that line's own quantity, live. */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={cartLine ? cartLineBusyKey === row.key : quantity <= 1}
                        onClick={() =>
                          cartLine
                            ? void changeCartLineQuantity(row.key, cartLine, cartLine.cases - 1)
                            : setQty((c) => ({ ...c, [row.key]: quantity - 1 }))
                        }
                        aria-label={
                          cartLine
                            ? cartLine.cases <= 1
                              ? `Remove ${row.name} from the order cart`
                              : `Fewer ${row.name} in the order cart`
                            : `Decrease ${row.name}`
                        }
                        className="h-6 w-6 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
                      >
                        {cartLine && cartLine.cases <= 1 ? "🗑" : "−"}
                      </button>
                      <span className="w-7 text-center tabular-nums text-ink">
                        {cartLine ? cartLine.cases : quantity}
                      </span>
                      <button
                        type="button"
                        disabled={cartLine ? cartLineBusyKey === row.key : false}
                        onClick={() =>
                          cartLine
                            ? void changeCartLineQuantity(row.key, cartLine, cartLine.cases + 1)
                            : setQty((c) => ({ ...c, [row.key]: quantity + 1 }))
                        }
                        aria-label={cartLine ? `More ${row.name} in the order cart` : `Increase ${row.name}`}
                        className="h-6 w-6 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
                      >
                        ＋
                      </button>
                    </div>
                  </td>

                  {/* NOT GATED ON A LIVE PRICE, unlike the basket beside it. */}
                  <td className="px-3 py-2.5">
                    {cartLine ? (
                      <OrderCartBadge />
                    ) : (
                      <AddToOrderCartButton
                        item={asCartItem(row, identity, quantity)}
                        source={cartSource}
                        size="compact"
                        onAdded={(line) => setCartLineFor(row.key, line)}
                      />
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    {state ? (
                      <span
                        className={`text-[11.5px] ${
                          state.kind === "error"
                            ? "text-red-600"
                            : state.kind === "ok"
                              ? "text-good-600"
                              : "text-ink-soft"
                        }`}
                        title={
                          state.kind === "already"
                            ? "Sent to this supplier's basket earlier. Open the basket to change it."
                            : undefined
                        }
                      >
                        {state.kind === "ok" ? "🟢 " : state.kind === "already" ? "✓ " : ""}
                        {state.text}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canOrder || adding !== null}
                        onClick={() => void addRow(row)}
                        title={
                          canOrder
                            ? `Add ${quantity} × to the ${cartSupplierLabel(row.best!.supplierId)} basket`
                            : row.best
                              ? `${cartSupplierLabel(row.best.supplierId)} has no basket integration`
                              : "Fetch live prices first — nothing is ordered on a catalogue price"
                        }
                        className="rounded-md border border-teal-600 px-2.5 py-1 text-[11.5px] font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {adding === row.key ? "Adding…" : "＋ Add"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2.5 text-[11.5px] text-ink-faint">
        Fetching also asks the suppliers our catalogues do not list this product under —
        absent from a sync is not the same as not stocked. The green cell is the cheapest
        live price from a supplier who can supply it, and the barcode and link belong to
        that supplier. A supplier listed as out of stock keeps its
        price on screen but cannot win the line. Adding sends it to the winner&apos;s basket —
        the main supplier does not override a genuinely cheaper one here.
      </p>
    </div>
  );
}
