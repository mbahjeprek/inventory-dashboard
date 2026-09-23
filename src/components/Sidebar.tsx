import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Package,
  ArrowLeftRight,
  FileDown,
  ArrowDownCircle,
  ArrowUpCircle,
  Users,
  Fuel,
  Truck,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  X,
  KeyRound,
  History,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

type NavItem = { to: string; label: string; icon: typeof Package };
type NavSection = { title?: string; collapsible?: boolean; items: NavItem[] };

type DropdownOption = { to: string; label: string };
type DropdownGroup = { key: string; icon: typeof Package; title: string; options: DropdownOption[] };

const GUDANG_GROUP: DropdownGroup = {
  key: "gudang",
  icon: Package,
  title: "Gudang",
  options: [
    { to: "/inventory", label: "Nilam" },
    { to: "/inventory-kns", label: "KNS" },
    { to: "/inventory-wja", label: "WJA" },
    { to: "/inventory-zamrud", label: "Zamrud" },
    { to: "/inventory-firus", label: "Firus" },
  ],
};

const BBM_GROUP: DropdownGroup = {
  key: "bbm",
  icon: Fuel,
  title: "BBM",
  options: [
    { to: "/inventory-bbm", label: "Nilam" },
    { to: "/inventory-bbm-kns", label: "KNS" },
    { to: "/inventory-bbm-wja", label: "WJA" },
    { to: "/inventory-bbm-zamrud", label: "Zamrud" },
    { to: "/inventory-bbm-firus", label: "Firus" },
  ],
};

const DROPDOWN_GROUPS: DropdownGroup[] = [GUDANG_GROUP, BBM_GROUP];

const navSections: NavSection[] = [
  {
    title: "Inventory",
    collapsible: true,
    items: [
      { to: "/log-barang", label: "Log Barang", icon: History },
      { to: "/log-bbm", label: "Log BBM", icon: History },
    ],
  },
  {
    title: "Transaksi",
    collapsible: true,
    items: [
      { to: "/stock-in", label: "Stock In", icon: ArrowDownCircle },
      { to: "/stock-out", label: "Stock Out", icon: ArrowUpCircle },
      { to: "/transactions", label: "Riwayat Transaksi", icon: ArrowLeftRight },
      { to: "/reports", label: "Laporan", icon: FileDown },
    ],
  },
  {
    title: "Master Data",
    collapsible: true,
    items: [
      { to: "/master-barang", label: "Barang", icon: Package },
      { to: "/karyawan", label: "Karyawan", icon: Users },
      { to: "/alat-berat", label: "Alat Berat", icon: Truck },
      { to: "/users", label: "Pengguna", icon: KeyRound },
    ],
  },
];

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

