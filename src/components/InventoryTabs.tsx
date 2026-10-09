import { useSearchParams } from "react-router-dom";
import { Boxes, ArrowDownCircle, ArrowUpCircle, HeartPulse } from "lucide-react";

// laporan = Laporan Harian pasien, only on the Klinik pages.
export type InventoryTab = "stok" | "in" | "out" | "laporan";

const TABS: { key: InventoryTab; label: string; icon: typeof Boxes }[] = [
  { key: "stok", label: "Stok", icon: Boxes },
  { key: "in", label: "Stock In", icon: ArrowDownCircle },
  { key: "out", label: "Stock Out", icon: ArrowUpCircle },
  { key: "laporan", label: "Laporan Harian", icon: HeartPulse },
];

// The active tab lives in the URL (?tab=in / ?tab=out) so a tab can be linked and survives a reload.
export function useInventoryTab(): [InventoryTab, (t: InventoryTab) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: InventoryTab = raw === "in" || raw === "out" || raw === "laporan" ? raw : "stok";
  const setTab = (t: InventoryTab) =>
    setParams(
      (cur) => {
        const next = new URLSearchParams(cur);
        if (t === "stok") next.delete("tab");
        else next.set("tab", t);
        return next;
      },
      { replace: true }
    );
  return [tab, setTab];
}

// Stok · Stock In · Stock Out switcher shown under an inventory page's title.
export function InventoryTabs({ value, onChange, laporan = false }: { value: InventoryTab; onChange: (t: InventoryTab) => void; laporan?: boolean }) {
  return (
    <div className="flex gap-1 border-b border-[var(--border)]" role="tablist">
      {TABS.filter((t) => laporan || t.key !== "laporan").map(({ key, label, icon: Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm -mb-px border-b-2 ${
              active
                ? "border-[var(--accent-blue)] text-[var(--accent-blue)] font-medium"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        );
      })}
    </div>
  );
}
