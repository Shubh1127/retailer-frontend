/**
 * Turning each source's own shape into ONE product view.
 *
 * ── WHY ADAPTERS RATHER THAN ONE CLEVER COMPONENT ───────────────────────────
 *
 * Several sources feed the central cart — `order_list`, `scan`,
 * `product_search`, `dashboard_search`, `job_result` — and a job result
 * additionally exists outside the cart entirely, on the job page. They
 * genuinely know different things: a job row has allocation and a chosen
 * supplier, a scan has a barcode and whatever a live search found, an EPOS
 * line has the shop's own article code and no barcode at all.
 *
 * So the SHAPE is translated here and the PRESENTATION is single (see
 * `ProductResultCard`). Anything a source knows that the others do not stays
 * with the source, and only the part that is genuinely the same — "what is
 * this product and who sells it" — comes through here.
 *
 * ── WHAT IS DELIBERATELY NOT TRANSLATED ─────────────────────────────────────
 *
 * Savings. They are computed by the job pipeline and rendered by the job
 * result's own table; carrying them into a shared view would mean a second
 * implementation of a number the business acts on.
 */

import type { ProductResultOffer, ProductResultView } from "@/components/ProductResultCard";
import { cartSupplierLabel } from "@/lib/api/cart";
import type { CartOffer, OrderCartSource, OrderListLine, PricedCartLine } from "@/lib/api/orderList";

/** How a source is worded on screen. Storage names are not labels. */
const SOURCE_LABELS: Record<OrderCartSource, string> = {
  order_list: "Order list",
  scan: "Scan",
  product_search: "Search",
  dashboard_search: "Dashboard",
  job_result: "Job result",
};

export function sourceLabel(source: OrderCartSource): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * What a cart line is CALLED.
 *
 * A description first, because that is what a person reads. Falling back
 * through the identities means a line always has a title — and never shows
 * our own key encoding, which `sku:oreilly:042550` would be.
 */
function titleOfLine(line: OrderListLine): string {
  return (
    line.description?.trim() ||
    line.gtin14?.trim() ||
    line.articleCode?.trim() ||
    line.scannedCode?.trim() ||
    "Unnamed product"
  );
}

/** The identity worth showing beside the name, and what to call it. */
function identityOfLine(line: OrderListLine): { identity?: string; identityLabel?: string } {
  if (line.gtin14?.trim()) return { identity: line.gtin14.trim() };
  if (line.articleCode?.trim()) return { identity: line.articleCode.trim(), identityLabel: "Article" };
  if (line.scannedCode?.trim()) return { identity: line.scannedCode.trim(), identityLabel: "Scanned" };
  if (line.foundSupplierSku?.trim()) return { identity: line.foundSupplierSku.trim(), identityLabel: "SKU" };
  return {};
}

function toOffer(offer: CartOffer): ProductResultOffer {
  return {
    supplierId: offer.supplierId,
    supplierName: cartSupplierLabel(offer.supplierId),
    supplierSku: offer.supplierSku,
    ...(offer.exVatCasePrice !== undefined ? { exVatCasePrice: offer.exVatCasePrice } : {}),
    ...(offer.status ? { status: offer.status } : {}),
    ...(offer.inStock !== undefined ? { inStock: offer.inStock } : {}),
    ...(offer.availabilityText ? { availabilityText: offer.availabilityText } : {}),
    ...(offer.unitsPerCase !== undefined ? { unitsPerCase: offer.unitsPerCase } : {}),
    ...(offer.unitSize !== undefined ? { unitSize: offer.unitSize } : {}),
    ...(offer.uom ? { uom: offer.uom } : {}),
    ...(offer.isSingle !== undefined ? { isSingle: offer.isSingle } : {}),
  };
}

/**
 * ── ADAPTER: a central cart line, whatever its source ───────────────────────
 *
 * ONE adapter for every source, and that is the point of the exercise. The
 * cart already stores every source the same way, so a scan line and an EPOS
 * line differ in the DATA they carry, never in how that data is shaped.
 *
 * The source still travels, as a label, because knowing where a product came
 * from is genuinely useful. It just does not decide the layout.
 */
export function viewFromCartLine(line: OrderListLine, priced?: PricedCartLine): ProductResultView {
  const offers = (priced?.offers ?? []).map(toOffer);

  return {
    key: String(line.id),
    title: titleOfLine(line),
    ...identityOfLine(line),
    ...(line.imageUrl ? { imageUrl: line.imageUrl } : {}),
    ...(line.sizeText
      ? { sizeText: line.sizeText }
      : line.unitSize !== undefined
        ? { sizeText: `${line.unitSize}` }
        : {}),
    ...(line.sources?.length
      ? {
          sources: line.sources.map((entry) => ({
            label: sourceLabel(entry.source),
            title: entry.jobId
              ? `Added from job ${entry.jobId}${entry.sourceRow ? `, row ${entry.sourceRow}` : ""}`
              : `First added from ${sourceLabel(entry.source)}`,
          })),
        }
      : {}),
    offers,
    ...(priced?.best ? { best: priced.best } : {}),
    ...(priced?.pricedAt ? { pricedAt: priced.pricedAt } : {}),
  };
}

/**
 * ── IDENTITY, SHARED WITH THE BACKEND ───────────────────────────────────────
 *
 * What a cart line is de-duplicated by. Mirrors `cartLineKey` in
 * `backend/src/services/orderCart.service.ts` — the barcode first, then the
 * shop's article code, then a supplier's own code.
 *
 * DELIBERATELY NOT canonicalising here — that lives on the server. Callers
 * compare against keys the SERVER produced, and a GTIN is compared on its
 * significant digits.
 */
export function significantDigits(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const trimmed = code.trim().replace(/^0+/, "");
  return trimmed || undefined;
}

/** Is this product already on the central cart? */
export function cartIdentities(lines: readonly OrderListLine[]): Set<string> {
  const keys = new Set<string>();

  for (const line of lines) {
    const gtin = significantDigits(line.gtin14) ?? significantDigits(line.scannedCode);
    if (gtin) keys.add(`gtin:${gtin}`);
    if (line.articleCode?.trim()) keys.add(`article:${line.articleCode.trim()}`);
    if (line.foundSupplierId && line.foundSupplierSku) {
      keys.add(`sku:${line.foundSupplierId}:${line.foundSupplierSku}`);
    }
  }

  return keys;
}

/** The same identities, for something not yet on the cart. */
export function identitiesOf(item: {
  gtin14?: string;
  scannedCode?: string;
  articleCode?: string;
  supplierId?: string;
  supplierSku?: string;
}): string[] {
  const keys: string[] = [];
  const gtin = significantDigits(item.gtin14) ?? significantDigits(item.scannedCode);
  if (gtin) keys.push(`gtin:${gtin}`);
  if (item.articleCode?.trim()) keys.push(`article:${item.articleCode.trim()}`);
  if (item.supplierId && item.supplierSku) keys.push(`sku:${item.supplierId}:${item.supplierSku}`);
  return keys;
}

/** True when any of this product's identities is already on the cart. */
export function isInCart(
  item: Parameters<typeof identitiesOf>[0],
  identities: ReadonlySet<string>,
): boolean {
  return identitiesOf(item).some((key) => identities.has(key));
}
