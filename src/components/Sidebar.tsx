import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Package,
  Users,
  Fuel,
  Truck,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  X,
  KeyRound,
  LayoutDashboard,
  Sprout,
  Pill,
  Stethoscope,
  Activity,
  ClipboardCheck,
  Droplet,
  ArrowLeftRight,
  HeartPulse,
  MapPin,
  Check,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useEstateFilter } from "../hooks/useEstateFilter";
import { useOpenPinjaman } from "../hooks/useOpenPinjaman";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { canModule, pageAllowed, userEstates, OPNAME_PATH, PINJAMAN_PATH, LAPORAN_KLINIK_PATH, type Module } from "../lib/access";

type NavItem = { to: string; label: string; icon: typeof Package };
type NavSection = { title?: string; collapsible?: boolean; items: NavItem[] };

// Every inventory module has one page per estate. The sidebar shows one estate picker plus one link
// per module, so switching estate (same module) or module (same estate) is a single click.
const ESTATES = [
  { code: "NILAM", label: "Nilam", suffix: "" },
  { code: "KNS", label: "KNS", suffix: "-kns" },
  { code: "WJA", label: "WJA", suffix: "-wja" },
  { code: "ZAMRUD", label: "Zamrud", suffix: "-zamrud" },
  { code: "FIRUS", label: "Firus", suffix: "-firus" },
];

type ModuleLink = { key: Module; icon: typeof Package; title: string; base: string };

const MODULE_LINKS: ModuleLink[] = [
  { key: "GUDANG", icon: Package, title: "Gudang", base: "/inventory" },
  { key: "BBM", icon: Fuel, title: "BBM", base: "/inventory-bbm" },
  { key: "PUPUK", icon: Sprout, title: "Pupuk NPK", base: "/inventory-pupuk" },
  { key: "OLI", icon: Droplet, title: "Oli", base: "/inventory-oli" },
  { key: "KLINIK", icon: Stethoscope, title: "Klinik", base: "/inventory-klinik" },
];

const pathFor = (m: ModuleLink, estate: string) => m.base + (ESTATES.find((e) => e.code === estate)?.suffix ?? "");

// "/inventory-bbm-kns" -> { BBM, KNS }; null for any other page.
function pageOf(pathname: string): { module: ModuleLink; estate: string } | null {
  for (const m of MODULE_LINKS)
    for (const e of ESTATES) if (pathFor(m, e.code) === pathname) return { module: m, estate: e.code };
  return null;
}

const LAST_ESTATE_KEY = "sidebar-estate";

