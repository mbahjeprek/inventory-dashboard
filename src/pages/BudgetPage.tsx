import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SSF from "ssf";
import { AlertTriangle, Calculator, ChevronDown, Link2, ListChecks, Loader2, RotateCcw, Wrench, X, ZoomIn, ZoomOut } from "lucide-react";
import { api, errorText, type BudgetData, type BudgetEdit, type BudgetSheet, type BudgetStyle, type BudgetWorkbook } from "../lib/api";
import { Workbook, addr as addrOf, colLetter, isErr, parseAddr, parseInput, type CellDef, type Val } from "../lib/budgetEngine";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";

// Budgeting: an estate's budget workbook shown as its Excel file - the same sheets, columns, widths, merges, colours,
// borders and number formats - with every formula recalculated here (see budgetEngine). An account with Ubah Budgeting
// changes a cell (a number, text or =formula) and the whole workbook follows; each change is saved per cell with who and
// when, and can be put back. References to other Excel files are filled in once in "Data dari file lain".

const LINK_SHEET = "__LINK__";
const HEADER_H = 20;
// The file's font is Aptos (Excel's own); where it isn't installed Arial, as Google Sheets shows it.
const FONT = `Aptos, "Aptos Narrow", Arial, sans-serif`;
const ROWNUM_W = 40;

export function BudgetPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState<BudgetWorkbook[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .budgetList()
      .then((l) => {
        setList(l);
        if (!id && l.length === 1) navigate(`/budgeting/${l[0].id}`, { replace: true });
      })
      .catch((e) => setError(errorText(e, "Gagal memuat budget")));
  }, [id, navigate]);
  const wb = list?.find((w) => String(w.id) === id);
  if (error) return <p className="text-sm text-[var(--accent-red)]">{error}</p>;
  if (!list) return <p className="text-sm text-[var(--text-muted)]">Memuat...</p>;
  if (!wb)
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Budgeting</h1>
          <p className="text-sm text-[var(--text-secondary)]">Budget tahunan per estate, seperti file Excel-nya, dengan rumus yang dihitung otomatis</p>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Belum ada budget untuk estate Anda.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((w) => (
              <button key={w.id} onClick={() => navigate(`/budgeting/${w.id}`)} className="text-left p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent-blue)]">
                <div className="inline-flex items-center gap-2 font-medium text-[var(--text-primary)]">
                  <Calculator size={16} /> {w.judul}
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  Estate {w.estate} · {w.tahun}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  return <BudgetViewer key={wb.id} wbMeta={wb} />;
}

// ---- styles / formats ----
const BORDER: Record<string, string> = {
  thin: "1px solid",
  hair: "1px dotted",
  dotted: "1px dotted",
  dashed: "1px dashed",
  dashDot: "1px dashed",
  dashDotDot: "1px dashed",
  medium: "2px solid",
  mediumDashed: "2px dashed",
  mediumDashDot: "2px dashed",
  mediumDashDotDot: "2px dashed",
  slantDashDot: "2px dashed",
  thick: "3px solid",
  double: "3px double",
};
function cssOf(s: BudgetStyle | undefined): CSSProperties {
  const c: CSSProperties = {};
  if (!s) return c;
  if (s.b) c.fontWeight = 700;
  if (s.i) c.fontStyle = "italic";
  if (s.u || s.st) c.textDecoration = [s.u && "underline", s.st && "line-through"].filter(Boolean).join(" ");
  if (s.sz) c.fontSize = `${s.sz}pt`;
  if (s.fn) c.fontFamily = `"${s.fn}", ${FONT}`;
  if (s.fc) c.color = `#${s.fc}`;
  if (s.bg) c.backgroundColor = `#${s.bg}`;
  if (s.bd) {
    const side = { l: "borderLeft", r: "borderRight", t: "borderTop", b: "borderBottom" } as const;
    for (const [k, [st, col]] of Object.entries(s.bd) as [keyof typeof side, [string, string]][]) (c as Record<string, string>)[side[k]] = `${BORDER[st] ?? "1px solid"} #${col}`;
  }
  if (s.h) c.textAlign = s.h === "centerContinuous" || s.h === "center" ? "center" : s.h === "right" ? "right" : s.h === "justify" || s.h === "distributed" ? "justify" : s.h === "fill" ? "left" : "left";
  c.verticalAlign = s.v === "center" ? "middle" : s.v === "top" ? "top" : "bottom";
  if (s.w) c.whiteSpace = "pre-wrap";
  if (s.ind) c.paddingLeft = 3 + s.ind * 9;
  return c;
}
function fmt(v: Val, nf: string | undefined): string {
  if (v === null || v === undefined) return "";
  if (isErr(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    try {
      const s = SSF.format(nf || "General", v);
      // General: as many digits as Excel shows in a normal column
      if (!nf || nf === "General") return Math.abs(v) >= 1e11 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(4) : String(Math.round(v * 1e9) / 1e9);
      return s;
    } catch {
      return String(v);
    }
  }
  if (nf && nf.includes("@") && !nf.includes(";")) return v;
  return v;
}
const rawOf = (d: CellDef | undefined): string => (!d ? "" : d.f !== undefined ? `=${d.f}` : d.v === null || d.v === undefined ? "" : typeof d.v === "boolean" ? (d.v ? "TRUE" : "FALSE") : String(d.v));
const sameDef = (a: CellDef | undefined | null, b: CellDef | undefined | null) => rawOf(a ?? undefined) === rawOf(b ?? undefined);

// References to other Excel files in a formula, keyed as the engine reads them: "[4]GC0400!N26".
const EXT_RE = /'?(\[\d+\][^'!]*)'?!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g;
const extKeys = (f: string) => [...f.matchAll(EXT_RE)].map((m) => `${m[1]}!${m[2].replace(/\$/g, "")}`);

