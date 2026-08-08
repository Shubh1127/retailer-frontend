import AppShell from "@/components/AppShell";
import ProductGlyph from "@/components/ProductGlyph";
import { comparisonRows } from "@/lib/mock-data";

export default function OrdersPage() {
  return (
    // <AppShell active="Order list">
    //   <div className="flex flex-wrap items-end justify-between gap-4">
    //     <div>
    //       <h1 className="text-[22px] font-semibold tracking-tight text-ink">Order list</h1>
    //       <p className="mt-1 text-[13.5px] text-ink-soft">What you're buying this week — scan, import, or type it in</p>
    //     </div>
    //     <button className="rounded-md bg-teal-500 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-600">
    //       Send to comparison
    //     </button>
    //   </div>

    //   <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
    //     <div className="rounded-xl border border-line bg-surface shadow-card">
    //       <div className="flex items-center justify-between border-b border-line p-4">
    //         <p className="text-[13.5px] font-medium text-ink">6 lines</p>
    //         <div className="flex items-center gap-2">
    //           <button className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas">+ Add line</button>
    //           <button className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-canvas">Clear list</button>
    //         </div>
    //       </div>
    //       <div className="divide-y divide-line">
    //         {comparisonRows.map((r) => (
    //           <div key={r.gtin} className="flex items-center gap-3 p-4">
    //             <ProductGlyph department={r.department} size={38} />
    //             <div className="min-w-0 flex-1">
    //               <p className="truncate text-[13.5px] font-medium text-ink">{r.name}</p>
    //               <p className="nums text-[11.5px] text-ink-soft">{r.gtin} · {r.pack}</p>
    //             </div>
    //             <div className="flex items-center gap-1">
    //               <button className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-soft hover:bg-canvas">−</button>
    //               <input
    //                 readOnly
    //                 value={r.cases}
    //                 className="nums h-7 w-12 rounded-md border border-line text-center text-[13px] text-ink"
    //               />
    //               <button className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-soft hover:bg-canvas">+</button>
    //               <span className="ml-1 text-[12px] text-ink-soft">cases</span>
    //             </div>
    //           </div>
    //         ))}
    //       </div>
    //     </div>

    //     <div className="space-y-5">
    //       <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
    //         <h2 className="text-[13.5px] font-semibold text-ink">Scan barcodes</h2>
    //         <p className="mt-1 text-[12px] text-ink-soft">Use the app scanner to add lines by EAN/UPC as you walk the shop floor.</p>
    //         <button className="mt-3 w-full rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-white hover:bg-ink/90">
    //           Open scanner
    //         </button>
    //       </div>
    //       <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
    //         <h2 className="text-[13.5px] font-semibold text-ink">Import from EPOS</h2>
    //         <p className="mt-1 text-[12px] text-ink-soft">Upload this week's Article Order Listing export — quantities and costs come in automatically.</p>
    //         <div className="mt-3 rounded-lg border-2 border-dashed border-line p-6 text-center">
    //           <p className="text-[12.5px] font-medium text-ink">Drop .xls file here</p>
    //           <p className="mt-0.5 text-[11px] text-ink-faint">or click to browse</p>
    //         </div>
    //       </div>
    //       <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
    //         <h2 className="text-[13.5px] font-semibold text-ink">Import a CSV</h2>
    //         <p className="mt-1 text-[12px] text-ink-soft">Barcode + quantity columns — duplicate barcodes merge automatically.</p>
    //         <button className="mt-3 w-full rounded-md border border-line px-3 py-2 text-[13px] font-medium text-ink hover:bg-canvas">
    //           Choose file
    //         </button>
    //       </div>
    //     </div>
    //   </div>
    // </AppShell>
     <AppShell active="order list">
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <span className="text-[12.5px] text-ink-faint text-center">Coming soon</span>
          </div>
        </AppShell>
  );
}