const navSections: NavSection[] = [
  { items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Inventory",
    collapsible: true,
    items: [
      { to: OPNAME_PATH, label: "Stok Opname", icon: ClipboardCheck },
      { to: PINJAMAN_PATH, label: "Pinjaman & Transfer", icon: ArrowLeftRight },
      { to: LAPORAN_KLINIK_PATH, label: "Laporan Harian Klinik", icon: HeartPulse },
    ],
  },
  {
    title: "Master Data",
    collapsible: true,
    items: [
      { to: "/master-barang", label: "Barang", icon: Package },
      { to: "/master-obat", label: "Obat", icon: Pill },
      { to: "/master-oli", label: "Oli", icon: Droplet },
      { to: "/karyawan", label: "Karyawan", icon: Users },
      { to: "/alat-berat", label: "Alat Berat", icon: Truck },
      { to: "/users", label: "Pengguna", icon: KeyRound },
    ],
  },
  {
    title: "Monitoring",
    collapsible: true,
    items: [{ to: "/log-user", label: "Log Aktivitas User", icon: Activity }],
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
  const [changingPassword, setChangingPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
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

  const pickedEstates = useEstateFilter((s) => s.picked);
  const openLoans = useOpenPinjaman((s) => s.loans.length);

  // Inventory menus list the estates the account may open (narrowed to the ones picked on the
  // dashboard, if any) and only the modules it may view. Master data / monitoring pages follow their
  // own permission. Stock In / Stock Out live as tabs inside each Gudang/Klinik page. The server
  // enforces the same rules (app.ts requiredPerms / estateAllowed).
  const ownEstates = userEstates(user);
  const picked = pickedEstates.filter((e) => ownEstates.includes(e));
  const shownEstates = picked.length ? picked : ownEstates;
  const shownEstateList = ESTATES.filter((e) => shownEstates.includes(e.code));
  const moduleLinks = MODULE_LINKS.filter((m) => canModule(user, m.key));

  const visibleSections = navSections
    .map((s) => ({ ...s, items: s.items.filter((it) => it.to === "/" || pageAllowed(user, it.to)) }))
    .filter((s) => !s.title || s.title === "Inventory" || s.items.length > 0);

  // The estate the module links point at: the current page's estate, else the last one used (while
  // it's still one of this account's estates), else the first.
  const current = pageOf(location.pathname);
  const [chosenEstate, setChosenEstate] = useState(() => {
    try {
      return localStorage.getItem(LAST_ESTATE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const activeEstate =
    current && shownEstates.includes(current.estate)
      ? current.estate
      : shownEstates.includes(chosenEstate)
        ? chosenEstate
        : shownEstateList[0]?.code;
  const activeEstateLabel = ESTATES.find((e) => e.code === activeEstate)?.label ?? "";
  const [estateMenuOpen, setEstateMenuOpen] = useState(false);

  useEffect(() => {
    if (!current) return;
    setChosenEstate(current.estate);
    try {
      localStorage.setItem(LAST_ESTATE_KEY, current.estate);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // On an inventory page, picking another estate opens the same module (and tab) there; elsewhere
  // it only changes where the module links go.
  const pickEstate = (code: string) => {
    setChosenEstate(code);
    try {
      localStorage.setItem(LAST_ESTATE_KEY, code);
    } catch {
      // ignore
    }
    if (current) {
      const tab = new URLSearchParams(location.search).get("tab");
      navigate(pathFor(current.module, code) + (tab ? `?tab=${tab}` : ""));
    }
  };

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
          // Sections start closed (except Inventory) so the sidebar stays short; a closed section that holds the
          // current page shows a dot so it's still clear where you are.
          const isOpen =
            minimized || !section.collapsible ? true : !(groupCollapsed[section.title!] ?? section.title !== "Inventory");
          const hasActive =
            section.items.some((it) => it.to === location.pathname || (it.to !== "/" && location.pathname.startsWith(`${it.to}/`))) ||
            (section.title === "Inventory" && !!current);

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
                    setGroupCollapsed((c) => ({ ...c, [section.title!]: isOpen }))
                  }
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[10px] font-semibold tracking-wider text-white/55 uppercase hover:text-white hover:bg-white/5"
                >
                  <span className="flex items-center gap-2">
                    {section.title}
                    {!isOpen && hasActive && <span className="w-1.5 h-1.5 rounded-full bg-[#b9f0c9]" />}
                  </span>
                  <ChevronDown size={12} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                </button>
              )}

              {isOpen && section.title === "Inventory" && shownEstateList.length > 1 && (
                <div className="pb-1">
                  <button
                    onClick={() => setEstateMenuOpen((o) => !o)}
                    title="Pilih estate"
                    className={`w-full flex items-center rounded-md bg-white/10 hover:bg-white/15 text-white transition-colors ${
                      minimized ? "flex-col gap-0.5 py-1.5" : "gap-2 px-3 py-2"
                    }`}
                  >
                    <MapPin size={minimized ? 14 : 16} className="shrink-0 text-[#b9f0c9]" />
                    {minimized ? (
                      <span className="text-[10px] font-semibold">{activeEstateLabel.slice(0, 3).toUpperCase()}</span>
                    ) : (
                      <>
                        <span className="flex-1 text-left text-sm">
                          <span className="text-white/55 text-xs">Estate </span>
                          <span className="font-semibold">{activeEstateLabel}</span>
                        </span>
                        <ChevronDown size={14} className={`transition-transform ${estateMenuOpen ? "rotate-180" : ""}`} />
                      </>
                    )}
                  </button>
                  {estateMenuOpen && (
                    <div className="mt-1 py-1 rounded-md bg-black/15">
                      {shownEstateList.map((e) => (
                        <button
                          key={e.code}
                          onClick={() => {
                            pickEstate(e.code);
                            setEstateMenuOpen(false);
                          }}
                          className={`w-full flex items-center py-1.5 text-sm transition-colors ${
                            minimized ? "justify-center text-[11px]" : "gap-2 pl-9 pr-3"
                          } ${
                            e.code === activeEstate
                              ? "text-white font-semibold"
                              : "text-white/65 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          <span className={`flex-1 ${minimized ? "text-center" : "text-left"}`}>{minimized ? e.label.slice(0, 3).toUpperCase() : e.label}</span>
                          {!minimized && e.code === activeEstate && <Check size={14} className="text-[#b9f0c9]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isOpen &&
                section.title === "Inventory" &&
                activeEstate &&
                moduleLinks.map((m) => {
                  const Icon = m.icon;
                  const active = current?.module.key === m.key;
                  return (
                    <NavLink
                      key={m.key}
                      to={pathFor(m, activeEstate)}
                      title={minimized ? m.title : undefined}
                      className={`flex items-center gap-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                        minimized ? "justify-center px-0" : "px-3"
                      } ${
                        active
                          ? `bg-white/15 text-white ${minimized ? "" : "border-l-[3px] border-[#b9f0c9] pl-[9px]"}`
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon size={17} className="shrink-0 text-[#b9f0c9]" />
                      {!minimized && m.title}
                    </NavLink>
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
                    <span className="relative shrink-0">
                      <Icon size={17} className="text-[#b9f0c9]" />
                      {minimized && to === PINJAMAN_PATH && openLoans > 0 && (
                        <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-[#f59e0b] text-[10px] leading-4 text-center text-white">
                          {openLoans}
                        </span>
                      )}
                    </span>
                    {!minimized && <span className="flex-1">{label}</span>}
                    {!minimized && to === PINJAMAN_PATH && openLoans > 0 && (
                      <span
                        title={`${openLoans} pinjaman belum kembali`}
                        className="min-w-5 h-5 px-1.5 rounded-full bg-[#f59e0b] text-[11px] leading-5 text-center text-white"
                      >
                        {openLoans}
                      </span>
                    )}
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
          onClick={() => setChangingPassword(true)}
          title="Ganti Password"
          className={`flex items-center gap-2 py-2 rounded-md text-sm text-white/60 hover:bg-white/10 hover:text-white ${
            minimized ? "justify-center px-0 w-full" : "px-2 w-full"
          }`}
        >
          <KeyRound size={16} className="shrink-0" />
          {!minimized && "Ganti Password"}
        </button>
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
    {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </>
  );
}
