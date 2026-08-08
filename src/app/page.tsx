import MarketingNav from "@/components/MarketingNav";
import {
  ClosingCta,
  HeroActions,
  HeroStats,
  SuppliersLink,
} from "@/components/LandingActions";
import MarketingFooter from "@/components/MarketingFooter";
import PreferenceBand from "@/components/PreferenceBand";
import { suppliers } from "@/lib/mock-data";

export default function LandingPage() {
  return (
    <>
      <MarketingNav />

      {/* Hero */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1 text-[12px] font-medium text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-good-500" /> Built for independent grocers &amp; c-stores
            </div>
            <h1 className="mt-5 text-[2.5rem] font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl">
              One order list.<br /> Every supplier compared.<br /> Best price, automatically.
            </h1>
            <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-ink-soft">
              RetailCompare takes your weekly order — scanned, typed, or pulled from your EPOS —
              and prices it ex-VAT, per base unit, across every wholesaler on your account. Your
              main supplier keeps every line unless someone else beats it by more than your rule allows.
            </p>
            <HeroActions />
            <HeroStats />
          </div>

          {/* Signature element: the preference-band rule visualised */}
          <div className="rounded-xl border border-line bg-surface p-6 shadow-pop">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-ink">Cola 24×330ml Cans</p>
                <p className="text-[12px] text-ink-soft">Musgrave is main supplier · 10% preference band</p>
              </div>
              <span className="rounded-md border border-good-500/20 bg-good-50 px-2 py-0.5 text-[11.5px] font-medium text-good-600">
                Best deal
              </span>
            </div>
            <div className="mt-8">
              <PreferenceBand
                mainPrice={12.0}
                thresholdPct={0.1}
                offers={[
                  { label: "Musgrave", price: 12.0, color: "#0F766E", isMain: true },
                  { label: "Value Centre", price: 10.0, color: "#BE123C" },
                  { label: "Barry Group", price: 12.4, color: "#4F46E5" },
                  { label: "O'Reillys", price: 11.9, color: "#0891B2" },
                ]}
              />
            </div>
            <div className="mt-8 rounded-lg bg-canvas p-4 text-[13px] leading-relaxed text-ink-soft">
              Value Centre is <span className="font-medium text-ink">16.7% cheaper</span> than Musgrave — well
              past the 10% band — so this week&apos;s 10 cases divert there. Saves <span className="font-semibold text-good-600 nums">€20.00</span> on this line alone.
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-[28px] font-semibold tracking-tight text-ink">From order list to placed order, in four steps</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            Each step maps to something you already do — RetailCompare just removes the manual price-checking in between.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { step: "Import", title: "Bring in this week's list", body: "Scan barcodes, paste a CSV, or pull straight from your EPOS Article Order Listing — no re-typing." },
            { step: "Compare", title: "See every supplier, side by side", body: "Prices are normalised ex-VAT and per base unit, so a 24-pack and a 12-pack compare honestly." },
            { step: "Allocate", title: "Best price wins the line", body: "Your main supplier keeps ties; a challenger only wins by beating your preference band." },
            { step: "Reconcile", title: "Cart is checked, not trusted", body: "After assisted-fill, the cart is read back and diffed — green only when SKU, quantity and price all match." },
          ].map((s) => (
            <div key={s.step} className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-teal-600">{s.step}</p>
              <p className="mt-2 text-[15px] font-semibold text-ink">{s.title}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Suppliers */}
      <section id="suppliers" className="border-y border-line bg-surface py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[24px] font-semibold tracking-tight text-ink">Works across the wholesalers you already buy from</h2>
              <p className="mt-2 max-w-xl text-[14.5px] text-ink-soft">Add a supplier once — price files, catalogues, or a logged-in browser session all feed the same comparison.</p>
            </div>
            <SuppliersLink />
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {suppliers.map((s) => (
              <div key={s.id} className="flex flex-col items-center gap-2 rounded-lg border border-line px-4 py-5 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-semibold text-white" style={{ backgroundColor: s.color }}>
                  {s.short.slice(0, 2)}
                </span>
                <span className="text-[12.5px] font-medium text-ink">{s.short}</span>
                {s.isMain && <span className="text-[10.5px] font-medium text-teal-600">Main supplier</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-[24px] font-semibold tracking-tight text-ink">Never orders on a guess</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-ink">Confirmed matches only</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">Suggested matches from a new supplier catalogue sit in review until a person confirms them — never auto-allocated.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-ink">Outliers get flagged, not ordered</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">A price that's wildly off the cross-supplier median is more likely a parse error than a deal — it's excluded from routing and shown for review.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-6">
            <p className="text-[15px] font-semibold text-ink">Carts are verified after the fact</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">Every assisted-fill is read back and compared to intent. Anything off goes to a pick list — nothing is assumed placed.</p>
          </div>
        </div>
      </section>

      {/* CTA
          The same `border-y border-line bg-surface` every other banded section
          on this page uses (see the hero and the suppliers band). It was
          `bg-ink`, which is a fixed dark slab in light mode and a near-white
          one in dark — inverted against the theme in both directions and the
          only section here not following the page's own alternation of
          surface and canvas. Emphasis comes from the button, not from giving
          the band a colour of its own. */}
      <section className="border-y border-line bg-surface">
        <ClosingCta />
      </section>

      <MarketingFooter />
    </>
  );
}
