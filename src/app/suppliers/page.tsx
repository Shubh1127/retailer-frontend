import AppShell from "@/components/AppShell";
import { suppliers, eur } from "@/lib/mock-data";

export default function SuppliersPage() {
  return (
    // <AppShell active="Suppliers">
    //   <div className="flex flex-wrap items-end justify-between gap-4">
    //     <div>
    //       <h1 className="text-[22px] font-semibold tracking-tight text-ink">Suppliers</h1>
    //       <p className="mt-1 text-[13.5px] text-ink-soft">Your trade accounts, ordering channels and compare thresholds</p>
    //     </div>
    //     <button className="rounded-md bg-teal-500 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-600">
    //       Add supplier
    //     </button>
    //   </div>

    //   <div className="mt-6 grid gap-4 lg:grid-cols-2">
    //     {suppliers.map((s) => (
    //       <div key={s.id} className="rounded-xl border border-line bg-surface p-5 shadow-card">
    //         <div className="flex items-start justify-between gap-3">
    //           <div className="flex items-center gap-3">
    //             <span className="flex h-10 w-10 items-center justify-center rounded-lg text-[13.5px] font-semibold text-white" style={{ backgroundColor: s.color }}>
    //               {s.short.slice(0, 2)}
    //             </span>
    //             <div>
    //               <p className="text-[14.5px] font-semibold text-ink">{s.name}</p>
    //               <p className="text-[12px] text-ink-soft">{s.channel}</p>
    //             </div>
    //           </div>
    //           {s.isMain && (
    //             <span className="rounded-md border border-teal-500/20 bg-teal-50 px-2 py-0.5 text-[11.5px] font-medium text-link">
    //               Main supplier
    //             </span>
    //           )}
    //         </div>

    //         <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
    //           <div>
    //             <p className="nums text-[15px] font-semibold text-ink">{Math.round(s.thresholdPct * 100)}%</p>
    //             <p className="text-[11px] text-ink-soft">Compare threshold</p>
    //           </div>
    //           <div>
    //             <p className="nums text-[15px] font-semibold text-ink">{s.minOrderValue ? eur(s.minOrderValue) : "None"}</p>
    //             <p className="text-[11px] text-ink-soft">Min. order</p>
    //           </div>
    //           <div>
    //             <p className="nums text-[15px] font-semibold text-ink">{s.deliveryFee ? eur(s.deliveryFee) : "Free"}</p>
    //             <p className="text-[11px] text-ink-soft">Delivery fee</p>
    //           </div>
    //         </div>

    //         <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
    //           <p className="text-[12px] text-ink-soft">
    //             {s.isMain
    //               ? "Keeps every line unless another supplier beats it by more than its threshold."
    //               : `Only wins a line by beating the main supplier's price by more than ${Math.round(s.thresholdPct * 100)}%.`}
    //           </p>
    //           <button className="shrink-0 text-[12.5px] font-medium text-teal-600 hover:text-link">Edit</button>
    //         </div>
    //       </div>
    //     ))}
    //   </div>

    //   <div className="mt-8 rounded-xl border border-line bg-surface p-5 shadow-card">
    //     <h2 className="text-[14.5px] font-semibold text-ink">Global allocation rules</h2>
    //     <div className="mt-4 grid gap-4 sm:grid-cols-3">
    //       <RuleField label="Default preference band" value="5%" hint="Applies when a supplier has no threshold of its own" />
    //       <RuleField label="Outlier deviation tolerance" value="45%" hint="Flags a per-unit price this far from the median" />
    //       <RuleField label="Cart price tolerance" value="2%" hint="Drift beyond this turns a reconciled line amber" />
    //     </div>
    //   </div>
    // </AppShell>
     <AppShell active="suppliers">
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <span className="text-[12.5px] text-ink-faint text-center">Coming soon</span>
          </div>
        </AppShell>
  );
}

function RuleField({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-[12px] text-ink-soft">{label}</p>
      <p className="nums mt-1 text-[18px] font-semibold text-ink">{value}</p>
      <p className="mt-1 text-[11.5px] text-ink-faint">{hint}</p>
    </div>
  );
}
