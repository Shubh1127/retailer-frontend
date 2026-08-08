import AppShell from "@/components/AppShell";
import { comparisonRows, baskets, supplierById, weeklyTotals, eur } from "@/lib/mock-data";

const channelCopy: Record<string, string> = {
  "Quick-order paste": "Paste a SKU + qty list straight into Musgrave's Quick Order box.",
  "Webview cart": "Assisted-fill opens a logged-in browser and adds each line to cart for you to confirm.",
  "Pick list only": "No automatable path here — a formatted pick list is generated for you to key in by hand.",
};

export default function BasketsPage() {
  return (
    // <AppShell active="Baskets">
    //   <div className="flex flex-wrap items-end justify-between gap-4">
    //     <div>
    //       <h1 className="text-[22px] font-semibold tracking-tight text-ink">Baskets</h1>
    //       <p className="mt-1 text-[13.5px] text-ink-soft">Allocation split across {baskets.length} suppliers for this week's list</p>
    //     </div>
    //     <button className="rounded-md bg-teal-500 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-600">
    //       Send all to checkout
    //     </button>
    //   </div>

    //   <div className="mt-6 grid gap-5 lg:grid-cols-3">
    //     {baskets.map((b) => {
    //       const s = supplierById(b.supplierId);
    //       const lines = comparisonRows.filter((r) => r.winnerId === b.supplierId);
    //       const total = b.goodsExVat + b.deliveryFee;
    //       return (
    //         <div key={b.supplierId} className="flex flex-col rounded-xl border border-line bg-surface shadow-card">
    //           <div className="flex items-center gap-3 border-b border-line p-4">
    //             <span className="flex h-9 w-9 items-center justify-center rounded-md text-[13px] font-semibold text-white" style={{ backgroundColor: s.color }}>
    //               {s.short.slice(0, 2)}
    //             </span>
    //             <div>
    //               <p className="text-[14px] font-semibold text-ink">{s.name}</p>
    //               <p className="text-[12px] text-ink-soft">{s.channel}</p>
    //             </div>
    //           </div>

    //           <div className="flex-1 divide-y divide-line px-4">
    //             {lines.length ? lines.map((l) => {
    //               const q = l.quotes[b.supplierId]!;
    //               return (
    //                 <div key={l.gtin} className="flex items-center justify-between gap-3 py-3">
    //                   <div>
    //                     <p className="text-[13px] text-ink">{l.name}</p>
    //                     <p className="text-[11.5px] text-ink-soft">{l.pack} · ×{l.cases} cases</p>
    //                   </div>
    //                   <p className="nums shrink-0 text-[13px] font-medium text-ink">{eur(q.exVatCase * l.cases)}</p>
    //                 </div>
    //               );
    //             }) : (
    //               <p className="py-6 text-center text-[12.5px] text-ink-faint">No lines allocated here this week.</p>
    //             )}
    //           </div>

    //           <div className="space-y-1.5 border-t border-line p-4 text-[12.5px]">
    //             <div className="flex justify-between text-ink-soft"><span>Goods, ex-VAT</span><span className="nums">{eur(b.goodsExVat)}</span></div>
    //             <div className="flex justify-between text-ink-soft"><span>Delivery</span><span className="nums">{b.deliveryFee ? eur(b.deliveryFee) : "Free"}</span></div>
    //             <div className="flex justify-between pt-1.5 text-[13.5px] font-semibold text-ink"><span>Total</span><span className="nums">{eur(total)}</span></div>
    //             <p className={`pt-1 text-[11.5px] ${b.meetsMinOrder ? "text-good-600" : "text-warn-600"}`}>
    //               {b.meetsMinOrder ? "Minimum order met" : "Below minimum order — add lines or roll into pick list"}
    //             </p>
    //           </div>

    //           <div className="border-t border-line bg-canvas/50 p-4">
    //             <p className="text-[11.5px] text-ink-soft">{channelCopy[s.channel]}</p>
    //             <button className="mt-3 w-full rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-white hover:bg-ink/90">
    //               {s.channel === "Pick list only" ? "Generate pick list" : "Start assisted-fill"}
    //             </button>
    //           </div>
    //         </div>
    //       );
    //     })}
    //   </div>

    //   <div className="mt-8 rounded-xl border border-line bg-surface p-5 shadow-card">
    //     <h2 className="text-[14.5px] font-semibold text-ink">Weekly total</h2>
    //     <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
    //       <div>
    //         <p className="text-[12px] text-ink-soft">Goods, ex-VAT</p>
    //         <p className="nums text-[17px] font-semibold text-ink">{eur(weeklyTotals.goodsExVat)}</p>
    //       </div>
    //       <div>
    //         <p className="text-[12px] text-ink-soft">Delivery, ex-VAT</p>
    //         <p className="nums text-[17px] font-semibold text-ink">{eur(weeklyTotals.deliveryExVat)}</p>
    //       </div>
    //       <div>
    //         <p className="text-[12px] text-ink-soft">Grand total</p>
    //         <p className="nums text-[17px] font-semibold text-ink">{eur(weeklyTotals.grandTotalExVat)}</p>
    //       </div>
    //       <div>
    //         <p className="text-[12px] text-ink-soft">Saving vs. all-from-main</p>
    //         <p className="nums text-[17px] font-semibold text-good-600">{eur(weeklyTotals.savingExVat)}</p>
    //       </div>
    //     </div>
    //   </div>
    // </AppShell>
    <AppShell active="Baskets">
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <span className="text-[12.5px] text-ink-faint text-center">Coming soon</span>
      </div>
    </AppShell>
  );
}
