import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Eraser, Hand, Lock, LockOpen, Maximize2, Minimize2, Minus, Paintbrush, Plus, Save, Scissors, Search, Trash2 } from "lucide-react";
import { api, errorText, type PetaBlok, type PetaCell, type PetaLegend, type PetaPruning, type PruningBlok } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can, pageAllowed, PRUNING_PATH } from "../lib/access";

const ESTATE_LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };
const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "-" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const SWATCHES = ["#6aa84f", "#ffff00", "#ff0000", "#ff9900", "#4a86e8", "#9900ff", "#ff00ff", "#00ffff", "#b7b7b7", "#783f04"];
const NO_DATA = "#eef1f4";

// Black or white text, whichever reads better on the fill.
const textOn = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.55 ? "#1a2634" : "#ffffff";
};
const pctOf = (c: PetaCell) => (c.pkk ? ((c.kg ?? 0) / c.pkk) * 100 : null);
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
// "2026-09-01" -> "Sep 2026" (the old sheet's months are dated the 1st, so only the month is shown).
const bulanTahun = (iso: string | null) => (iso ? `${BULAN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "-");
const keyOf = (estate: string | null, blok: string) => `${estate}|${blok.toUpperCase()}`;
const pruningPct = (p: PruningBlok | undefined) => (p?.target ? (p.pkk / p.target) * 100 : null);

type Mode = "progress" | "pruning" | "bebas";
type Preset = "semua" | "tahun" | "6" | "custom";

// Master Data > Peta Blok: the AKSS block map as in the "mapping pemupukan npk akss" sheet. Progress
// pemupukan colours every blok by kg NPK out to it / its PKK, with an editable legend; Progress
// pruning by pokok pruned in a year (Rekap Pruning sheet, synced) / Ha x SPH, with its own legend;
// Warna Bebas lets the user paint blok any colour (saved for everyone).
export function PetaBlokPage() {
  const [data, setData] = useState<PetaBlok | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("progress");
  const [preset, setPreset] = useState<Preset>("semua");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [estate, setEstate] = useState("");
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  // Layar penuh: the page covers the window (and the browser goes full screen where it can).
  const [full, setFull] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleFull = () => {
    if (full) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setFull(false);
    } else {
      setFull(true);
      rootRef.current?.requestFullscreen?.().catch(() => {});
    }
  };
  useEffect(() => {
    // Esc (or the browser's own exit) leaves full screen: the page follows.
    const onChange = () => !document.fullscreenElement && setFull(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const [hover, setHover] = useState<PetaCell | null>(null);
  const [paint, setPaint] = useState<string | null>("#6aa84f");
  // The legend being shown / edited: the pemupukan one, or the pruning one on the pruning tab.
  const [legend, setLegend] = useState<PetaLegend[]>([]);
  const [pruning, setPruning] = useState<PetaPruning | null>(null);
  const [tahun, setTahun] = useState<number | null>(null);
  const [legendDirty, setLegendDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const stroke = useRef<Set<number> | null>(null);
  // Warna Bebas: the brush paints the blok it is dragged over, Geser drags the map like everywhere else.
  const [tool, setTool] = useState<"kuas" | "geser">("kuas");
  // Changing colours / the legend needs Ubah Peta Blok (Pengguna) and the page unlocked first, so a
  // stray click or drag never paints; it opens locked every time.
  const { user } = useAuth();
  const canEdit = can(user, "master.peta_edit");
  const [unlocked, setUnlocked] = useState(false);
  const editing = canEdit && unlocked;
  const painting = editing && mode === "bebas" && tool === "kuas";
  // Drag the map with the mouse (hold and pull), and Ctrl + scroll wheel zooms.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0 || !scrollRef.current) return;
    if (painting && (e.target as Element).closest("[data-cell]")) return;
    e.preventDefault();
    pan.current = { x: e.clientX, y: e.clientY, left: scrollRef.current.scrollLeft, top: scrollRef.current.scrollTop };
    setPanning(true);
  };
  // Ctrl + wheel zooms the map instead of the browser page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(2, Math.max(0.5, +(z + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(1))));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [!!data]);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = pan.current;
      const el = scrollRef.current;
      if (!p || !el) return;
      el.scrollLeft = p.left - (e.clientX - p.x);
      el.scrollTop = p.top - (e.clientY - p.y);
    };
    const up = () => {
      if (!pan.current) return;
      pan.current = null;
      setPanning(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const now = new Date();
  const range =
    preset === "tahun"
      ? { dateFrom: `${now.getFullYear()}-01-01`, dateTo: localIso(now) }
      : preset === "6"
        ? { dateFrom: localIso(new Date(now.getFullYear(), now.getMonth() - 5, 1)), dateTo: localIso(now) }
        : preset === "custom"
          ? { dateFrom: custom.from, dateTo: custom.to }
          : { dateFrom: "", dateTo: "" };

  const legendOf = (d: PetaBlok, m: Mode) => (m === "pruning" ? d.pruningLegend : d.legend);
  const load = () =>
    api
      .petaBlok(range)
      .then(setData)
      .catch((e) => setError(errorText(e, "Gagal memuat peta")));
  // The legend follows the tab and the saved one, unless it is being edited.
  useEffect(() => {
    if (data && !legendDirty) setLegend(legendOf(data, mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode]);
  // Pruning: loaded with the tab (the server re-reads the sheet when its copy is old), or now.
  const loadPruning = () =>
    api
      .petaPruning(tahun)
      .then(setPruning)
      .catch((e) => setError(errorText(e, "Gagal memuat data pruning")));
  useEffect(() => {
    if (mode === "pruning") loadPruning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tahun]);
  const pickMode = (m: Mode) => {
    setMode(m);
    setLegendDirty(false);
  };
  const pruneOf = useMemo(() => new Map((pruning?.blok ?? []).map((p) => [keyOf(p.estate, p.blok), p])), [pruning]);
  const pr = (c: PetaCell) => pruneOf.get(keyOf(c.estate, c.label));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.dateFrom, range.dateTo]);

  const blok = useMemo(() => (data?.cells ?? []).filter((c) => c.kind === "blok"), [data]);
  const labels = useMemo(() => (data?.cells ?? []).filter((c) => c.kind === "label"), [data]);
  const cols = Math.max(0, ...(data?.cells ?? []).map((c) => c.gx)) + 1;
  const rows = Math.max(0, ...(data?.cells ?? []).map((c) => c.gy + c.h)) + 1;
  const CW = 70 * zoom;
  const CH = 26 * zoom;
  const sorted = [...legend].sort((a, b) => b.dari - a.dari);
  const pctFor = (c: PetaCell) => (mode === "pruning" ? pruningPct(pr(c)) : pctOf(c));
  const autoColor = (c: PetaCell) => {
    const p = pctFor(c);
    if (p === null) return NO_DATA;
    return sorted.find((l) => p >= l.dari)?.warna ?? "#ffffff";
  };
  const fillOf = (c: PetaCell) => (mode === "bebas" ? c.warna ?? "#ffffff" : autoColor(c));
  const q = search.trim().toLowerCase();
  const hit = (c: PetaCell) => !!q && c.label.toLowerCase() === q;
  const near = (c: PetaCell) => !!q && !hit(c) && c.label.toLowerCase().includes(q);

  // Scroll the exact match into view.
  useEffect(() => {
    if (!q) return;
    const c = blok.find(hit);
    if (c) document.getElementById(`peta-${c.id}`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data]);

  // Totals like the sheet's (POKOK, HA, TON, %) over the blok of the chosen estate.
  const scope = blok.filter((c) => (mode === "pruning" ? !!pr(c) : c.pkk !== null) && (!estate || c.estate === estate));
  const tot = scope.reduce((s, c) => ({ pkk: s.pkk + (c.pkk ?? 0), ha: s.ha + (c.ha ?? 0), kg: s.kg + (c.kg ?? 0) }), { pkk: 0, ha: 0, kg: 0 });
  // Pruning totals over the blok on the map, like the sheet's (target pokok, realisasi, %).
  const totP = scope.reduce(
    (s, c) => {
      const p = pr(c);
      return { target: s.target + (p?.target ?? 0), pkk: s.pkk + (p?.pkk ?? 0), ha: s.ha + (p?.ha ?? 0), haP: s.haP + (p?.ha_pruning ?? 0), belum: s.belum + (p && !p.pkk ? 1 : 0) };
    },
    { target: 0, pkk: 0, ha: 0, haP: 0, belum: 0 }
  );
  const countOf = (l: PetaLegend) =>
    scope.filter((c) => {
      const p = pctFor(c);
      return p !== null && sorted.find((x) => p >= x.dari) === l;
    }).length;

  // Warna Bebas: a press starts a stroke, every box passed over joins it, letting go saves it.
  const paintCell = (c: PetaCell) => {
    if (!stroke.current || stroke.current.has(c.id)) return;
    stroke.current.add(c.id);
    setData((d) => (d ? { ...d, cells: d.cells.map((x) => (x.id === c.id ? { ...x, warna: paint } : x)) } : d));
  };
  useEffect(() => {
    const up = () => {
      const ids = stroke.current;
      stroke.current = null;
      if (!ids?.size) return;
      api.petaBlokWarna([...ids], paint).catch((e) => {
        setError(errorText(e, "Gagal menyimpan warna"));
        load();
      });
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, range.dateFrom, range.dateTo]);

  const clearAll = async () => {
    const ids = blok.filter((c) => c.warna && (!estate || c.estate === estate)).map((c) => c.id);
    if (!ids.length || !window.confirm(`Hapus warna bebas dari ${ids.length} blok${estate ? ` ${ESTATE_LABEL[estate]}` : ""}?`)) return;
    await api.petaBlokWarna(ids, null);
    load();
  };

  const saveLegend = async () => {
    setSaving(true);
    setError("");
    try {
      await api.petaBlokLegend(
        legend.map(({ dari, label, warna }) => ({ dari, label, warna })),
        mode === "pruning" ? "pruning" : "pupuk"
      );
      setLegendDirty(false);
      load();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan legenda"));
    } finally {
      setSaving(false);
    }
  };
  const setLegendItem = (i: number, patch: Partial<PetaLegend>) => {
    setLegend((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setLegendDirty(true);
  };

  // The map as a PNG (white background), for sharing.
  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const w = svg.width.baseVal.value;
    const h = svg.height.baseVal.value;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const a = document.createElement("a");
      a.download = `peta-blok-${mode === "bebas" ? "warna-bebas" : mode === "pruning" ? `progress-pruning-${pruning?.tahun ?? ""}` : "progress-pemupukan"}-${localIso(new Date())}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  };

  const inputCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => pickMode(m)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${mode === m ? "border-[var(--accent-blue)] text-[var(--accent-blue)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
    >
      {label}
    </button>
  );
  const hp = hover ? pctOf(hover) : null;
  const hpr = hover ? pr(hover) : undefined;
  // Warna Bebas, read-only: the colours painted (in the chosen estate) and on how many blok.
  const usedColors = [
    ...blok
      .filter((c) => c.warna && (!estate || c.estate === estate))
      .reduce((m, c) => m.set(c.warna!, (m.get(c.warna!) ?? 0) + 1), new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);

  return (
    <div ref={rootRef} className={full ? "fixed inset-0 z-50 overflow-auto bg-[var(--bg-page)] p-3 sm:p-4 space-y-3" : "space-y-4"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Peta Blok AKSS</h1>
          <p className="text-sm text-[var(--text-secondary)]">Mapping pemupukan NPK dan pruning per blok, atau warnai blok sesuai kebutuhan</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button
              onClick={() => {
                if (editing && legendDirty) {
                  setLegend(data?.legend ?? []);
                  setLegendDirty(false);
                }
                setUnlocked(!unlocked);
              }}
              title={editing ? "Kunci lagi supaya peta tidak berubah karena salah klik" : "Buka kunci untuk mengubah warna / legenda"}
              className={`inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border ${
                editing
                  ? "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"
                  : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[#f1f5f9]"
              }`}
            >
              {editing ? <LockOpen size={16} /> : <Lock size={16} />} {editing ? "Edit terbuka · Kunci" : "Buka Edit"}
            </button>
          )}
          <button onClick={download} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[#f1f5f9]">
            <Download size={16} /> Unduh Gambar
          </button>
          <button
            onClick={toggleFull}
            title={full ? "Keluar layar penuh (Esc)" : "Tampilkan peta layar penuh"}
            className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] bg-[var(--bg-card)] hover:bg-[var(--accent-blue-bg)]"
          >
            {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />} {full ? "Keluar Layar Penuh" : "Layar Penuh"}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--border)]">
        {tab("progress", "Progress Pemupukan")}
        {tab("pruning", "Progress Pruning")}
        {tab("bebas", "Warna Bebas")}
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative w-full sm:w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari blok (cth. I-5)" className={`${inputCls} w-full pl-8`} />
        </div>
        <select value={estate} onChange={(e) => setEstate(e.target.value)} className={inputCls} aria-label="Estate">
          <option value="">Semua estate</option>
          {data?.estates.map((e) => (
            <option key={e} value={e}>
              {ESTATE_LABEL[e] ?? e}
            </option>
          ))}
        </select>
        {mode === "progress" && (
          <>
            <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={inputCls} aria-label="Periode pupuk">
              <option value="semua">Pupuk: semua data</option>
              <option value="tahun">Pupuk: tahun ini</option>
              <option value="6">Pupuk: 6 bulan terakhir</option>
              <option value="custom">Pupuk: pilih tanggal...</option>
            </select>
            {preset === "custom" && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={inputCls} aria-label="Dari" />
                <span className="text-[var(--text-muted)]">-</span>
                <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={inputCls} aria-label="Sampai" />
              </div>
            )}
          </>
        )}
        {mode === "pruning" && (
          <>
            <select value={pruning?.tahun ?? ""} onChange={(e) => setTahun(Number(e.target.value))} className={inputCls} aria-label="Tahun pruning">
              {(pruning?.tahunList.length ? pruning.tahunList : [new Date().getFullYear()]).map((t) => (
                <option key={t} value={t}>
                  Pruning tahun {t}
                </option>
              ))}
            </select>
            {pageAllowed(user, PRUNING_PATH) && (
              <Link
                to={PRUNING_PATH}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]"
              >
                <Scissors size={14} /> {can(user, "pruning.input") ? "Input pruning" : "Rekap pruning"}
              </Link>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} title="Perkecil" className="p-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
            <Minus size={14} />
          </button>
          <span className="text-xs w-10 text-center text-[var(--text-secondary)]">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))} title="Perbesar" className="p-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      {mode === "pruning" && (
        <p className="text-xs text-[var(--text-secondary)]">Data dari menu Kebun › Pruning PT.AKSS: setiap input pruning langsung tampil di peta ini.</p>
      )}

      <div className="grid gap-3 xl:grid-cols-[1fr_20rem] items-start">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border)] text-xs min-h-[2.25rem] flex items-center">
            {hover ? (
              <span>
                <b className="text-[var(--text-primary)]">Blok {hover.label}</b>
                {hover.estate ? ` · ${ESTATE_LABEL[hover.estate] ?? hover.estate}` : " · tidak ada di Master Blok"}
                {hover.divisi && ` · Div ${hover.divisi}`}
                {hover.tahun_tanam && ` · TT ${hover.tahun_tanam}`}
                {mode === "pruning"
                  ? hpr && ` · pruning ${pruning?.tahun}: ${fmt(hpr.pkk)} / ${fmt(hpr.target)} pokok (${fmt(pruningPct(hpr), 1)}%) · terakhir ${bulanTahun(hpr.terakhir)}`
                  : hover.pkk !== null && ` · ${fmt(hover.ha, 2)} Ha · ${fmt(hover.pkk)} pokok · pupuk ${fmt(hover.kg ?? 0)} kg (${fmt(hp, 1)}%)`}
                {mode !== "pruning" && hover.terakhir && ` · terakhir dipupuk ${hover.terakhir.split("-").reverse().join("/")}`}
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">
                {painting
                  ? "Klik / tarik di atas blok untuk mewarnai (tersimpan otomatis). Pilih Geser peta di kanan untuk menggeser."
                  : "Klik tahan lalu tarik untuk menggeser peta · Ctrl + scroll untuk zoom · arahkan kursor ke blok untuk detailnya."}
              </span>
            )}
          </div>
          <div
            ref={scrollRef}
            onMouseDown={startPan}
            className={`overflow-auto relative ${full ? "max-h-[calc(100vh-13rem)]" : "max-h-[75vh]"}`}
            style={{ cursor: panning ? "grabbing" : "grab" }}
            onMouseLeave={() => setHover(null)}
          >
            {!data ? (
              <p className="p-4 text-sm text-[var(--text-muted)]">Memuat peta...</p>
            ) : (
              <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                width={cols * CW + 20}
                height={rows * CH + 20}
                style={{ userSelect: "none", fontFamily: "Arial, sans-serif" }}
              >
                <g transform="translate(10,10)">
                  {/* Compass, top-left like the sheet */}
                  <g transform={`translate(${CW * 0.4},${CH * 0.4}) scale(${zoom})`} opacity={0.85}>
                    <rect x={0} y={0} width={110} height={110} fill="#fff" stroke="#1a2634" strokeWidth={1} />
                    <path d="M55 14 L62 48 L96 55 L62 62 L55 96 L48 62 L14 55 L48 48 Z" fill="#4a7bd0" />
                    <text x={55} y={11} textAnchor="middle" fontSize={11} fontWeight={700}>N</text>
                    <text x={55} y={107} textAnchor="middle" fontSize={11} fontWeight={700}>S</text>
                    <text x={6} y={59} textAnchor="middle" fontSize={11} fontWeight={700}>W</text>
                    <text x={104} y={59} textAnchor="middle" fontSize={11} fontWeight={700}>E</text>
                  </g>
                  {blok.map((c) => {
                    const fill = fillOf(c);
                    const dim = estate && c.estate !== estate;
                    return (
                      <g
                        key={c.id}
                        id={`peta-${c.id}`}
                        opacity={dim ? 0.25 : 1}
                        onMouseEnter={() => {
                          setHover(c);
                          if (painting) paintCell(c);
                        }}
                        data-cell
                        onMouseDown={(e) => {
                          if (!painting || e.button !== 0) return;
                          e.preventDefault();
                          stroke.current = new Set();
                          paintCell(c);
                        }}
                        style={{ cursor: painting ? "crosshair" : panning ? "grabbing" : "grab" }}
                      >
                        <rect
                          x={c.gx * CW}
                          y={c.gy * CH}
                          width={CW}
                          height={CH * c.h}
                          fill={fill}
                          stroke={hit(c) ? "#1d4ed8" : near(c) ? "#60a5fa" : "#9aa5b1"}
                          strokeWidth={hit(c) ? 3 : near(c) ? 2 : 0.6}
                        />
                        <text
                          x={c.gx * CW + CW / 2}
                          y={c.gy * CH + (CH * c.h) / 2 - (mode === "pruning" && pruningPct(pr(c)) !== null ? 5 * zoom : 0)}
                          dominantBaseline="central"
                          textAnchor="middle"
                          fontSize={10 * zoom}
                          fontWeight={600}
                          fill={c.estate ? textOn(fill) : "#8a96a3"}
                        >
                          {c.label}
                        </text>
                        {/* Pruning: the % under the blok name, as the mapping sheet shows it. */}
                        {mode === "pruning" && pruningPct(pr(c)) !== null && (
                          <text
                            x={c.gx * CW + CW / 2}
                            y={c.gy * CH + (CH * c.h) / 2 + 6 * zoom}
                            dominantBaseline="central"
                            textAnchor="middle"
                            fontSize={8 * zoom}
                            fill={textOn(fill)}
                          >
                            {fmt(pruningPct(pr(c)), 0)}%
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {labels.map((l) => (
                    <g key={l.id}>
                      <rect x={l.gx * CW} y={l.gy * CH} width={CW} height={CH} fill="#cfe2f3" />
                      <text x={l.gx * CW + CW / 2} y={l.gy * CH + CH / 2} dominantBaseline="central" textAnchor="middle" fontSize={12 * zoom} fontWeight={700} fill="#1a2634">
                        {l.label}
                      </text>
                    </g>
                  ))}
                </g>
              </svg>
            )}
            {/* Info box next to the hovered blok (to its right, or its left near the right edge). */}
            {hover && !panning && !stroke.current && data && (
              <div
                className="absolute z-10 pointer-events-none w-60 rounded-md border border-[var(--border)] bg-white shadow-lg px-3 py-2 text-xs leading-relaxed"
                style={{
                  left: (hover.gx + 1) * CW + 16 + 240 > cols * CW + 20 ? hover.gx * CW + 4 - 240 : (hover.gx + 1) * CW + 16,
                  top: Math.max(4, hover.gy * CH + 4),
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <b className="text-sm text-[var(--text-primary)]">Blok {hover.label}</b>
                  <span className="text-[var(--text-secondary)]">{hover.estate ? ESTATE_LABEL[hover.estate] ?? hover.estate : ""}</span>
                </div>
                {mode === "pruning" ? (
                  !hpr ? (
                    <div className="text-[var(--text-muted)]">Tidak ada di Rekap Pruning</div>
                  ) : (
                    <>
                      <div className="text-[var(--text-secondary)]">
                        Divisi {hpr.divisi || "-"}
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 mt-1">
                        <span className="text-[var(--text-muted)]">Luas</span>
                        <span className="text-right">{fmt(hpr.ha, 2)} Ha</span>
                        <span className="text-[var(--text-muted)]">Target (Ha × SPH)</span>
                        <span className="text-right">{fmt(hpr.target)} pokok</span>
                        <span className="text-[var(--text-muted)]">Pruning {pruning?.tahun}</span>
                        <span className="text-right">{fmt(hpr.pkk)} pokok</span>
                        <span className="text-[var(--text-muted)]">Ha pruning</span>
                        <span className="text-right">{fmt(hpr.ha_pruning, 2)} Ha</span>
                        <span className="text-[var(--text-muted)]">Progress</span>
                        <span className="text-right font-semibold">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm border border-[var(--border)] mr-1 align-middle" style={{ background: autoColor(hover) }} />
                          {fmt(pruningPct(hpr), 1)}%
                        </span>
                      </div>
                      {hpr.bulan.some((v) => v > 0) && (
                        <div className="mt-1 text-[var(--text-secondary)]">
                          {hpr.bulan
                            .map((v, i) => (v > 0 ? `${BULAN[i]} ${fmt(v)}` : ""))
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                      <div className="text-[var(--text-muted)] mt-1">{hpr.terakhir ? `Terakhir pruning ${bulanTahun(hpr.terakhir)}` : "Belum pernah pruning"}</div>
                    </>
                  )
                ) : hover.pkk === null ? (
                  <div className="text-[var(--text-muted)]">{hover.estate ? "Belum ada data di Master Blok" : "Tidak ada di Master Blok"}</div>
                ) : (
                  <>
                    <div className="text-[var(--text-secondary)]">
                      Divisi {hover.divisi || "-"} · TT {hover.tahun_tanam || "-"}
                      {hover.planting_material && ` · ${hover.planting_material}`}
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 mt-1">
                      <span className="text-[var(--text-muted)]">Luas</span>
                      <span className="text-right">{fmt(hover.ha, 2)} Ha</span>
                      <span className="text-[var(--text-muted)]">Pokok (PKK)</span>
                      <span className="text-right">{fmt(hover.pkk)}</span>
                      <span className="text-[var(--text-muted)]">Pupuk</span>
                      <span className="text-right">{fmt(hover.kg ?? 0)} kg</span>
                      <span className="text-[var(--text-muted)]">Progress</span>
                      <span className="text-right font-semibold">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm border border-[var(--border)] mr-1 align-middle" style={{ background: autoColor(hover) }} />
                        {fmt(hp, 1)}%
                      </span>
                    </div>
                    <div className="text-[var(--text-muted)] mt-1">
                      {hover.terakhir ? `Terakhir dipupuk ${hover.terakhir.split("-").reverse().join("/")}` : "Belum ada pemupukan di periode ini"}
                    </div>
                  </>
                )}
                {mode === "bebas" && hover.warna && (
                  <div className="mt-1 flex items-center gap-1 text-[var(--text-secondary)]">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm border border-[var(--border)]" style={{ background: hover.warna }} /> warna bebas {hover.warna}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 text-sm">
            <div className="text-xs font-semibold uppercase text-[var(--text-secondary)] mb-2">
              Total {estate ? ESTATE_LABEL[estate] : "AKSS"}
              {mode === "pruning" && pruning ? ` · pruning ${pruning.tahun}` : ""}
            </div>
            {mode === "pruning" ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">Target pokok</div>
                  <div className="font-semibold">{fmt(totP.target)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">Sudah pruning</div>
                  <div className="font-semibold">{fmt(totP.pkk)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">Ha pruning / luas</div>
                  <div className="font-semibold">
                    {fmt(totP.haP, 2)} / {fmt(totP.ha, 2)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">Progress</div>
                  <div className="font-semibold">{totP.target ? `${fmt((totP.pkk / totP.target) * 100, 2)}%` : "-"}</div>
                </div>
                <div className="col-span-2 text-[11px] text-[var(--text-muted)]">
                  {totP.belum} dari {scope.length} blok belum pruning di tahun ini
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Pokok</div>
                <div className="font-semibold">{fmt(tot.pkk)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Ha</div>
                <div className="font-semibold">{fmt(tot.ha, 2)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Pupuk (ton)</div>
                <div className="font-semibold">{fmt(tot.kg / 1000, 2)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Progress</div>
                <div className="font-semibold">{tot.pkk ? `${fmt((tot.kg / tot.pkk) * 100, 2)}%` : "-"}</div>
              </div>
            </div>
            )}
          </div>

          {mode !== "bebas" ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Legenda{editing ? " (bisa diubah)" : ""}</div>
              {legend.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="color" disabled={!editing} value={l.warna} onChange={(e) => setLegendItem(i, { warna: e.target.value })} className="w-9 h-8 rounded border border-[var(--border)] cursor-pointer disabled:cursor-default shrink-0" title={editing ? "Ganti warna" : l.warna} />
                  <div className="flex-1 min-w-0">
                    <input disabled={!editing} value={l.label} onChange={(e) => setLegendItem(i, { label: e.target.value })} className="w-full text-xs rounded border border-[var(--border)] px-2 py-1 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-[var(--text-primary)]" />
                    <div className="flex items-center gap-1 mt-0.5 text-[11px] text-[var(--text-muted)]">
                      mulai
                      <input
                        type="number"
                        min={0}
                        disabled={!editing}
                        value={l.dari}
                        onChange={(e) => setLegendItem(i, { dari: Number(e.target.value) })}
                        className="w-14 rounded border border-[var(--border)] px-1 py-0.5 text-[11px]"
                      />
                      % · {countOf(l)} blok
                    </div>
                  </div>
                  {editing && (
                    <button onClick={() => (setLegend((x) => x.filter((_, j) => j !== i)), setLegendDirty(true))} title="Hapus" className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <span className="inline-block w-9 h-4 rounded border border-[var(--border)]" style={{ background: NO_DATA }} />{" "}
                {mode === "pruning" ? "tidak ada di Rekap Pruning / estate lain" : "tidak ada di Master Blok / estate lain"}
              </div>
              {editing && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => (setLegend((x) => [...x, { id: 0, dari: 0, label: "Warna baru", warna: "#4a86e8" }]), setLegendDirty(true))}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]"
                >
                  + Tambah warna
                </button>
                <button
                  onClick={saveLegend}
                  disabled={!legendDirty || saving}
                  className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-40"
                >
                  <Save size={13} /> {saving ? "Menyimpan..." : "Simpan legenda"}
                </button>
              </div>
              )}
              {!editing && <LockNote canEdit={canEdit} />}
              <p className="text-[11px] text-[var(--text-muted)]">
                {mode === "pruning"
                  ? "Progress = pokok yang sudah pruning di tahun terpilih (Rekap Pruning) ÷ (Ha × SPH) × 100%, seperti di sheet mapping pruning."
                  : "Progress = pupuk NPK keluar ke blok (kg, Inventory Pupuk) ÷ jumlah pokok (PKK, Master Blok) × 100%, seperti di sheet."}
              </p>
            </div>
          ) : !editing ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Warna yang dipakai</div>
              {usedColors.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">Belum ada blok yang diwarnai.</p>
              ) : (
                usedColors.map(([w, n]) => (
                  <div key={w} className="flex items-center gap-2 text-xs">
                    <span className="inline-block w-9 h-5 rounded border border-[var(--border)]" style={{ background: w }} />
                    <span className="text-[var(--text-secondary)]">{w}</span>
                    <span className="ml-auto">{n} blok</span>
                  </div>
                ))
              )}
              <LockNote canEdit={canEdit} />
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 space-y-2">
              <div className="flex gap-1">
                {(
                  [
                    ["kuas", "Kuas", Paintbrush],
                    ["geser", "Geser peta", Hand],
                  ] as const
                ).map(([t, label, Icon]) => (
                  <button
                    key={t}
                    onClick={() => setTool(t)}
                    className={`flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md border ${
                      tool === t ? "border-[var(--accent-blue)] bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] font-medium" : "border-[var(--border)]"
                    }`}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
              <div className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Kuas warna</div>
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setPaint(s)}
                    title={s}
                    className={`w-7 h-7 rounded border ${paint === s ? "ring-2 ring-offset-1 ring-[var(--accent-blue)]" : "border-[var(--border)]"}`}
                    style={{ background: s }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="color" value={paint ?? "#ffffff"} onChange={(e) => setPaint(e.target.value)} className="w-9 h-8 rounded border border-[var(--border)] cursor-pointer" title="Warna lain" />
                <span className="text-xs text-[var(--text-secondary)] inline-flex items-center gap-1">
                  <Paintbrush size={13} /> {paint ?? "hapus warna"}
                </span>
                <button
                  onClick={() => setPaint(null)}
                  className={`ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${paint === null ? "border-[var(--accent-blue)] text-[var(--accent-blue)]" : "border-[var(--border)]"}`}
                >
                  <Eraser size={13} /> Penghapus
                </button>
              </div>
              <button onClick={clearAll} className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                Hapus semua warna bebas{estate ? ` ${ESTATE_LABEL[estate]}` : ""}
              </button>
              <p className="text-[11px] text-[var(--text-muted)]">Klik atau tarik di atas blok untuk mewarnai. Warna tersimpan otomatis dan terlihat oleh semua pengguna.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Why the map can't be changed right now.
function LockNote({ canEdit }: { canEdit: boolean }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-[var(--text-muted)] pt-1">
      <Lock size={12} className="shrink-0 mt-0.5" />
      {canEdit
        ? "Terkunci. Klik Buka Edit di atas untuk mengubah warna atau legenda."
        : "Hanya lihat. Untuk mengubah warna atau legenda, minta Super User mencentang Ubah Peta Blok di menu Pengguna."}
    </p>
  );
}
