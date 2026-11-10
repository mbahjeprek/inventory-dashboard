import { useSearchParams } from "react-router-dom";
import { Boxes, ArrowDownCircle, ArrowUpCircle, ClipboardList, HeartPulse, PackageX } from "lucide-react";

// laporan = Laporan Harian pasien, rusak = obat expired / rusak / retur and permintaan = Permintaan Obat / Barang (non-obat),
// only on the Klinik pages.
export type InventoryTab = "stok" | "in" | "out" | "rusak" | "laporan" | "permintaan";

// warna: the icon's colour while the tab isn't open (white on blue when it is), so each tab is easy to spot.
const TABS: { key: InventoryTab; label: string; icon: typeof Boxes; warna: string }[] = [
  { key: "stok", label: "Stok", icon: Boxes, warna: "var(--accent-blue)" },
  { key: "in", label: "Stock In", icon: ArrowDownCircle, warna: "var(--accent-green)" },
  { key: "out", label: "Stock Out", icon: ArrowUpCircle, warna: "var(--accent-red)" },
  { key: "rusak", label: "Expired & Rusak", icon: PackageX, warna: "var(--accent-amber)" },
  { key: "laporan", label: "Laporan Harian", icon: HeartPulse, warna: "#db2777" },
  { key: "permintaan", label: "Permintaan Obat/Barang", icon: ClipboardList, warna: "#7c3aed" },
];

// The look of a page's main tabs (here and Koperasi): a bar of pills, the open one solid blue.
export const TAB_BAR = "flex flex-wrap gap-1 p-1 rounded-lg border border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] shadow-sm";
export const tabCls = (active: boolean) =>
  `inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md transition ${
    active ? "bg-[var(--accent-blue)] text-white shadow" : "bg-[var(--bg-card)] text-[var(--text-primary)] hover:ring-1 hover:ring-[var(--accent-blue)]"
  }`;

// The active tab lives in the URL (?tab=in / ?tab=out) so a tab can be linked and survives a reload.
export function useInventoryTab(): [InventoryTab, (t: InventoryTab) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: InventoryTab = raw === "in" || raw === "out" || raw === "laporan" || raw === "rusak" || raw === "permintaan" ? raw : "stok";
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
    <div className={TAB_BAR} role="tablist">
      {TABS.filter((t) => laporan || (t.key !== "laporan" && t.key !== "rusak" && t.key !== "permintaan")).map(({ key, label, icon: Icon, warna }) => {
        const active = value === key;
        return (
          <button key={key} role="tab" aria-selected={active} onClick={() => onChange(key)} className={tabCls(active)}>
            <Icon size={16} style={active ? undefined : { color: warna }} /> {label}
          </button>
        );
      })}
    </div>
  );
}
