import AppShell from "@/components/AppShell";
import { ProvenanceBadge } from "@/components/Badges";
import { mappingRows, supplierById } from "@/lib/mock-data";

export default function MappingsPage() {
  const pending = mappingRows.filter((m) => !m.confirmed);

  return (
    // <AppShell active="Mappings">
    //   <div className="flex flex-wrap items-end justify-between gap-4">
    //     <div>
    //       <h1 className="text-[22px] font-semibold tracking-tight text-ink">Mappings cockpit</h1>
    //       <p className="mt-1 text-[13.5px] text-ink-soft">
    //         Every link from a product to a supplier SKU, with how it was found. Only confirmed rows can win a line.
    //       </p>
    //     </div>
    //     <span className="rounded-full bg-amber-50 px-3 py-1 text-[12.5px] font-medium text-amber-600">
    //       {pending.length} awaiting confirmation
    //     </span>
    //   </div>

    //   <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
    //     <table className="w-full border-collapse text-left">
    //       <thead>
    //         <tr className="border-b border-line bg-canvas/60 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">
    //           <th className="px-4 py-3">Product</th>
    //           <th className="px-3 py-3">Supplier</th>
    //           <th className="px-3 py-3">Supplier SKU</th>
    //           <th className="px-3 py-3">Provenance</th>
    //           <th className="px-3 py-3 text-right">Action</th>
    //         </tr>
    //       </thead>
    //       <tbody>
    //         {mappingRows.map((m) => {
    //           const s = supplierById(m.supplierId);
    //           return (
    //             <tr key={m.id} className="border-b border-line last:border-0">
    //               <td className="px-4 py-3.5">
    //                 <p className="text-[13px] font-medium text-ink">{m.name}</p>
    //                 <p className="text-[11.5px] text-ink-soft">{m.pack}</p>
    //               </td>
    //               <td className="px-3 py-3.5">
    //                 <span className="inline-flex items-center gap-1.5 text-[13px] text-ink">
    //                   <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
    //                   {s.short}
    //                 </span>
    //               </td>
    //               <td className="nums px-3 py-3.5 text-[12.5px] text-ink-soft">{m.supplierSku}</td>
    //               <td className="px-3 py-3.5">
    //                 <ProvenanceBadge provenance={m.provenance} confidence={m.confidence} />
    //               </td>
    //               <td className="px-3 py-3.5 text-right">
    //                 {m.confirmed ? (
    //                   <span className="text-[12.5px] text-ink-faint">Confirmed</span>
    //                 ) : (
    //                   <div className="flex justify-end gap-2">
    //                     <button className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-canvas">
    //                       Reject
    //                     </button>
    //                     <button className="rounded-md bg-teal-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-teal-600">
    //                       Confirm
    //                     </button>
    //                   </div>
    //                 )}
    //               </td>
    //             </tr>
    //           );
    //         })}
    //       </tbody>
    //     </table>
    //   </div>

    //   <div className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-card">
    //     <h2 className="text-[14.5px] font-semibold text-ink">Add a supplier catalogue</h2>
    //     <p className="mt-1 text-[12.5px] text-ink-soft">
    //       Paste a name / size / SKU / EAN table (markdown or CSV) to seed confirmed matches directly — no searching needed.
    //     </p>
    //     <div className="mt-4 rounded-lg border-2 border-dashed border-line p-8 text-center">
    //       <p className="text-[13px] font-medium text-ink">Drop a catalogue file, or click to browse</p>
    //       <p className="mt-1 text-[12px] text-ink-faint">.csv or .md · matched rows appear above for review</p>
    //     </div>
    //   </div>
    // </AppShell>
     <AppShell active="Mappings">
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <span className="text-[12.5px] text-ink-faint text-center">Coming soon</span>
          </div>
        </AppShell>
  );
}
