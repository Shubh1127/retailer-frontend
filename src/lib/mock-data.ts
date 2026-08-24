// Static mock data for UI-only preview. Shapes mirror the backend's real
// domain types (Supplier, ProductMatch, PriceQuote, AllocationResult, etc.)
// so the screens read true to what the API will eventually return.

export type SupplierId = string
  | "musgrave"
  | "barrygroup"
  | "oreilly"
  | "kadona"
  | "savage"
  | "valuecentre";

export interface SupplierMeta {
  id: SupplierId;
  name: string;
  short: string;
  isMain: boolean;
  thresholdPct: number;
  channel: "Quick-order paste" | "Webview cart" | "Pick list only";
  minOrderValue: number;
  deliveryFee: number;
  color: string; // small swatch used in chips/legends only
}

export const suppliers: SupplierMeta[] = [
  { id: "musgrave", name: "Musgrave Marketplace", short: "Musgrave", isMain: true, thresholdPct: 0.10, channel: "Quick-order paste", minOrderValue: 0, deliveryFee: 0, color: "#0F766E" },
  // ONE entry for the retailer view. The backend keeps Barry as two suppliers
  // (ambient / chill) because they are separate baskets with separate delivery
  // dates, and the admin app shows that split — but a buyer comparing prices
  // sees a single "Barry Group". See displaySupplierId in lib/api/cart.ts.
  { id: "barrygroup", name: "Barry Group", short: "Barry", isMain: false, thresholdPct: 0.13, channel: "Webview cart", minOrderValue: 0, deliveryFee: 0, color: "#4F46E5" },
  { id: "oreilly", name: "O'Reillys Wholesale", short: "O'Reillys", isMain: false, thresholdPct: 0.13, channel: "Webview cart", minOrderValue: 150, deliveryFee: 6, color: "#0891B2" },
  // Live: searched, priced and cart-wired like the other three. The minimum is
  // the one genuinely published figure in this list — Kadona state EUR 1,000 on
  // the cart page and refuse checkout below it, measured on the GROSS total.
  { id: "kadona", name: "Kadona Wholesale", short: "Kadona", isMain: false, thresholdPct: 0.13, channel: "Webview cart", minOrderValue: 1000, deliveryFee: 0, color: "#7C3AED" },
  // { id: "savage", name: "Savage & Whitten", short: "Savage", isMain: false, thresholdPct: 0.13, channel: "Pick list only", minOrderValue: 0, deliveryFee: 0, color: "#B45309" },
  // { id: "valuecentre", name: "Value Centre Cavan", short: "Value Centre", isMain: false, thresholdPct: 0.13, channel: "Webview cart", minOrderValue: 50, deliveryFee: 7.5, color: "#BE123C" },
];

export const supplierById = (id: string) =>
  suppliers.find((s) => s.id === id) ?? suppliers[0];

export type LineStatus = "main" | "diverted" | "flagged" | "needs-match";

export interface ComparisonRow {
  gtin: string;
  name: string;
  pack: string; // e.g. "24 × 330ml"
  department: string;
  cases: number;
  status: LineStatus;
  winnerId: SupplierId;
  quotes: Partial<Record<SupplierId, { exVatCase: number; perUnit: number; promo?: boolean; inStock: boolean }>>;
  savingVsMain: number; // per week, ex-VAT
}

