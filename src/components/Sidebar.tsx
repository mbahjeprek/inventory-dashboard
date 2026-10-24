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
  Scissors,
  Pill,
  Stethoscope,
  Activity,
  ClipboardCheck,
  Signature,
  Droplet,
  ArrowLeftRight,
  Contact,
  MapPin,
  Grid3x3,
  Map as MapIcon,
  Check,
  ShoppingBasket,
  FolderOpen,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useEstateFilter } from "../hooks/useEstateFilter";
import { useOpenPinjaman } from "../hooks/useOpenPinjaman";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { canModule, hasDashboard, pageAllowed, userEstates, OPNAME_PATH, PINJAMAN_PATH, PASIEN_PATH, KOPERASI_PATH, KENDARAAN_PATH, PRUNING_PATH, DOKUMEN_PATH, SOP_PATH, PERSETUJUAN_PATH, type Module } from "../lib/access";

// subtitle: shown only on the active menu, which grows into a gold card (see NavRow).
type NavItem = { to: string; label: string; icon: typeof Package; subtitle?: string };
type NavSection = { title?: string; collapsible?: boolean; items: NavItem[] };

// Every inventory module has one page per estate. The sidebar shows one estate picker plus one link
// per module, so switching estate (same module) or module (same estate) is a single click.
const ESTATES = [
  { code: "NILAM", label: "Nilam", suffix: "" },
  { code: "FIRUS", label: "Firus", suffix: "-firus" },
  { code: "ZAMRUD", label: "Zamrud", suffix: "-zamrud" },
  { code: "KNS", label: "KNS", suffix: "-kns" },
  { code: "WJA", label: "WJA", suffix: "-wja" },
];

type ModuleLink = { key: Module; icon: typeof Package; title: string; base: string; subtitle: string; slug: string };

const MODULE_LINKS: ModuleLink[] = [
  { key: "GUDANG", icon: Package, title: "Gudang", base: "/inventory", subtitle: "Stok barang · In & Out", slug: "gudang" },
  { key: "BBM", icon: Fuel, title: "BBM", base: "/inventory-bbm", subtitle: "Solar · Pemakaian", slug: "bbm" },
  { key: "PUPUK", icon: Sprout, title: "Pupuk", base: "/inventory-pupuk", subtitle: "Stok & penyaluran", slug: "pupuk" },
  { key: "OLI", icon: Droplet, title: "Oli", base: "/inventory-oli", subtitle: "Stok & pemakaian", slug: "oli" },
  { key: "KLINIK", icon: Stethoscope, title: "Klinik", base: "/inventory-klinik", subtitle: "Obat · Pasien", slug: "klinik" },
];

// "Semua estate" in the picker: the module links open that menu's all-estate page (SemuaEstatePage).
const ALL = "ALL";
const pathFor = (m: ModuleLink, estate: string) =>
  estate === ALL ? `/semua-estate/${m.slug}` : m.base + (ESTATES.find((e) => e.code === estate)?.suffix ?? "");

// "/inventory-bbm-kns" -> { BBM, KNS }, "/semua-estate/bbm" -> { BBM, ALL }; null for any other page.
function pageOf(pathname: string): { module: ModuleLink; estate: string } | null {
  for (const m of MODULE_LINKS) {
    if (pathFor(m, ALL) === pathname) return { module: m, estate: ALL };
    for (const e of ESTATES) if (pathFor(m, e.code) === pathname) return { module: m, estate: e.code };
  }
  return null;
}

const LAST_ESTATE_KEY = "sidebar-estate";

const navSections: NavSection[] = [
  {
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, subtitle: "Ringkasan semua estate" },
      { to: PERSETUJUAN_PATH, label: "Persetujuan", icon: Signature, subtitle: "Permintaan Obat & Berita Acara" },
    ],
  },
  {
    title: "Inventory",
    collapsible: true,
    items: [
      { to: OPNAME_PATH, label: "Stok Opname", icon: ClipboardCheck, subtitle: "Hitung fisik vs sistem" },
      { to: PINJAMAN_PATH, label: "Pinjaman & Transfer", icon: ArrowLeftRight, subtitle: "Antar estate" },
    ],
  },
  { title: "Koperasi", items: [{ to: KOPERASI_PATH, label: "Koperasi PT.AKSS", icon: ShoppingBasket, subtitle: "Stock Out & Potong Gaji" }] },
  { title: "Kendaraan", items: [{ to: KENDARAAN_PATH, label: "Kendaraan & Alat Berat", icon: Truck, subtitle: "Unit, kondisi & downtime PT.AKSS" }] },
  { title: "Kebun", items: [{ to: PRUNING_PATH, label: "Pruning PT.AKSS", icon: Scissors, subtitle: "Input & rekap pruning per blok" }] },
  {
    title: "Master Data",
    collapsible: true,
    items: [
      { to: "/master-barang", label: "Barang", icon: Package, subtitle: "Daftar barang gudang" },
      { to: "/master-obat", label: "Obat", icon: Pill, subtitle: "Daftar obat klinik" },
      { to: PASIEN_PATH, label: "Pasien", icon: Contact, subtitle: "Data pasien klinik" },
      { to: "/master-oli", label: "Oli", icon: Droplet, subtitle: "Jenis oli" },
      { to: "/master-pupuk", label: "Pupuk", icon: Sprout, subtitle: "Jenis pupuk" },
      { to: "/karyawan", label: "Karyawan", icon: Users, subtitle: "Data karyawan" },
      { to: "/alat-berat", label: "Alat Berat", icon: Truck, subtitle: "Unit & kendaraan" },
      { to: "/master-blok", label: "Blok", icon: Grid3x3, subtitle: "Blok kebun" },
      { to: "/peta-blok", label: "Peta Blok", icon: MapIcon, subtitle: "Peta kebun" },
      { to: DOKUMEN_PATH, label: "Dokumen & Link", icon: FolderOpen, subtitle: "No, nama, PIC & link" },
      { to: SOP_PATH, label: "Daftar SOP", icon: ClipboardCheck, subtitle: "SOP per bagian & status" },
      { to: "/users", label: "Pengguna", icon: KeyRound, subtitle: "Akun & hak akses" },
    ],
  },
  {
    title: "Monitoring",
    collapsible: true,
    items: [{ to: "/log-user", label: "Log Aktivitas User", icon: Activity, subtitle: "Riwayat aksi pengguna" }],
  },
];

