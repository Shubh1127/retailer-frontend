import type { LineStatus, ReconcileStatus, Provenance } from "@/lib/mock-data";

export function LineStatusBadge({ status }: { status: LineStatus }) {
  const map: Record<LineStatus, { label: string; cls: string }> = {
    main: { label: "Main supplier", cls: "bg-canvas text-ink-soft border-line" },
    diverted: { label: "Best deal", cls: "bg-good-50 text-good-600 border-good-500/20" },
    flagged: { label: "Outlier flagged", cls: "bg-warn-50 text-warn-600 border-warn-500/20" },
    "needs-match": { label: "Needs match", cls: "bg-amber-50 text-amber-600 border-amber-500/20" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

export function ReconcileDot({ status }: { status: ReconcileStatus }) {
  const cls =
    status === "green" ? "bg-good-500" : status === "amber" ? "bg-amber-500" : "bg-warn-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

export function ReconcileBadge({ status }: { status: ReconcileStatus }) {
  const map: Record<ReconcileStatus, { label: string; cls: string }> = {
    green: { label: "Green · matched", cls: "bg-good-50 text-good-600 border-good-500/20" },
    amber: { label: "Amber · review", cls: "bg-amber-50 text-amber-600 border-amber-500/20" },
    red: { label: "Red · fix required", cls: "bg-warn-50 text-warn-600 border-warn-500/20" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${m.cls}`}>
      <ReconcileDot status={status} />
      {m.label}
    </span>
  );
}

export function ProvenanceBadge({ provenance, confidence }: { provenance: Provenance; confidence: number }) {
  const map: Record<Provenance, { label: string; cls: string }> = {
    invoice: { label: "Invoice-seeded", cls: "bg-teal-50 text-link border-teal-500/20" },
    ean_exact: { label: "EAN exact", cls: "bg-teal-50 text-link border-teal-500/20" },
    human_confirmed: { label: "Confirmed", cls: "bg-good-50 text-good-600 border-good-500/20" },
    llm_suggested: { label: `Suggested · ${Math.round(confidence * 100)}%`, cls: "bg-amber-50 text-amber-600 border-amber-500/20" },
  };
  const m = map[provenance];
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

export function SupplierChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[12.5px] font-medium text-ink">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}
