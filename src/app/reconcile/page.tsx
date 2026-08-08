import AppShell from "@/components/AppShell";
import { ReconcileBadge } from "@/components/Badges";
import { reconcileRows, supplierById, eur } from "@/lib/mock-data";

export default function ReconcilePage() {
  const green = reconcileRows.filter((r) => r.status === "green").length;
  const amber = reconcileRows.filter((r) => r.status === "amber").length;
  const red = reconcileRows.filter((r) => r.status === "red").length;

  return (
    // <AppShell active="Reconcile">
    //   <div className="flex flex-wrap items-end justify-between gap-4">
    //     <div>
    //       <h1 className="text-[22px] font-semibold tracking-tight text-ink">Cart read-back</h1>
    //       <p className="mt-1 text-[13.5px] text-ink-soft">
    //         After assisted-fill, every cart is read back and diffed against intent — never trusted on presence alone.
    //       </p>
    //     </div>
    //   </div>

    //   <div className="mt-6 grid grid-cols-3 gap-4 sm:max-w-md">
    //     <div className="rounded-xl border border-line bg-surface p-4 text-center shadow-card">
    //       <p className="nums text-2xl font-semibold text-good-600">{green}</p>
    //       <p className="text-[12px] text-ink-soft">Green</p>
    //     </div>
    //     <div className="rounded-xl border border-line bg-surface p-4 text-center shadow-card">
    //       <p className="nums text-2xl font-semibold text-amber-600">{amber}</p>
    //       <p className="text-[12px] text-ink-soft">Amber</p>
    //     </div>
    //     <div className="rounded-xl border border-line bg-surface p-4 text-center shadow-card">
    //       <p className="nums text-2xl font-semibold text-warn-600">{red}</p>
    //       <p className="text-[12px] text-ink-soft">Red</p>
    //     </div>
    //   </div>

    //   <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
    //     <table className="w-full border-collapse text-left">
    //       <thead>
    //         <tr className="border-b border-line bg-canvas/60 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">
    //           <th className="px-4 py-3">Line</th>
    //           <th className="px-3 py-3">Supplier</th>
    //           <th className="px-3 py-3">Cases</th>
    //           <th className="px-3 py-3">Price</th>
    //           <th className="px-3 py-3">Status &amp; reason</th>
    //         </tr>
    //       </thead>
    //       <tbody>
    //         {reconcileRows.map((r) => {
    //           const s = supplierById(r.supplierId);
    //           return (
    //             <tr key={r.sku} className="border-b border-line last:border-0 align-top">
    //               <td className="px-4 py-3.5">
    //                 <p className="text-[13px] font-medium text-ink">{r.name}</p>
    //                 <p className="nums text-[11.5px] text-ink-soft">{r.sku}</p>
    //               </td>
    //               <td className="px-3 py-3.5">
    //                 <span className="inline-flex items-center gap-1.5 text-[13px] text-ink">
    //                   <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
    //                   {s.short}
    //                 </span>
    //               </td>
    //               <td className="px-3 py-3.5 nums text-[13px]">
    //                 <span className={r.cartCases !== r.intendedCases ? "font-semibold text-warn-600" : "text-ink"}>
    //                   {r.cartCases ?? "—"}
    //                 </span>
    //                 <span className="text-ink-faint"> / {r.intendedCases} intended</span>
    //               </td>
    //               <td className="px-3 py-3.5 nums text-[13px]">
    //                 {r.cartPrice ? (
    //                   <span className={r.driftPct ? "font-semibold text-amber-600" : "text-ink"}>{eur(r.cartPrice)}</span>
    //                 ) : (
    //                   <span className="text-ink-faint">—</span>
    //                 )}
    //                 <span className="text-ink-faint"> / {eur(r.intendedPrice)} won</span>
    //               </td>
    //               <td className="max-w-sm px-3 py-3.5">
    //                 <ReconcileBadge status={r.status} />
    //                 <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">{r.reason}</p>
    //               </td>
    //             </tr>
    //           );
    //         })}
    //       </tbody>
    //     </table>
    //   </div>

    //   <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
    //     <div>
    //       <p className="text-[13.5px] font-semibold text-ink">{red + amber} line{red + amber === 1 ? "" : "s"} need attention</p>
    //       <p className="text-[12.5px] text-ink-soft">Anything not green drops to the pick list below for manual handling.</p>
    //     </div>
    //     <button className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-white hover:bg-ink/90">
    //       Send to pick list
    //     </button>
    //   </div>
    // </AppShell>
     <AppShell active="Reconcile">
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <span className="text-[12.5px] text-ink-faint text-center">Coming soon</span>
          </div>
        </AppShell>
  );
}