const isPathActive = (to: string, pathname: string) => to === pathname || (to !== "/" && pathname.startsWith(`${to}/`));

// One menu row. Idle: a compact icon + label line. Active: it grows into a gold card - the icon in a round
// badge, a bolder label and the subtitle sliding open - so moving between menus visibly moves the card.
function NavRow({
  to,
  label,
  icon: Icon,
  subtitle,
  active,
  minimized,
  badge,
}: NavItem & { active: boolean; minimized: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      title={minimized ? label : undefined}
      className={`group flex items-center rounded-lg transition-all duration-200 ease-out ${
        minimized ? "justify-center p-1.5" : `gap-3 px-2 ${active ? "py-2.5" : "py-1.5"}`
      } ${active ? "bg-[#f5c542] text-[#1f3d12] shadow-md" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
    >
      <span
        className={`relative shrink-0 flex items-center justify-center rounded-full transition-all duration-200 ${
          active ? "w-9 h-9 bg-[#1f3d12]/10" : "w-7 h-7 group-hover:bg-white/10 group-hover:translate-x-0.5"
        }`}
      >
        <Icon size={17} className={`transition-colors duration-200 ${active ? "text-[#1f3d12]" : "text-[#b9f0c9]"}`} />
        {minimized && !!badge && (
          <span className="absolute -top-1 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-[#f59e0b] text-[10px] leading-4 text-center text-white">
            {badge}
          </span>
        )}
      </span>
      {!minimized && (
        <span className="flex-1 min-w-0">
          <span className={`block leading-tight transition-all duration-200 ${active ? "text-[15px] font-bold" : "text-sm font-semibold"}`}>
            {label}
          </span>
          {subtitle && (
            <span className={`grid transition-all duration-200 ease-out ${active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <span className="overflow-hidden">
                <span className="block text-[11px] leading-tight mt-0.5 text-[#1f3d12]/75">{subtitle}</span>
              </span>
            </span>
          )}
        </span>
      )}
      {!minimized && !!badge && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#f59e0b] text-[11px] leading-5 text-center text-white">{badge}</span>
      )}
    </NavLink>
  );
}

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
    // An account without an inventory module has no main Dashboard: only the pages it can open show.
    .map((s) => ({ ...s, items: s.items.filter((it) => (it.to === "/" ? hasDashboard(user) : pageAllowed(user, it.to))) }))
    .filter((s) => (s.title === "Inventory" ? moduleLinks.length > 0 || s.items.length > 0 : s.items.length > 0));

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
  const multi = shownEstateList.length > 1;
  const usable = (code: string) => shownEstates.includes(code) || (code === ALL && multi);
  const activeEstate = current && usable(current.estate) ? current.estate : usable(chosenEstate) ? chosenEstate : shownEstateList[0]?.code;
  const activeEstateLabel = activeEstate === ALL ? "Semua estate" : (ESTATES.find((e) => e.code === activeEstate)?.label ?? "");
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
          // Sections start closed (except Inventory, or the only section an account has, e.g. Koperasi) so the
          // sidebar stays short; a closed section that holds the current page shows a dot so it's still clear where you are.
          const isOpen =
            minimized || !section.collapsible
              ? true
              : !(groupCollapsed[section.title!] ?? (section.title !== "Inventory" && visibleSections.filter((x) => x.title).length > 1));
          const hasActive =
            section.items.some((it) => isPathActive(it.to, location.pathname)) ||
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
                      <span className="text-[10px] font-semibold">{activeEstate === ALL ? "ALL" : activeEstateLabel.slice(0, 3).toUpperCase()}</span>
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
                      {[{ code: ALL, label: "Semua estate" }, ...shownEstateList].map((e) => (
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
                          <span className={`flex-1 ${minimized ? "text-center" : "text-left"} ${e.code === ALL && !minimized ? "italic" : ""}`}>
                            {minimized ? (e.code === ALL ? "ALL" : e.label.slice(0, 3).toUpperCase()) : e.label}
                          </span>
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
                moduleLinks.map((m) => (
                  <NavRow
                    key={m.key}
                    to={pathFor(m, activeEstate)}
                    label={m.title}
                    icon={m.icon}
                    subtitle={`${activeEstateLabel} · ${m.subtitle}`}
                    active={current?.module.key === m.key}
                    minimized={minimized}
                  />
                ))}

              {isOpen &&
                section.items.map((it) => (
                  <NavRow
                    key={it.to}
                    {...it}
                    active={isPathActive(it.to, location.pathname)}
                    minimized={minimized}
                    badge={it.to === PINJAMAN_PATH && openLoans > 0 ? openLoans : undefined}
                  />
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
