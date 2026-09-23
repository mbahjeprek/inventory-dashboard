import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Package,
  ArrowLeftRight,
  FileDown,
  Boxes,
  ArrowDownCircle,
  ArrowUpCircle,
  Users,
  Fuel,
  Truck,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

type NavItem = { to: string; label: string; icon: typeof Package };
type NavSection = { title?: string; collapsible?: boolean; items: NavItem[] };

const navSections: NavSection[] = [
  {
    title: "Inventory",
    collapsible: true,
    items: [
      { to: "/inventory", label: "Inventory Gudang", icon: Package },
      { to: "/inventory-bbm", label: "Inventory BBM", icon: Fuel },
    ],
  },
  {
    title: "Transaksi",
    collapsible: true,
    items: [
      { to: "/stock-in", label: "Stock In", icon: ArrowDownCircle },
      { to: "/stock-out", label: "Stock Out", icon: ArrowUpCircle },
      { to: "/transactions", label: "Log Activity", icon: ArrowLeftRight },
      { to: "/reports", label: "Laporan", icon: FileDown },
    ],
  },
  {
    title: "Master Data",
    items: [
      { to: "/karyawan", label: "Karyawan", icon: Users },
      { to: "/alat-berat", label: "Alat Berat", icon: Truck },
    ],
  },
];

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

export function Sidebar() {
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, minimized ? "1" : "0");
    } catch {
      // ignore
    }
  }, [minimized]);

  return (
    <aside
      className={`${
        minimized ? "w-[68px]" : "w-[220px]"
      } shrink-0 bg-[var(--bg-sidebar)] text-white flex flex-col h-screen sticky top-0 transition-[width] duration-200`}
    >
      <div className={`flex items-center gap-2 px-5 py-6 ${minimized ? "justify-center px-0" : ""}`}>
        <Boxes size={24} className="text-[#7fb2f0] shrink-0" />
        {!minimized && (
          <div>
            <div className="font-semibold text-sm leading-tight">Inventory</div>
            <div className="text-[11px] text-white/50 leading-tight">Monitoring Gudang</div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-4 overflow-y-auto overflow-x-hidden">
        {navSections.map((section, i) => {
          const isOpen = minimized || !section.collapsible ? true : !(groupCollapsed[section.title!] ?? false);

          return (
            <div key={section.title ?? i} className="space-y-1">
              {section.title && !minimized && !section.collapsible && (
                <div className="px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider text-white/35 uppercase">
                  {section.title}
                </div>
              )}

              {section.title && !minimized && section.collapsible && (
                <button
                  onClick={() =>
                    setGroupCollapsed((c) => ({ ...c, [section.title!]: !(c[section.title!] ?? false) }))
                  }
                  className="w-full flex items-center justify-between px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider text-white/35 uppercase hover:text-white/60"
                >
                  {section.title}
                  <ChevronDown size={12} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                </button>
              )}

              {isOpen &&
                section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    title={minimized ? label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 py-2.5 rounded-md text-sm transition-colors ${
                        minimized ? "justify-center px-0" : "px-3"
                      } ${
                        isActive
                          ? `bg-[#1e5bb5]/25 text-[#a9cdf5] ${minimized ? "" : "border-l-[3px] border-[#1e5bb5] pl-[9px]"}`
                          : "text-white/70 hover:bg-white/5 hover:text-white"
                      }`
                    }
                  >
                    <Icon size={17} className="shrink-0" />
                    {!minimized && label}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </nav>

      <button
        onClick={() => setMinimized((m) => !m)}
        title={minimized ? "Perbesar sidebar" : "Perkecil sidebar"}
        className={`flex items-center gap-2 px-5 py-3 text-white/50 hover:text-white hover:bg-white/5 border-t border-white/10 ${
          minimized ? "justify-center px-0" : ""
        }`}
      >
        {minimized ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        {!minimized && <span className="text-xs">Perkecil menu</span>}
      </button>

      {!minimized && (
        <div className="px-5 py-4 text-[11px] text-white/40 border-t border-white/10">
          Gudang utama: Nilam
          <br />
          Tujuan: Nilam · Zamrud · Firus
        </div>
      )}
    </aside>
  );
}
