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
 * supplier" link all belong to the supplier the row is actually offering. They
 * used to come from whichever listing happened to arrive first, so a row won by
 * Kadona could link to a Musgrave search for a barcode Musgrave do not carry —
 * a dead end presented as the product's page.
 *
 * GROUPED ON THE BARCODE, never the name. Four suppliers write the same product
 * four ways, and a matcher loose enough to join those would put two different
 * products in one row and offer the cheaper one for order.
 *
 * CHEAPEST WINS, with no main-supplier preference — the same rule as Scan, and
 * deliberately not the job pipeline's. Somebody asking what one product costs
 * wants the cheapest price now, not the cheapest after a margin rule meant to
 * stop a weekly order churning supplier relationships.
 */

import { useEffect, useMemo, useState } from "react";

import ProductGlyph from "@/components/ProductGlyph";
import { ApiError } from "@/lib/api/client";
import {
  addItems,
  cartSupplierLabel,
  fetchBasketAdds,
  supportsCart,
  VerificationRequiredError,
  type CartSupplier,
} from "@/lib/api/cart";
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
 * Suppliers in a fixed order, so columns do not reshuffle between searches.
 *
 * Also the roster asked about on Fetch: a supplier absent from a row is one our
 * catalogues do not mention, which is not the same as one that does not stock
 * it — see `missingSuppliersFor`.
 */
const SUPPLIER_ORDER = [
  "musgrave",
  "oreilly",
  "barrygroup-ambient",
  "barrygroup-chill",
  "kadona",
];

/**
 * BARRY IS ONE SITE WITH TWO BASKETS, and asking it twice for one barcode is
 * two requests to the same search for the same answer. The search is
 * department-scoped, so one ask covers whichever department the product lives
 * in and comes back tagged with the right basket.
 */
const DISCOVERY_ROSTER = ["musgrave", "oreilly", "barrygroup-ambient", "kadona"];

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
     * A case and the single sold out of it share one barcode at very different
     * prices. Take whichever listing arrived first and a supplier who happens
     * to return their single first looks dramatically cheapest — the row would
     * be comparing one bottle against everyone else's tray, and Add would send
     * the order for the bottle.
     *
     * A price is carried over ONLY when the backend marked it `repriced`, which
     * means it came from the live-fallback tier and was read at the supplier
     * seconds ago. A catalogue price is as old as the last sync and looks
     * identical on screen, so it stays a dash until somebody asks.
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
 * SAID they are out of stock. That last one is why Add points somewhere real:
 * buying on the price of a line the supplier told us they cannot fill is an
 * order that will not arrive, and the saving was never available.
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
 * offering and the only one whose page is worth opening. Before prices are
 * fetched, the first offer that publishes a real product page — a search that
 * finds nothing is a worse link than a picture with no link at all.
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
 *
 * Suppliers publish broken image URLs often enough that this must not be an
 * `<img>` alone — a hole in the row reads as the page being broken, which is a
 * worse lie than a placeholder.
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

/**
 * What the supplier said about supplying it, under their price.
 *
 * THREE STATES, THREE RENDERINGS, and the third is blank. Musgrave and Kadona
 * publish stock; Barry's listing and O'Reilly's search page do not. Drawing "in
 * stock" for a supplier who never said it would be inventing an assurance on
 * their behalf, and drawing "out of stock" would stop a buyer ordering
 * something perfectly available — so silence renders as silence.
 */
