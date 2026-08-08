import AppShell from "@/components/AppShell";
import ProductGlyph from "@/components/ProductGlyph";
import PreferenceBand from "@/components/PreferenceBand";
import { LineStatusBadge } from "@/components/Badges";
import { comparisonRows, suppliers, supplierById, eur } from "@/lib/mock-data";

const departments = ["Soft Drinks", "Ambient Grocery", "Chilled", "Confectionery", "Bakery"];

export default function ComparePage() {
  return (
    // <AppShell active="Compare">
    //   <div className="flex flex-wrap items-end justify-between gap-4">
    //     <div>
    //       <h1 className="text-[22px] font-semibold tracking-tight text-ink">Compare this week's list</h1>
    //       <p className="mt-1 text-[13.5px] text-ink-soft">6 lines · prices normalised ex-VAT, per base unit</p>
    //     </div>
    //     <div className="flex items-center gap-2">
    //       <div className="hidden items-center rounded-md border border-line bg-surface p-0.5 text-[12.5px] sm:flex">
    //         <span className="rounded px-2.5 py-1 font-medium text-ink bg-canvas">Table</span>
    //         <span className="rounded px-2.5 py-1 text-ink-soft">Cards</span>
    //       </div>
    //       <button className="rounded-md bg-teal-500 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-600">
    //         Refresh prices
    //       </button>
    //     </div>
    //   </div>

    //   <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
    //     {/* Filters — sidebar on desktop */}
    //     <aside className="hidden lg:block">
    //       <div className="sticky top-20 rounded-xl border border-line bg-surface p-4">
    //         <FilterGroup title="Department">
    //           {departments.map((d, i) => (
    //             <FilterCheck key={d} label={d} defaultChecked={i < 3} />
    //           ))}
    //         </FilterGroup>
    //         <FilterGroup title="Supplier">
    //           {suppliers.map((s, i) => (
    //             <FilterCheck key={s.id} label={s.short} defaultChecked={i < 4} swatch={s.color} />
    //           ))}
    //         </FilterGroup>
    //         <FilterGroup title="Status">
    //           <FilterCheck label="Best deal" defaultChecked />
    //           <FilterCheck label="Main supplier" defaultChecked />
    //           <FilterCheck label="Outlier flagged" defaultChecked />
    //           <FilterCheck label="Needs match" defaultChecked />
    //         </FilterGroup>
    //         <div className="mt-5 border-t border-line pt-4">
    //           <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">In stock only</p>
    //           <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
    //             <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-teal-500">
    //               <span className="ml-4 h-4 w-4 rounded-full bg-surface shadow" />
    //             </span>
    //             Hide unavailable lines
    //           </label>
    //         </div>
    //       </div>
    //     </aside>

    //     {/* Filter chips — mobile */}
    //     <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin lg:hidden">
    //       {["All departments", "All suppliers", "In stock only", "Free delivery"].map((c) => (
    //         <span key={c} className="whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft">
    //           {c}
    //         </span>
    //       ))}
    //     </div>

    //     {/* Results */}
    //     <div>
    //       {/* Mobile / default card view */}
    //       <div className="grid gap-3 lg:hidden">
    //         {comparisonRows.map((row) => {
    //           const winner = row.quotes[row.winnerId]!;
    //           const stores = Object.keys(row.quotes).length;
    //           return (
    //             <div key={row.gtin} className="rounded-xl border border-line bg-surface p-4 shadow-card">
    //               <div className="flex gap-3">
    //                 <ProductGlyph department={row.department} />
    //                 <div className="min-w-0 flex-1">
    //                   <div className="flex items-start justify-between gap-2">
    //                     <p className="truncate text-[13.5px] font-medium text-ink">{row.name}</p>
    //                     <LineStatusBadge status={row.status} />
    //                   </div>
    //                   <p className="text-[12px] text-ink-soft">{row.pack} · {row.cases} cases</p>
    //                   <div className="mt-2 flex items-end justify-between">
    //                     <div>
    //                       <p className="nums text-[18px] font-semibold text-ink">{eur(winner.exVatCase)}<span className="text-[12px] font-normal text-ink-soft"> /case</span></p>
    //                       <p className="text-[11.5px] text-ink-soft">from {stores} supplier{stores === 1 ? "" : "s"} · best: {supplierById(row.winnerId).short}</p>
    //                     </div>
    //                     <button className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas">Compare</button>
    //                   </div>
    //                 </div>
    //               </div>
    //             </div>
    //           );
    //         })}
    //       </div>

    //       {/* Desktop table view */}
    //       <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface scrollbar-thin lg:block">
    //         <table className="w-full min-w-[880px] border-collapse text-left">
    //           <thead>
    //             <tr className="border-b border-line bg-canvas/60">
    //               <th className="sticky left-0 z-10 bg-canvas/60 px-4 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">Product</th>
    //               {suppliers.map((s) => (
    //                 <th key={s.id} className="min-w-[130px] px-3 py-3 text-[11.5px] font-semibold text-ink-soft">
    //                   <div className="flex items-center gap-1.5">
    //                     <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
    //                     {s.short}
    //                   </div>
    //                 </th>
    //               ))}
    //               <th className="px-3 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">Status</th>
    //             </tr>
    //           </thead>
    //           <tbody>
    //             {comparisonRows.map((row) => (
    //               <tr key={row.gtin} className="border-b border-line last:border-0 hover:bg-canvas/40">
    //                 <td className="sticky left-0 z-10 bg-surface px-4 py-3.5">
    //                   <div className="flex items-center gap-3">
    //                     <ProductGlyph department={row.department} size={36} />
    //                     <div>
    //                       <p className="text-[13px] font-medium text-ink">{row.name}</p>
    //                       <p className="text-[11.5px] text-ink-soft">{row.pack} · {row.cases} cases</p>
    //                     </div>
    //                   </div>
    //                 </td>
    //                 {suppliers.map((s) => {
    //                   const q = row.quotes[s.id];
    //                   const isWinner = row.winnerId === s.id;
    //                   if (!q) {
    //                     return (
    //                       <td key={s.id} className="px-3 py-3.5 text-[12.5px] text-ink-faint">—</td>
    //                     );
    //                   }
    //                   return (
    //                     <td key={s.id} className={`px-3 py-3.5 ${isWinner ? "bg-good-50/60" : ""}`}>
    //                       <p className={`nums text-[13.5px] font-medium ${isWinner ? "text-good-600" : "text-ink"}`}>
    //                         {eur(q.exVatCase)}
    //                       </p>
    //                       <p className="nums text-[11px] text-ink-faint">€{q.perUnit.toFixed(4)}/unit</p>
    //                       {!q.inStock && <p className="text-[10.5px] font-medium text-warn-600">Out of stock</p>}
    //                       {q.promo && <p className="text-[10.5px] font-medium text-teal-600">Promo</p>}
    //                       {isWinner && <p className="text-[10.5px] font-semibold text-good-600">Best deal</p>}
    //                     </td>
    //                   );
    //                 })}
    //                 <td className="px-3 py-3.5">
    //                   <LineStatusBadge status={row.status} />
    //                   {row.savingVsMain > 0 && (
    //                     <p className="nums mt-1 text-[11.5px] font-medium text-good-600">save {eur(row.savingVsMain)}/wk</p>
    //                   )}
    //                 </td>
    //               </tr>
    //             ))}
    //           </tbody>
    //         </table>
    //       </div>

    //       {/* Product detail drawer — static example for the top line */}
    //       <div className="mt-8 rounded-xl border border-line bg-surface p-5 shadow-card">
    //         <div className="flex flex-wrap items-start justify-between gap-4">
    //           <div className="flex items-center gap-3">
    //             <ProductGlyph department="Soft Drinks" size={52} />
    //             <div>
    //               <p className="text-[15px] font-semibold text-ink">Cola 24×330ml Cans</p>
    //               <p className="text-[12.5px] text-ink-soft">GTIN 05000000000018 · 24 × 330ml · Soft Drinks</p>
    //             </div>
    //           </div>
    //           <LineStatusBadge status="diverted" />
    //         </div>

    //         <div className="mt-6 grid gap-8 lg:grid-cols-2">
    //           <div>
    //             <p className="text-[12.5px] font-semibold text-ink-soft">Why this line diverted</p>
    //             <div className="mt-3">
    //               <PreferenceBand
    //                 mainPrice={12.0}
    //                 thresholdPct={0.1}
    //                 offers={[
    //                   { label: "Musgrave", price: 12.0, color: "#0F766E", isMain: true },
    //                   { label: "Value Centre", price: 10.0, color: "#BE123C" },
    //                   { label: "Barry Group", price: 12.4, color: "#4F46E5" },
    //                   { label: "O'Reillys", price: 11.9, color: "#0891B2" },
    //                 ]}
    //               />
    //             </div>
    //           </div>
    //           <div>
    //             <p className="text-[12.5px] font-semibold text-ink-soft">Store-by-store breakdown</p>
    //             <div className="mt-3 divide-y divide-line rounded-lg border border-line">
    //               {suppliers.slice(0, 4).map((s) => {
    //                 const q = comparisonRows[0].quotes[s.id];
    //                 if (!q) return null;
    //                 const isWinner = comparisonRows[0].winnerId === s.id;
    //                 return (
    //                   <div key={s.id} className="flex items-center justify-between px-3.5 py-2.5">
    //                     <div className="flex items-center gap-2">
    //                       <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
    //                       <span className="text-[13px] text-ink">{s.short}</span>
    //                     </div>
    //                     <div className="flex items-center gap-3">
    //                       <span className={`nums text-[13px] font-medium ${isWinner ? "text-good-600" : "text-ink"}`}>{eur(q.exVatCase)}</span>
    //                       <button
    //                         disabled={!isWinner}
    //                         className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${
    //                           isWinner ? "bg-teal-500 text-white hover:bg-teal-600" : "border border-line text-ink-faint"
    //                         }`}
    //                       >
    //                         Go to store
    //                       </button>
    //                     </div>
    //                   </div>
    //                 );
    //               })}
    //             </div>
    //           </div>
    //         </div>
    //       </div>
    //     </div>
    //   </div>
    // </AppShell>
     <AppShell active="Compare">
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <span className="text-[12.5px] text-ink-faint text-center">Coming soon</span>
          </div>
        </AppShell>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line pb-4 pt-4 first:pt-0">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      <div className="mt-2.5 space-y-2">{children}</div>
    </div>
  );
}

function FilterCheck({ label, defaultChecked, swatch }: { label: string; defaultChecked?: boolean; swatch?: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink">
      <input type="checkbox" readOnly checked={defaultChecked} className="h-3.5 w-3.5 rounded border-line text-teal-500 focus:ring-teal-500" />
      {swatch && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: swatch }} />}
      {label}
    </label>
  );
}
