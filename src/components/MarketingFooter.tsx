import Link from "next/link";

export default function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-500 text-[11px] font-bold text-white">R</span>
              <span className="text-[14px] font-semibold text-ink">RetailCompare</span>
            </div>
            <p className="mt-3 max-w-[26ch] text-[13px] leading-relaxed text-ink-soft">
              One order list in. Every supplier compared ex-VAT, per base unit. Best price out.
            </p>
          </div>
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Product</p>
            <ul className="mt-3 space-y-2 text-[13.5px] text-ink-soft">
              <li><Link href="/dashboard" className="hover:text-ink">Dashboard</Link></li>
              <li><Link href="/compare" className="hover:text-ink">Compare</Link></li>
              <li><Link href="/baskets" className="hover:text-ink">Baskets</Link></li>
              <li><Link href="/reconcile" className="hover:text-ink">Reconcile</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Network</p>
            <ul className="mt-3 space-y-2 text-[13.5px] text-ink-soft">
              <li><Link href="/suppliers" className="hover:text-ink">Suppliers</Link></li>
              <li><Link href="/mappings" className="hover:text-ink">Mappings cockpit</Link></li>
              <li><Link href="/orders" className="hover:text-ink">Order list import</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Company</p>
            <ul className="mt-3 space-y-2 text-[13.5px] text-ink-soft">
              <li className="hover:text-ink">About</li>
              <li className="hover:text-ink">Contact</li>
              <li className="hover:text-ink">Status</li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-[12px] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 RetailCompare. UI preview build — no live supplier data connected.</p>
          <p>Prices shown are illustrative, ex-VAT, in EUR.</p>
        </div>
      </div>
    </footer>
  );
}