export const comparisonRows: ComparisonRow[] = [
  {
    gtin: "05000000000018",
    name: "Cola 24×330ml Cans",
    pack: "24 × 330ml",
    department: "Soft Drinks",
    cases: 10,
    status: "diverted",
    winnerId: "valuecentre",
    savingVsMain: 20.0,
    quotes: {
      musgrave: { exVatCase: 12.0, perUnit: 0.0152, inStock: true },
      valuecentre: { exVatCase: 10.0, perUnit: 0.0126, inStock: true },
      barrygroup: { exVatCase: 12.4, perUnit: 0.0157, inStock: true },
      oreilly: { exVatCase: 11.9, perUnit: 0.0150, inStock: true },
    },
  },
  {
    gtin: "05000000000025",
    name: "Baked Beans 12×400g",
    pack: "12 × 400g",
    department: "Ambient Grocery",
    cases: 8,
    status: "main",
    winnerId: "musgrave",
    savingVsMain: 0,
    quotes: {
      musgrave: { exVatCase: 8.0, perUnit: 0.00167, inStock: true },
      valuecentre: { exVatCase: 8.05, perUnit: 0.00168, inStock: true },
      barrygroup: { exVatCase: 8.35, perUnit: 0.00174, inStock: true },
      kadona: { exVatCase: 8.2, perUnit: 0.00171, inStock: false },
    },
  },
  {
    gtin: "05000000000032",
    name: "Vegetable Oil 12×1L",
    pack: "12 × 1L",
    department: "Ambient Grocery",
    cases: 4,
    status: "main",
    winnerId: "musgrave",
    savingVsMain: 0,
    quotes: {
      musgrave: { exVatCase: 20.0, perUnit: 1.667, inStock: true },
      valuecentre: { exVatCase: 15.0, perUnit: 1.25, promo: true, inStock: true },
      oreilly: { exVatCase: 19.6, perUnit: 1.633, inStock: true },
    },
  },
  {
    gtin: "05000000000049",
    name: "Whole Milk 2×12×1L",
    pack: "2 × 12 × 1L",
    department: "Chilled",
    cases: 6,
    status: "flagged",
    winnerId: "musgrave",
    savingVsMain: 0,
    quotes: {
      musgrave: { exVatCase: 22.4, perUnit: 0.933, inStock: true },
      barrygroup: { exVatCase: 12.1, perUnit: 0.504, inStock: true },
      kadona: { exVatCase: 21.9, perUnit: 0.9125, inStock: true },
    },
  },
  {
    gtin: "05000000000056",
    name: "Digestive Biscuits 24×400g",
    pack: "24 × 400g",
    department: "Confectionery",
    cases: 5,
    status: "diverted",
    winnerId: "barrygroup",
    savingVsMain: 9.6,
    quotes: {
      musgrave: { exVatCase: 28.8, perUnit: 0.003, inStock: true },
      barrygroup: { exVatCase: 26.88, perUnit: 0.0028, inStock: true },
      savage: { exVatCase: 27.5, perUnit: 0.00286, inStock: true },
    },
  },
  {
    gtin: "05000000000063",
    name: "Rustic White Rolls 6×6pk",
    pack: "6 × 6-pack",
    department: "Bakery",
    cases: 12,
    status: "needs-match",
    winnerId: "musgrave",
    savingVsMain: 0,
    quotes: {
      musgrave: { exVatCase: 9.6, perUnit: 0.267, inStock: true },
    },
  },
];

export interface BasketSummary {
  supplierId: SupplierId;
  lineCount: number;
  goodsExVat: number;
  deliveryFee: number;
  meetsMinOrder: boolean;
}

export const baskets: BasketSummary[] = [
  { supplierId: "musgrave", lineCount: 4, goodsExVat: 612.4, deliveryFee: 0, meetsMinOrder: true },
  { supplierId: "valuecentre", lineCount: 1, goodsExVat: 100.0, deliveryFee: 7.5, meetsMinOrder: true },
  { supplierId: "barrygroup", lineCount: 1, goodsExVat: 134.4, deliveryFee: 0, meetsMinOrder: true },
];

export const weeklyTotals = {
  goodsExVat: 846.8,
  deliveryExVat: 7.5,
  grandTotalExVat: 854.3,
  baselineAllFromMainExVat: 884.3,
  savingExVat: 30.0,
};

export type ReconcileStatus = "green" | "amber" | "red";

export interface ReconcileRow {
  sku: string;
  name: string;
  supplierId: SupplierId;
  status: ReconcileStatus;
  intendedCases: number;
  cartCases?: number;
  intendedPrice: number;
  cartPrice?: number;
  driftPct?: number;
  reason: string;
}