const DESKTOP_QUERY = "(min-width: 768px)";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const isDesktop = useIsDesktop();
  const [minimizedPref, setMinimized] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, minimizedPref ? "1" : "0");
    } catch {
      // ignore
    }
  }, [minimizedPref]);

  // The phone drawer always shows full labels; the icon-only mode is a desktop preference.
  const minimized = minimizedPref && isDesktop;

  const isSuperuser = user?.role === "superuser";

  // An estate account only ever sees its own Gudang/BBM option and none of the cross-estate
  // admin sections - Transaksi and Master Data are Nilam/superuser-only, see server-side
  // requireEstate("NILAM") / requireSuperuser in app.ts for the matching enforcement.
  const dropdownGroups: DropdownGroup[] = isSuperuser
    ? DROPDOWN_GROUPS
    : DROPDOWN_GROUPS.map((g) => ({ ...g, options: g.options.filter((o) => o.label.toUpperCase() === user?.estate) }));

  const visibleSections = navSections.filter((s) => {
    if (s.title === "Transaksi") return isSuperuser || user?.estate === "NILAM";
    if (s.title === "Master Data") return isSuperuser;
    return true;
  });

  const normalizedPathname = location.pathname === "/" ? "/inventory" : location.pathname;
  const activeByGroup: Record<string, string | undefined> = {};
  for (const group of dropdownGroups) {
    activeByGroup[group.key] = group.options.find((o) => o.to === normalizedPathname)?.to;
  }

  useEffect(() => {
    for (const group of dropdownGroups) {
      const active = activeByGroup[group.key];
      if (!active) continue;
      try {
        localStorage.setItem(`last-${group.key}`, active);
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const selectedFor = (group: DropdownGroup) =>
    activeByGroup[group.key] ??
    (() => {
      try {
        return localStorage.getItem(`last-${group.key}`) ?? group.options[0].to;
      } catch {
        return group.options[0].to;
      }
    })();

  return (
    <>
    {mobileOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={onMobileClose} />}
    <aside
      className={`${
        minimized ? "w-[68px]" : "w-[260px] md:w-[220px]"
      } shrink-0 bg-[var(--bg-sidebar)] text-white flex flex-col h-screen top-0 z-50 fixed left-0 md:sticky transition-[width,transform] duration-200 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      } md:translate-x-0`}
    >
      <div
        className={`flex items-center py-6 ${
          minimized ? "flex-col gap-3 justify-center px-0" : "justify-between px-5 gap-2"
        }`}
      >
        <div className={`flex items-center gap-2 ${minimized ? "flex-col" : ""}`}>
          <img src="/logo-agro.png" alt="Agro" className="w-6 h-6 shrink-0 object-contain" />
          {!minimized && <div className="font-semibold text-sm leading-tight">Management Inventory Agro</div>}
        </div>
        <button onClick={onMobileClose} title="Tutup menu" className="md:hidden p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 shrink-0">
          <X size={18} />
        </button>
        <button
          onClick={() => setMinimized((m) => !m)}
          title={minimized ? "Perbesar sidebar" : "Perkecil sidebar"}
          className="hidden md:block p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/10 shrink-0"
        >
          {minimized ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-4 overflow-y-auto overflow-x-hidden">
        {visibleSections.map((section, i) => {
          const isOpen = minimized || !section.collapsible ? true : !(groupCollapsed[section.title!] ?? false);

          return (
            <div key={section.title ?? i} className="space-y-1">
              {section.title && !minimized && !section.collapsible && (
                <div className="px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider text-white/55 uppercase">
                  {section.title}
                </div>
              )}

              {section.title && !minimized && section.collapsible && (
                <button
                  onClick={() =>
                    setGroupCollapsed((c) => ({ ...c, [section.title!]: !(c[section.title!] ?? false) }))
                  }
                  className="w-full flex items-center justify-between px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider text-white/55 uppercase hover:text-white/60"
                >
                  {section.title}
                  <ChevronDown size={12} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                </button>
              )}

              {isOpen &&
                section.title === "Inventory" &&
                dropdownGroups.map((group) => {
                  const selected = selectedFor(group);
                  const active = !!activeByGroup[group.key];
                  const GroupIcon = group.icon;

                  if (minimized) {
                    return (
                      <NavLink
                        key={group.key}
                        to={selected}
                        title={group.title}
                        className={`flex items-center justify-center py-2.5 rounded-md text-sm font-semibold transition-colors ${
                          active
                            ? "bg-white/15 text-white"
                            : "text-white/70 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <GroupIcon size={17} className="shrink-0 text-[#b9f0c9]" />
                      </NavLink>
                    );
                  }

                  const expanded = expandedGroups[group.key] ?? active;

                  return (
                    <div key={group.key}>
                      <button
                        onClick={() => setExpandedGroups((e) => ({ ...e, [group.key]: !expanded }))}
                        className={`w-full flex items-center gap-3 py-2.5 px-3 rounded-md text-sm font-semibold transition-colors ${
                          active
                            ? "bg-white/15 text-white"
                            : "text-white/70 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <GroupIcon size={17} className="shrink-0 text-[#b9f0c9]" />
                        <span className="flex-1 text-left">{group.title}</span>
                        <ChevronDown size={14} className={`transition-transform ${expanded ? "" : "-rotate-90"}`} />
                      </button>

                      {expanded && (
                        <div className="mt-1 space-y-1">
                          {group.options.map((o) => (
                            <NavLink
                              key={o.to}
                              to={o.to}
                              className={({ isActive }) =>
                                `flex items-center py-2 pl-11 pr-3 rounded-md text-sm font-semibold transition-colors ${
                                  isActive
                                    ? "bg-white/15 text-white border-l-[3px] border-[#b9f0c9] pl-[41px]"
                                    : "text-white/60 hover:bg-white/10 hover:text-white"
                                }`
                              }
                            >
                              {o.label}
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

              {isOpen &&
                section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    title={minimized ? label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                        minimized ? "justify-center px-0" : "px-3"
                      } ${
                        isActive
                          ? `bg-white/15 text-white ${minimized ? "" : "border-l-[3px] border-[#b9f0c9] pl-[9px]"}`
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`
                    }
                  >
                    <Icon size={17} className="shrink-0 text-[#b9f0c9]" />
                    {!minimized && label}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </nav>

      <div className={`px-3 py-3 border-t border-white/10 ${minimized ? "flex justify-center" : ""}`}>
        {!minimized && (
          <div className="px-2 pb-2 text-xs text-white truncate" title={user?.nama}>
            {user?.nama}
          </div>
        )}
        <button
          onClick={async () => {
            await logout();
            navigate("/login", { replace: true });
          }}
          title="Keluar"
          className={`flex items-center gap-2 py-2 rounded-md text-sm text-white/60 hover:bg-white/10 hover:text-white ${
            minimized ? "justify-center px-0 w-full" : "px-2 w-full"
          }`}
        >
          <LogOut size={16} className="shrink-0" />
          {!minimized && "Keluar"}
        </button>
      </div>
    </aside>
    </>
  );
}
