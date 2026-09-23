import { PackagePlus, Package, Boxes, AlertTriangle, XCircle, type LucideIcon } from "lucide-react";
import { StatCard } from "../components/StatCard";

export function InventoryGudangEmptyPage({
  gudang,
  titlePrefix = "Inventory Gudang",
  unitLabel = "item barang",
  icon: Icon = Package,
}: {
  gudang: string;
  titlePrefix?: string;
  unitLabel?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            {titlePrefix} - {gudang}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">0 {unitLabel}</p>
        </div>
        <button
          disabled
          className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed"
        >
          <PackagePlus size={16} /> Transaksi
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={`Total ${unitLabel}`} value={0} icon={Icon} tone="blue" />
        <StatCard label="Total Stock Tersedia" value={0} icon={Boxes} tone="green" />
        <StatCard label="Stock Menipis (Buffer)" value={0} icon={AlertTriangle} tone="amber" />
        <StatCard label="Stock Habis" value={0} icon={XCircle} tone="red" />
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="px-4 py-10 text-center text-[var(--text-muted)] text-sm">
          Data {titlePrefix.toLowerCase()} {gudang} belum tersedia.
        </div>
      </div>
    </div>
  );
}