export const reconcileRows: ReconcileRow[] = [
  { sku: "V-COLA", name: "Cola 24×330ml Cans", supplierId: "valuecentre", status: "amber", intendedCases: 10, cartCases: 10, intendedPrice: 10.0, cartPrice: 10.6, driftPct: 0.06, reason: "Price drift 6.0% vs winning basis €10.00 (cart €10.60)." },
  { sku: "BG-DIGB", name: "Digestive Biscuits 24×400g", supplierId: "barrygroup", status: "green", intendedCases: 5, cartCases: 5, intendedPrice: 26.88, cartPrice: 26.88, reason: "SKU, quantity and price all match intent." },
  { sku: "OR-ROLL", name: "Rustic White Rolls 6×6pk", supplierId: "oreilly", status: "red", intendedCases: 12, cartCases: 0, intendedPrice: 9.4, reason: "SKU not present in cart after fill." },
  { sku: "KD-MILK", name: "Whole Milk 2×12×1L", supplierId: "kadona", status: "red", intendedCases: 6, cartCases: 4, intendedPrice: 21.9, cartPrice: 21.9, reason: "Quantity mismatch: intended 6 case(s), cart has 4." },
];

export type Provenance = "invoice" | "ean_exact" | "human_confirmed" | "llm_suggested";

export interface MappingRow {
  id: string;
  name: string;
  pack: string;
  supplierId: SupplierId;
  supplierSku: string;
  provenance: Provenance;
  confidence: number;
  confirmed: boolean;
}

export const mappingRows: MappingRow[] = [
  { id: "m1", name: "Cola 24×330ml Cans", pack: "24 × 330ml", supplierId: "musgrave", supplierSku: "M-COLA", provenance: "invoice", confidence: 1, confirmed: true },
  { id: "m2", name: "Cola 24×330ml Cans", pack: "24 × 330ml", supplierId: "valuecentre", supplierSku: "V-COLA", provenance: "ean_exact", confidence: 1, confirmed: true },
  { id: "m3", name: "Baked Beans 12×400g", pack: "12 × 400g", supplierId: "kadona", supplierSku: "KD-BEAN-12", provenance: "llm_suggested", confidence: 0.72, confirmed: false },
  { id: "m4", name: "Digestive Biscuits 24×400g", pack: "24 × 400g", supplierId: "savage", supplierSku: "SW-4471", provenance: "human_confirmed", confidence: 1, confirmed: true },
  { id: "m5", name: "Rustic White Rolls 6×6pk", pack: "6 × 6-pack", supplierId: "barrygroup", supplierSku: "BG-2210", provenance: "llm_suggested", confidence: 0.61, confirmed: false },
];

export interface PriceHistoryPoint {
  date: string;
  price: number;
}

export const priceHistory: Record<string, PriceHistoryPoint[]> = {
  "05000000000018": [
    { date: "Jun 01", price: 12.0 }, { date: "Jun 08", price: 12.0 }, { date: "Jun 15", price: 11.8 },
    { date: "Jun 22", price: 11.8 }, { date: "Jun 29", price: 10.4 }, { date: "Jul 06", price: 10.0 }, { date: "Jul 13", price: 10.0 },
  ],
};

export const recentPriceChanges = [
  { name: "Cola 24×330ml Cans", supplierId: "valuecentre" as SupplierId, oldPrice: 10.6, newPrice: 10.0, changePct: -0.057 },
  { name: "Vegetable Oil 12×1L", supplierId: "valuecentre" as SupplierId, oldPrice: 18.45, newPrice: 15.0, changePct: -0.187 },
  { name: "Whole Milk 2×12×1L", supplierId: "barrygroup" as SupplierId, oldPrice: 12.9, newPrice: 12.1, changePct: -0.062 },
  { name: "Digestive Biscuits 24×400g", supplierId: "musgrave" as SupplierId, oldPrice: 27.6, newPrice: 28.8, changePct: 0.043 },
];

export const eur = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `€${n.toFixed(2)}` : "—";

export const pct = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`
    : "—";