function StockNote({
  offer,
  supplierId,
}: {
  offer: Offer;
  supplierId: string;
}) {
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

export default function ProductPriceTable({
  products,
  emptyMessage,
}: {
  products: readonly SupplierSearchProduct[];
  emptyMessage?: string;
}) {
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

  /**
   * Suppliers found by ASKING, rather than by looking them up.
   *
   * Kept apart from `products` so a re-search clears them naturally: they belong
   * to the prices that were fetched, not to the search that found the rows.
   */
  const [discovered, setDiscovered] = useState<DiscoveredOffer[]>([]);
  /** Products whose missing suppliers were NOT asked about, for budget. */
  const [gapsUnchecked, setGapsUnchecked] = useState(0);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, AddState>>({});

  /**
   * What this buyer has ALREADY sent to a basket — `supplier:sku` → quantity.
   *
   * Kept apart from `added`, which is what happened in this session. Together
   * they are what stops the screen forgetting: adding a case used to live in
   * React state alone, so a refresh or a repeat search brought back a bare Add
   * button and the obvious recovery was to press it and send a second case.
   *
   * READ FROM OUR OWN DATABASE, not from the suppliers' baskets. Reading a
   * basket is a live request to a trade account, per supplier, and this runs on
   * every search.
   */
  const [alreadySent, setAlreadySent] = useState<Map<string, number | undefined>>(new Map());

  /**
   * Set when the check itself failed, which is NOT the same as nothing being in
   * a basket — and used to be indistinguishable from it.
   *
   * The table is written on a best-effort basis: a failure there must never
   * break an add that already succeeded at the supplier, so it is logged and
   * swallowed. That is right for the WRITE. Silently swallowing the READ meant
   * a missing table, an expired session and "you have added nothing" all
   * rendered as a bare Add button — so the honest recovery, pressing it again,
   * was also the wrong one.
   */
  const [addsUnavailable, setAddsUnavailable] = useState(false);

  const rows = useMemo(() => {
    /**
     * Discovered suppliers join their row as ordinary offers.
     *
     * Flattened into the same `SupplierSearchProduct` shape rather than carried
     * separately, so everything downstream — the winner, the columns, Add —
     * treats "found in our catalogue" and "found by asking" identically. They
     * are the same claim: this wholesaler sells this product at this price.
     */
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
    // Prices are held separately and merged here, so a re-search does not have
    // to thread them back through the grouping.
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
                // The live answer replaces the catalogue's, including when the
                // live one is "they did not say".
                inStock: found.inStock,
                ...(found.availabilityText
                  ? { availabilityText: found.availabilityText }
                  : {}),
              },
            ] as const;
          }),
        ),
      }))
      .map(withWinner);
  }, [products, prices, discovered]);

  /**
   * Every (supplier, sku) on screen, as a stable string.
   *
   * A string rather than the array itself, so the effect below re-runs when the
   * RESULTS change and not on every render that rebuilds an equal array.
   */
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
        // SAID, not swallowed. The results are still correct and orderable; what
        // is lost is the ability to tell an untouched product from one already
        // on an order, and a buyer needs to know that is what they are missing.
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

  const selected = orderable.filter((row) => picked.has(row.key));

  /** True when any of this row's suppliers already holds it. */
  const alreadyOnAnOrder = (row: Row): boolean =>
    [...row.offers.values()].some(
      (offer) => offer.sku && alreadySent.has(pairKey(offer.supplier, offer.sku)),
    );

  const fetchPrices = async () => {
    // Exactly the supplier/SKU pairs our own data named. Nothing speculative,
    // and never more than the account's budget for one press.
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

    /**
     * The suppliers this row's barcode should also be tried at.
     *
     * A supplier with NO offer at all is one our catalogues never mentioned —
     * the gap this fills. A supplier that has an offer is already in `items`.
     * Barry counts as covered if either basket is present, because one search
     * answers for both.
     */
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

    // Rows past the cap keep whatever our catalogues knew and are not asked
    // about. Counted so it can be said rather than silently looking the same as
    // a supplier that answered nothing.
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
              // Older backends answered without a status; a missing one with no
              // price means the supplier answered and had nothing.
              status: entry.status ?? (entry.repriced ? "priced" : "not-found"),
              // Absent stays absent. A supplier that publishes no stock
              // information must not be shown as either answer.
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

      // Keyed on significant digits, matching how rows are grouped.
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
      // Said out loud rather than silently dropped: a row left at "—" would
      // otherwise read as a supplier that answered nothing.
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

  /**
   * Send every TICKED row to its own cheapest supplier.
   *
   * Ticked, not "everything on screen". A search for "coca cola" returns a
   * dozen packs and a button that ordered all of them would be a footgun with
   * a real supplier basket behind it. Nothing leaves without being chosen.
   */
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

  return (
    <div>
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
            "No supplier has been contacted. Prices appear when you ask for them."
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

          {/* Only once there is something real to order on. Before prices are
              fetched there is no cheapest supplier to send anything to. */}
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

      <div className="overflow-x-auto">
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
              <th className="px-3 py-2 text-left font-medium">Cart</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const quantity = Math.max(1, qty[row.key] ?? 1);

              /**
               * A line already on an order, from any supplier in this row.
               *
               * Checked across ALL of the row's offers rather than just the
               * cheapest: the buyer may have ordered it from Musgrave last week
               * and Kadona may be cheaper today, and "you already have this on
               * a Musgrave order" is the more useful thing to say.
               */
              const sent = [...row.offers.values()]
                .filter((offer) => offer.sku && alreadySent.has(pairKey(offer.supplier, offer.sku)))
                .map((offer) => ({
                  supplierId: offer.supplier,
                  quantity: alreadySent.get(pairKey(offer.supplier, offer.sku!)),
                }))[0];

              const state: AddState | undefined =
                added[row.key] ??
                (sent
                  ? {
                      kind: "already",
                      // PAST TENSE, deliberately. We know we sent it and the
                      // supplier accepted it; we do not know it is still there,
                      // because somebody may have deleted the line at the
                      // supplier's own site since.
                      text: `${sent.quantity !== undefined ? `${sent.quantity} × ` : ""}added to ${cartSupplierLabel(sent.supplierId)}`,
                    }
                  : undefined);
              const canOrder = row.best !== undefined && supportsCart(row.best.supplierId);
              const identity = identityOf(row);
              const link = identity ? realPage(identity) : undefined;

              return (
                <tr key={row.key} className="border-b border-line last:border-0">
                  <td className="px-2 py-2.5 align-top">
                    <input
                      type="checkbox"
                      checked={picked.has(row.key)}
                      disabled={!canOrder || state !== undefined || alreadyOnAnOrder(row)}
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
                          {/* The WINNER's barcode. The row is grouped on one, but
                              a supplier's own spelling of it is the one that
                              works on that supplier's site. */}
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
                          // This supplier does not stock it.
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <>
                            {offer.livePrice !== undefined ? (
                              <div
                                className={`nums font-medium ${isBest ? "text-good-600" : "text-ink"}`}
                              >
                                {eur(offer.livePrice)}
                              </div>
                            ) : offer.status === "unavailable" ? (
                              // WE COULD NOT ASK. Says nothing about stock.
                              //
                              // The backend's reason — a Cloudflare 403 with a
                              // URL and a curl command — is written for whoever
                              // fixes it, so it goes to the console, not into a
                              // tooltip on a shop floor.
                              <span
                                title={`${cartSupplierLabel(supplierId)} could not be reached. This says nothing about whether they stock it.`}
                                className="text-[11.5px] text-red-600"
                              >
                                unavailable
                              </span>
                            ) : offer.status === "not-found" ? (
                              // They answered, and had nothing under this code.
                              <span
                                title={`${cartSupplierLabel(supplierId)} answered, and returned nothing for ${offer.sku ?? "this code"}.`}
                                className="text-[11.5px] text-amber-700"
                              >
                                not found
                              </span>
                            ) : (
                              // Stocked, not yet priced. Nobody has asked.
                              <span className="text-ink-faint">—</span>
                            )}

            {/* DIRECTLY UNDER THE PRICE, because that is the pair a
                                buyer reads: €24.00 is only an offer if they can
                                supply it. Nothing is drawn when the supplier
                                said nothing — see `StockNote`. */}
                            <StockNote offer={offer} supplierId={supplierId} />

                            {/* THE SUPPLIER CODE IS NOT PRINTED HERE.
                                A buyer comparing four prices does not read it,
                                and four columns of digits under four figures
                                buried the numbers that are the point of the
                                table. It is still what Add sends — `row.best`
                                carries it — and it is still on the admin's
                                confirm panel, where somebody does have to check
                                which listing a mapping is pinned to.

                                "single" STAYS. A case and the break-pack single
                                sold out of it share one barcode at very
                                different prices, and an unlabelled single reads
                                as a bargain. */}
                            {offer.isSingle && (
                              <div className="text-[10.5px] font-medium text-amber-700">
                                single
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}

                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={quantity <= 1}
                        onClick={() => setQty((c) => ({ ...c, [row.key]: quantity - 1 }))}
                        aria-label={`Decrease ${row.name}`}
                        className="h-6 w-6 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-7 text-center tabular-nums text-ink">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQty((c) => ({ ...c, [row.key]: quantity + 1 }))}
                        aria-label={`Increase ${row.name}`}
                        className="h-6 w-6 rounded border border-line text-[13px] leading-none text-ink-soft hover:bg-canvas"
                      >
                        ＋
                      </button>
                    </div>
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