type LinkInfo = { key: string; uses: { sheet: string; addr: string; label: string }[] };

export function BudgetViewer({ wbMeta }: { wbMeta: BudgetWorkbook }) {
  const { user } = useAuth();
  const bisaUbah = can(user, "budget.edit");
  const [data, setData] = useState<BudgetData | null>(null);
  const [edits, setEdits] = useState<Map<string, BudgetEdit>>(new Map());
  const [error, setError] = useState("");
  const [active, setActive] = useState<string>("");
  const [version, setVersion] = useState(0);
  const [sel, setSel] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
  const [bar, setBar] = useState("");
  const [barEdit, setBarEdit] = useState(false);
  const [zoom, setZoom] = useState(() => {
    try {
      return Number(localStorage.getItem("budget-zoom")) || 0.9;
    } catch {
      return 0.9;
    }
  });
  const [panel, setPanel] = useState<null | "link" | "rusak" | "fix" | "riwayat">(null);
  const [simpan, setSimpan] = useState<"" | "menyimpan" | "tersimpan" | "gagal">("");
  const engine = useRef<Workbook | null>(null);
  const base = useRef<Map<string, CellDef>>(new Map());
  const antre = useRef<Map<string, { sheet: string; addr: string; isi: string | null }>>(new Map());
  const timer = useRef<number | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLInputElement>(null);

  // load the workbook and its changes, build the engine
  useEffect(() => {
    let stale = false;
    Promise.all([api.budgetData(wbMeta.id), api.budgetEdits(wbMeta.id)])
      .then(([d, e]) => {
        if (stale) return;
        const w = new Workbook();
        const b = new Map<string, CellDef>();
        for (const s of d.sheets) {
          const cells = new Map<string, CellDef>();
          for (const [a, c] of Object.entries(s.cells)) {
            if (c.f !== undefined) cells.set(a, { f: c.f });
            else if (c.v !== undefined && c.v !== null && c.v !== "") cells.set(a, { v: c.v });
            const def = cells.get(a);
            if (def) b.set(`${s.name}!${a}`, def);
          }
          w.addSheet({ name: s.name, maxr: s.maxr, maxc: s.maxc, cells });
        }
        const em = new Map<string, BudgetEdit>();
        for (const x of e) {
          em.set(`${x.sheet}!${x.addr}`, x);
          if (x.sheet === LINK_SHEET) {
            const v = x.isi === null ? null : parseInput(x.isi);
            if (v && v.v !== undefined) w.links.set(x.addr, v.v ?? null);
          } else if (w.sheets.has(x.sheet)) w.setCell(x.sheet, x.addr, x.isi === null ? (b.get(`${x.sheet}!${x.addr}`) ?? null) : parseInput(x.isi));
        }
        engine.current = w;
        base.current = b;
        setEdits(em);
        setData(d);
        setActive((cur) => cur || d.showOrder[0]);
      })
      .catch((err) => !stale && setError(errorText(err, "Gagal memuat budget")));
    return () => {
      stale = true;
    };
  }, [wbMeta.id]);

  const sheet = data?.sheets.find((s) => s.name === active);
  const sheetNames = useMemo(() => new Set(data?.sheets.map((s) => s.name)), [data]);

  // the links to other files and where they are used (with the row's label for context)
  const links = useMemo<LinkInfo[]>(() => {
    if (!data) return [];
    const m = new Map<string, LinkInfo>();
    for (const s of data.sheets)
      for (const [a, c] of Object.entries(s.cells)) {
        if (!c.f) continue;
        for (const k of extKeys(c.f)) {
          const p = parseAddr(a)!;
          let label = "";
          for (let col = 1; col <= Math.min(8, s.maxc) && !label; col++) {
            const v = s.cells[addrOf(p.r, col)]?.v;
            if (typeof v === "string" && /[A-Za-z]{2}/.test(v)) label = v.trim();
          }
          const e = m.get(k) ?? { key: k, uses: [] };
          e.uses.push({ sheet: s.name, addr: a, label });
          m.set(k, e);
        }
      }
    return [...m.values()].sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true }));
  }, [data]);
  const linkKosong = links.filter((l) => !engine.current?.links.has(l.key)).length;

  const def = engine.current?.sheets.get(active)?.cells.get(addrOf(sel.r, sel.c));
  useEffect(() => {
    if (!barEdit) setBar(rawOf(def));
  }, [def, barEdit, version, sel, active]);

  // ---- saving: changes are queued and sent together shortly after ----
  const flush = useCallback(async () => {
    const changes = [...antre.current.values()];
    if (!changes.length) return;
    antre.current.clear();
    setSimpan("menyimpan");
    try {
      await api.budgetSave(wbMeta.id, changes);
      setSimpan("tersimpan");
    } catch (e) {
      for (const c of changes) if (!antre.current.has(`${c.sheet}!${c.addr}`)) antre.current.set(`${c.sheet}!${c.addr}`, c);
      setSimpan("gagal");
      setError(errorText(e, "Perubahan gagal disimpan, akan dicoba lagi"));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 5000);
    }
  }, [wbMeta.id]);
  useEffect(() => {
    const kirim = () => {
      if (antre.current.size) void flush();
    };
    window.addEventListener("beforeunload", kirim);
    return () => {
      window.removeEventListener("beforeunload", kirim);
      kirim();
    };
  }, [flush]);
  const queue = (sheetName: string, a: string, isi: string | null) => {
    antre.current.set(`${sheetName}!${a}`, { sheet: sheetName, addr: a, isi });
    setEdits((m) => new Map(m).set(`${sheetName}!${a}`, { sheet: sheetName, addr: a, isi, nama: user?.nama ?? "", at: new Date().toISOString() }));
    setSimpan("menyimpan");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };

  const commit = (raw: string) => {
    const w = engine.current;
    if (!w || !sheet || !bisaUbah) return;
    const a = addrOf(sel.r, sel.c);
    const now = w.sheets.get(active)?.cells.get(a);
    const next = parseInput(raw);
    if (sameDef(now, next)) return;
    if (next?.f !== undefined) {
      const p = w.parsed(next.f);
      if (p instanceof Error) {
        setError(`Rumus ${raw} tidak bisa dibaca: ${p.message}`);
        return;
      }
    }
    setError("");
    const orig = base.current.get(`${active}!${a}`);
    w.setCell(active, a, next);
    w.invalidate();
    queue(active, a, sameDef(orig, next) ? null : raw.trim() === "" ? "" : raw.trim());
    setVersion((n) => n + 1);
  };
  const resetCell = () => {
    const w = engine.current;
    if (!w || !bisaUbah) return;
    const a = addrOf(sel.r, sel.c);
    w.setCell(active, a, base.current.get(`${active}!${a}`) ?? null);
    w.invalidate();
    queue(active, a, null);
    setVersion((n) => n + 1);
  };
  const setLink = (key: string, raw: string) => {
    const w = engine.current;
    if (!w || !bisaUbah) return;
    const d = parseInput(raw);
    if (!d || d.v === undefined) w.links.delete(key);
    else w.links.set(key, d.v);
    w.invalidate();
    queue(LINK_SHEET, key, d && d.v !== undefined ? raw.trim() : null);
    setVersion((n) => n + 1);
  };

  // ---- navigation ----
  const hiddenR = useMemo(() => new Set(sheet?.hr ?? []), [sheet]);
  const hiddenC = useMemo(() => new Set(sheet?.hc ?? []), [sheet]);
  const merges = useMemo(() => mergeMap(sheet), [sheet]);
  const go = (r: number, c: number) => {
    if (!sheet) return;
    r = Math.max(1, Math.min(sheet.maxr, r));
    c = Math.max(1, Math.min(sheet.maxc, c));
    const top = merges.cover.get(`${r},${c}`);
    if (top) [r, c] = top;
    setSel({ r, c });
    setBarEdit(false);
  };
  const move = (dr: number, dc: number) => {
    if (!sheet) return;
    let { r, c } = sel;
    const span = merges.span.get(`${r},${c}`);
    if (span) {
      if (dr > 0) r += span[0] - 1;
      if (dc > 0) c += span[1] - 1;
    }
    do {
      r += dr;
      c += dc;
    } while ((hiddenR.has(r) || hiddenC.has(c)) && r > 1 && c > 1 && r < sheet.maxr && c < sheet.maxc);
    go(r, c);
  };
  const openSheet = (name: string, cell?: string) => {
    setActive(name);
    const p = cell ? parseAddr(cell) : null;
    setSel(p ? { r: p.r, c: p.c } : { r: 1, c: 1 });
    setBarEdit(false);
    gridRef.current?.scrollTo({ top: 0, left: 0 });
  };
  const followLink = (l: string) => {
    const m = /^'?(.+?)'?!(\$?[A-Z]+\$?\d+)/.exec(l);
    if (m && sheetNames.has(m[1].replace(/''/g, "'"))) openSheet(m[1].replace(/''/g, "'"), m[2].replace(/\$/g, ""));
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowDown" || k === "Enter") (e.preventDefault(), move(1, 0));
    else if (k === "ArrowUp") (e.preventDefault(), move(-1, 0));
    else if (k === "ArrowRight" || k === "Tab") (e.preventDefault(), move(0, 1));
    else if (k === "ArrowLeft") (e.preventDefault(), move(0, -1));
    else if (k === "F2" && bisaUbah) (e.preventDefault(), setBarEdit(true), setTimeout(() => barRef.current?.focus(), 0));
    else if ((k === "Delete" || k === "Backspace") && bisaUbah) (e.preventDefault(), commit(""));
    else if (k.length === 1 && bisaUbah) {
      e.preventDefault();
      setBar(k);
      setBarEdit(true);
      setTimeout(() => {
        const el = barRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 0);
    }
  };

  // selection outline over the grid (the table isn't re-rendered for it)
  const [outline, setOutline] = useState<CSSProperties | null>(null);
  useEffect(() => {
    const td = gridRef.current?.querySelector<HTMLElement>(`[data-k="${sel.r},${sel.c}"]`);
    if (!td) return setOutline(null);
    setOutline({ left: td.offsetLeft, top: td.offsetTop, width: td.offsetWidth, height: td.offsetHeight });
  }, [sel, active, version, zoom, data]);
  useEffect(() => {
    try {
      localStorage.setItem("budget-zoom", String(zoom));
    } catch {
      // per-browser convenience
    }
  }, [zoom]);

  if (error && !data) return <p className="text-sm text-[var(--accent-red)]">{error}</p>;
  if (!data || !sheet || !engine.current) return <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Memuat budget...</p>;

  const w = engine.current;
  const selAddr = addrOf(sel.r, sel.c);
  const edit = edits.get(`${active}!${selAddr}`);
  const origDef = base.current.get(`${active}!${selAddr}`);
  const fix = data.fixes.find((f) => f.sheet === active && f.addr === selAddr);
  const selExt = def?.f ? extKeys(def.f) : [];
  const shown = data.showOrder.filter((n) => sheetNames.has(n));
  const lain = data.sheets.filter((s) => !s.show);

  return (
    <div className="flex flex-col gap-2 -mx-2 sm:mx-0" style={{ height: "calc(100vh - 96px)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] leading-tight">{wbMeta.judul}</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Seperti file Excel-nya; rumus dihitung otomatis{bisaUbah ? ". Klik sel lalu ketik angka atau =rumus, Enter untuk simpan." : " (hanya lihat)."}
          </p>
        </div>
        <button onClick={() => setPanel(panel === "link" ? null : "link")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border ${linkKosong ? "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]" : "border-[var(--border)] bg-white"}`}>
          <Link2 size={14} /> Data dari file lain {linkKosong ? `(${linkKosong} belum diisi)` : `(${links.length})`}
        </button>
        <button onClick={() => setPanel(panel === "rusak" ? null : "rusak")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border ${data.refRusak.length ? "border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)]" : "border-[var(--border)] bg-white"}`}>
          <AlertTriangle size={14} /> Rumus #REF! ({data.refRusak.length})
        </button>
        <button onClick={() => setPanel(panel === "fix" ? null : "fix")} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-white">
          <Wrench size={14} /> Diperbaiki otomatis ({data.fixes.length})
        </button>
        <button onClick={() => setPanel(panel === "riwayat" ? null : "riwayat")} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-white">
          <ListChecks size={14} /> Perubahan ({[...edits.values()].filter((x) => x.sheet !== LINK_SHEET).length})
        </button>
        <div className="inline-flex items-center rounded-md border border-[var(--border)] bg-white">
          <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} className="p-1.5" title="Perkecil">
            <ZoomOut size={14} />
          </button>
          <span className="text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(1.6, Math.round((z + 0.1) * 10) / 10))} className="p-1.5" title="Perbesar">
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* formula bar */}
      <div className="flex items-stretch gap-0 rounded-md border border-[var(--border)] bg-white text-sm">
        <div className="w-20 shrink-0 px-2 py-1 border-r border-[var(--border)] font-mono text-xs flex items-center">{selAddr}</div>
        <div className="px-2 flex items-center text-[var(--text-muted)] italic border-r border-[var(--border)]">fx</div>
        <input
          ref={barRef}
          value={bar}
          readOnly={!bisaUbah}
          onFocus={() => bisaUbah && setBarEdit(true)}
          onChange={(e) => setBar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(bar);
              setBarEdit(false);
              move(1, 0);
              gridRef.current?.focus();
            } else if (e.key === "Escape") {
              setBarEdit(false);
              setBar(rawOf(def));
              gridRef.current?.focus();
            } else if (e.key === "Tab") {
              e.preventDefault();
              commit(bar);
              setBarEdit(false);
              move(0, 1);
              gridRef.current?.focus();
            }
          }}
          onBlur={() => {
            if (barEdit && bar !== rawOf(def)) commit(bar);
            setBarEdit(false);
          }}
          className="flex-1 min-w-0 px-2 py-1 font-mono text-xs outline-none"
          placeholder={bisaUbah ? "isi angka, teks, atau =rumus" : ""}
        />
        <div className="px-2 flex items-center text-[11px] text-[var(--text-muted)] whitespace-nowrap">
          {simpan === "menyimpan" ? "menyimpan..." : simpan === "tersimpan" ? "tersimpan" : simpan === "gagal" ? <span className="text-[var(--accent-red)]">gagal simpan</span> : ""}
        </div>
      </div>
      {(edit && edit.sheet !== LINK_SHEET) || fix || selExt.length > 0 || error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] -mt-1">
          {error && <span className="text-[var(--accent-red)]">{error}</span>}
          {edit && (
            <span className="text-[var(--accent-blue)]">
              Diubah {edit.nama} · {new Date(edit.at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })} · isi file: <span className="font-mono">{rawOf(origDef) || "(kosong)"}</span>
              {bisaUbah && edit.isi !== null && (
                <button onClick={resetCell} className="ml-1.5 inline-flex items-center gap-0.5 underline">
                  <RotateCcw size={11} /> kembalikan
                </button>
              )}
            </span>
          )}
          {fix && (
            <span className="text-[var(--accent-green)]">
              Diperbaiki otomatis dari <span className="font-mono">{fix.dari}</span>: {fix.alasan}
            </span>
          )}
          {selExt.length > 0 && (
            <span className="text-[var(--accent-amber)]">
              Memakai data file lain: {selExt.map((k) => `${k}${w.links.has(k) ? "" : " (belum diisi)"}`).join(", ")}{" "}
              <button onClick={() => setPanel("link")} className="underline">
                isi
              </button>
            </span>
          )}
        </div>
      ) : null}

      <div className="relative flex-1 min-h-0 flex gap-2">
        <div ref={gridRef} tabIndex={0} onKeyDown={onGridKey} className="relative flex-1 min-w-0 overflow-auto rounded-md border border-[var(--border)] bg-white outline-none">
          <div style={{ zoom, position: "relative", width: "max-content" }}>
            <Grid sheet={sheet} styles={data.styles} engine={w} version={version} merges={merges} edits={edits} onSelect={go} onLink={followLink} />
            {outline && <div className="absolute pointer-events-none border-2 border-[#1a73e8] z-10" style={outline} />}
          </div>
        </div>
        {panel && (
          <div className="w-[380px] max-w-[90vw] shrink-0 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-sm">
            <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-card)]">
              <b>{panel === "link" ? "Data dari file lain" : panel === "rusak" ? "Rumus dengan #REF!" : panel === "fix" ? "Diperbaiki otomatis" : "Perubahan"}</b>
              <button onClick={() => setPanel(null)} className="p-1 rounded hover:bg-[#f1f5f9]">
                <X size={15} />
              </button>
            </div>
            {panel === "link" && (
              <div className="p-3 space-y-3">
                <p className="text-xs text-[var(--text-secondary)]">
                  Rumus-rumus ini di Excel mengambil angka dari file Excel lain (GC, produksi, harga, unit...) yang tidak ikut di file ini, jadi di Excel tampil #REF! / #ERROR!.
                  Isi angkanya sekali di sini; semua rumus yang memakainya langsung terhitung. Kosong = dihitung 0.
                </p>
                {links.map((l) => (
                  <div key={l.key} className="rounded-md border border-[var(--border)] p-2 space-y-1">
                    <div className="font-mono text-xs break-all">{l.key}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Dipakai di{" "}
                      {l.uses.slice(0, 4).map((u, i) => (
                        <span key={i}>
                          {i > 0 && ", "}
                          <button onClick={() => openSheet(u.sheet, u.addr)} className="underline hover:text-[var(--accent-blue)]">
                            {u.sheet}!{u.addr}
                          </button>
                          {u.label && ` (${u.label.slice(0, 40)})`}
                        </span>
                      ))}
                      {l.uses.length > 4 && ` +${l.uses.length - 4} lagi`}
                    </div>
                    <LinkInput value={w.links.get(l.key)} disabled={!bisaUbah} onSave={(raw) => setLink(l.key, raw)} />
                  </div>
                ))}
              </div>
            )}
            {panel === "rusak" && (
              <div className="p-3 space-y-2">
                <p className="text-xs text-[var(--text-secondary)]">
                  Rumus ini menunjuk sel / kolom yang sudah dihapus di Excel, jadi tidak bisa ditebak otomatis. Buka selnya, lalu ketik rumus yang benar.
                </p>
                {data.refRusak.map((r) => {
                  const now = w.sheets.get(r.sheet)?.cells.get(r.addr);
                  const beres = !rawOf(now).includes("#REF!");
                  return (
                    <button key={`${r.sheet}!${r.addr}`} onClick={() => openSheet(r.sheet, r.addr)} className="block w-full text-left rounded px-2 py-1 hover:bg-[#f1f5f9]">
                      <span className={`text-xs font-medium ${beres ? "text-[var(--accent-green)] line-through" : ""}`}>
                        {r.sheet}!{r.addr}
                      </span>{" "}
                      <span className="font-mono text-[11px] text-[var(--text-muted)] break-all">{r.f}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {panel === "fix" && (
              <div className="p-3 space-y-2">
                {data.fixes.map((f) => (
                  <button key={`${f.sheet}!${f.addr}`} onClick={() => openSheet(f.sheet, f.addr)} className="block w-full text-left rounded px-2 py-1 hover:bg-[#f1f5f9]">
                    <div className="text-xs font-medium">
                      {f.sheet}!{f.addr}: <span className="font-mono">{f.dari}</span> → <span className="font-mono text-[var(--accent-green)]">{f.jadi}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">{f.alasan}</div>
                  </button>
                ))}
              </div>
            )}
            {panel === "riwayat" && (
              <div className="p-3 space-y-1">
                {[...edits.values()]
                  .filter((x) => x.sheet !== LINK_SHEET)
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((x) => (
                    <button key={`${x.sheet}!${x.addr}`} onClick={() => openSheet(x.sheet, x.addr)} className="block w-full text-left rounded px-2 py-1 hover:bg-[#f1f5f9]">
                      <div className="text-xs">
                        <b>
                          {x.sheet}!{x.addr}
                        </b>{" "}
                        <span className="font-mono">{x.isi === null ? "(dikembalikan)" : x.isi}</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {x.nama} · {new Date(x.at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </button>
                  ))}
                {![...edits.values()].some((x) => x.sheet !== LINK_SHEET) && <p className="text-xs text-[var(--text-muted)]">Belum ada perubahan.</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* sheet tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {shown.map((n) => {
          const t = data.sheets.find((s) => s.name === n)?.tab;
          return (
            <button
              key={n}
              onClick={() => openSheet(n)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-b-md border border-t-0 whitespace-nowrap ${n === active ? "bg-white font-semibold text-[var(--accent-blue)] border-[var(--accent-blue)]" : "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-secondary)]"}`}
              style={t ? { boxShadow: `inset 0 -3px 0 #${t}` } : undefined}
            >
              {n}
            </button>
          );
        })}
        <label className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border border-[var(--border)] bg-white" title="Sheet yang dipakai rumus-rumus di atas">
          <select value={sheet.show ? "" : active} onChange={(e) => e.target.value && openSheet(e.target.value)} className="bg-transparent outline-none text-xs">
            <option value="">Sheet pendukung ({lain.length})</option>
            {lain.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {s.hidden ? " (tersembunyi)" : ""}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="pointer-events-none -ml-4 opacity-0" />
        </label>
      </div>
    </div>
  );
}

function LinkInput({ value, disabled, onSave }: { value: Val | undefined; disabled: boolean; onSave: (raw: string) => void }) {
  const awal = value === undefined || value === null ? "" : isErr(value) ? value.code : String(value);
  const [v, setV] = useState(awal);
  useEffect(() => setV(awal), [awal]);
  return (
    <input
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== awal && onSave(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="belum diisi (dihitung 0)"
      className={`w-full text-sm rounded border px-2 py-1 ${v.trim() ? "border-[var(--border)]" : "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)]"}`}
    />
  );
}

// Merged areas: the top-left cell's span, and every other cell of it pointing to its top-left.
function mergeMap(sheet: BudgetSheet | undefined) {
  const span = new Map<string, [number, number]>();
  const cover = new Map<string, [number, number]>();
  for (const m of sheet?.merges ?? []) {
    const [a, b] = m.split(":");
    const p = parseAddr(a),
      q = parseAddr(b ?? a);
    if (!p || !q) continue;
    span.set(`${p.r},${p.c}`, [q.r - p.r + 1, q.c - p.c + 1]);
    for (let r = p.r; r <= q.r; r++) for (let c = p.c; c <= q.c; c++) if (r !== p.r || c !== p.c) cover.set(`${r},${c}`, [p.r, p.c]);
  }
  return { span, cover };
}

const Grid = memo(function Grid({
  sheet,
  styles,
  engine,
  version,
  merges,
  edits,
  onSelect,
  onLink,
}: {
  sheet: BudgetSheet;
  styles: BudgetStyle[];
  engine: Workbook;
  version: number;
  merges: ReturnType<typeof mergeMap>;
  edits: Map<string, BudgetEdit>;
  onSelect: (r: number, c: number) => void;
  onLink: (l: string) => void;
}) {
  void version;
  const css = useMemo(() => styles.map(cssOf), [styles]);
  const hr = new Set(sheet.hr);
  const hc = new Set(sheet.hc);
  const cols: number[] = [];
  for (let c = 1; c <= sheet.maxc; c++) if (!hc.has(c)) cols.push(c);
  const rows: number[] = [];
  for (let r = 1; r <= sheet.maxr; r++) if (!hr.has(r)) rows.push(r);
  const heightOf = (r: number) => sheet.rowh[r] ?? sheet.defh;
  // image positions: sum of the widths / heights before their anchor cell
  const xOf = (c0: number) => ROWNUM_W + cols.filter((c) => c <= c0).reduce((s, c) => s + sheet.cols[c - 1], 0);
  const yOf = (r0: number) => HEADER_H + rows.filter((r) => r <= r0).reduce((s, r) => s + heightOf(r), 0);
  const visibleIn = (from: number, n: number, hidden: Set<number>) => {
    let k = 0;
    for (let i = from; i < from + n; i++) if (!hidden.has(i)) k++;
    return k;
  };
  const ext = /'?\[\d+\][^'!]*'?!/;
  return (
    <>
      <table
        className="budget-grid"
        style={{ borderCollapse: "collapse", tableLayout: "fixed", width: ROWNUM_W + cols.reduce((s, c) => s + sheet.cols[c - 1], 0), fontFamily: FONT, fontSize: "11pt", color: "#000" }}
      >
        <colgroup>
          <col style={{ width: ROWNUM_W }} />
          {cols.map((c) => (
            <col key={c} style={{ width: sheet.cols[c - 1] }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: HEADER_H }}>
            <th className="sticky top-0 left-0 z-20 bg-[#f1f5f9] border border-[#d5dde6]" />
            {cols.map((c) => (
              <th key={c} className="sticky top-0 z-10 bg-[#f1f5f9] border border-[#d5dde6] text-[10px] font-normal text-[#5b6b7c]">
                {colLetter(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r} style={{ height: heightOf(r) }}>
              <td className="sticky left-0 z-10 bg-[#f1f5f9] border border-[#d5dde6] text-[10px] text-center text-[#5b6b7c]">{r}</td>
              {cols.map((c) => {
                const k = `${r},${c}`;
                if (merges.cover.has(k)) return null;
                const a = addrOf(r, c);
                const cell = sheet.cells[a];
                const span = merges.span.get(k);
                const st = cell?.s !== undefined ? styles[cell.s] : undefined;
                const def = engine.sheets.get(sheet.name)?.cells.get(a);
                const v = def ? engine.value(sheet.name, r, c) : null;
                const txt = fmt(v, st?.nf);
                const isNum = typeof v === "number";
                const style: CSSProperties = {
                  ...css[cell?.s ?? -1],
                  padding: "0 3px",
                  overflow: st?.w ? "hidden" : "visible",
                  whiteSpace: st?.w ? "pre-wrap" : "pre",
                  textAlign: css[cell?.s ?? -1]?.textAlign ?? (isNum ? "right" : typeof v === "boolean" || isErr(v) ? "center" : "left"),
                  maxHeight: heightOf(r),
                  lineHeight: 1.15,
                  cursor: cell?.l ? "pointer" : "cell",
                };
                if (cell?.l) Object.assign(style, { color: "#1155cc", textDecoration: "underline" });
                const edited = edits.has(`${sheet.name}!${a}`) && edits.get(`${sheet.name}!${a}`)!.isi !== null;
                const pakaiLink = def?.f !== undefined && ext.test(def.f);
                return (
                  <td
                    key={c}
                    data-k={k}
                    rowSpan={span ? visibleIn(r, span[0], hr) : undefined}
                    colSpan={span ? visibleIn(c, span[1], hc) : undefined}
                    style={style}
                    title={sheet.notes[a]}
                    className={`${edited ? "bg-edited" : ""} ${pakaiLink ? "bg-ext" : ""}`}
                    onMouseDown={() => onSelect(r, c)}
                    onClick={() => cell?.l && onLink(cell.l)}
                  >
                    {txt}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.imgs.map((im, i) => (
        <img key={i} src={im.src} alt="" className="absolute pointer-events-none" style={{ left: xOf(im.c) + im.dx, top: yOf(im.r) + im.dy, width: im.w, height: im.h }} />
      ))}
    </>
  );
});
