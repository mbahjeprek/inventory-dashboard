import { Fragment, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Pencil, Save, Search, X } from "lucide-react";
import { api, errorText, type PruningRekapBaris, type PruningRekapData } from "../lib/api";
import { BULAN_SHEET, ESTATE_SHEET, TOTAL_DARI, hitung, ringkasan, type Hitung, type Kelompok } from "../lib/pruningRekap";

// Kebun > Pruning > Rekap per Blok: the sheet "AKSS - BLOCK DETAIL" as it was - the same columns, rows,
// bottom totals and summaries, and an Excel file in the same layout (formulas in lib/pruningRekap.ts).

const ESTATE_LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };
// The sheet's number formats: "-" for zero, (n) for a negative.
const num = (n: number | null | undefined, d = 0) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const r = Math.round(n * 10 ** d) / 10 ** d;
  if (r === 0) return "-";
  const s = Math.abs(r).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return r < 0 ? `(${s})` : s;
};
const pct = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? "-" : `${(n * 100).toFixed(d)}%`);
const inputCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const th = "px-1.5 py-1 border border-[#c7d3c0] font-semibold whitespace-nowrap";
const td = "px-1.5 py-0.5 border border-[#e2e8f0] whitespace-nowrap";

type Tampil = "semua" | "tutup" | number;

export function PruningRekapSheet({ estates, canEdit, version, onChanged }: { estates: string[]; canEdit: boolean; version: number; onChanged: () => void }) {
  const [data, setData] = useState<PruningRekapData | null>(null);
  const [error, setError] = useState("");
  const [estate, setEstate] = useState("");
  const [search, setSearch] = useState("");
  const [tahun, setTahun] = useState<number | null>(null);
  const [tampil, setTampil] = useState<Tampil>("semua");
  const [edit, setEdit] = useState<PruningRekapBaris | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setData(null);
    api
      .pruningRekap(estate)
      .then(setData)
      .catch((e) => setError(errorText(e, "Gagal memuat rekap")));
  }, [estate, version]);

  const th_ = tahun ?? data?.sekarang ?? new Date().getFullYear();
  const q = search.trim().toUpperCase();
  const rows = useMemo(() => (data?.baris ?? []).filter((b) => !q || b.blok.toUpperCase().includes(q) || b.divisi.toUpperCase().includes(q)), [data, q]);
  const sum = useMemo(() => (data ? ringkasan(data, rows, th_) : null), [data, rows, th_]);
  const years = !sum ? [] : tampil === "semua" ? sum.years : tampil === "tutup" ? [] : [tampil];

  const excel = async () => {
    if (!data || !sum) return;
    setBusy(true);
    try {
      await exportRekapExcel(data, rows, th_);
    } catch (e) {
      setError(errorText(e, "Gagal membuat file Excel"));
    } finally {
      setBusy(false);
    }
  };

  if (!data || !sum) return <p className="p-4 text-sm text-[var(--text-muted)]">{error || "Memuat rekap..."}</p>;
  const h = (b: PruningRekapBaris) => hitung(b, th_, data.sekarang);
  const s = sum.semua;
  const area = s.pkk;
  const monthCells = (bulan: Record<string, [number, number]>, key: string) =>
    years.flatMap((y) =>
      BULAN_SHEET.map((_, i) => {
        const [p, x] = bulan[`${y}-${String(i + 1).padStart(2, "0")}`] ?? [0, 0];
        return (
          <Fragment key={`${key}-${y}-${i}`}>
            <td className={`${td} text-right`}>{num(p)}</td>
            <td className={`${td} text-right text-[var(--text-secondary)]`}>{num(x, 2)}</td>
          </Fragment>
        );
      })
    );
  const totalCells = (x: { total: number; selisih: number | null; pct: number | null; haTotal: number; pctHa: number | null; totalHa: number | null; tahunPkk: number; tahunPct: number | null; tahunHa: number; tahunPctHa: number | null }) => (
    <>
      <td className={`${td} text-right font-semibold bg-[#f6faf3]`}>{num(x.total)}</td>
      <td className={`${td} text-right bg-[#f6faf3]`}>{x.selisih === null ? "" : num(x.selisih)}</td>
      <td className={`${td} text-right bg-[#f6faf3]`}>{pct(x.pct)}</td>
      <td className={`${td} text-right bg-[#f6faf3]`}>{num(x.haTotal, 2)}</td>
      <td className={`${td} text-right bg-[#f6faf3]`}>{pct(x.pctHa)}</td>
      <td className={`${td} text-right bg-[#eef6ff]`}>{x.totalHa === null ? "" : num(x.totalHa, 2)}</td>
      <td className={`${td} text-right font-semibold bg-[#fff8e6]`}>{num(x.tahunPkk)}</td>
      <td className={`${td} text-right bg-[#fff8e6]`}>{pct(x.tahunPct, 2)}</td>
      <td className={`${td} text-right bg-[#fff8e6]`}>{num(x.tahunHa, 2)}</td>
      <td className={`${td} text-right bg-[#fff8e6]`}>{pct(x.tahunPctHa, 2)}</td>
    </>
  );
  const kelompokTotals = (k: Kelompok) => ({
    total: k.total,
    selisih: k.total - k.pkk,
    pct: k.pkk ? k.total / k.pkk : null,
    haTotal: k.haTotal,
    pctHa: k.ha ? k.haTotal / k.ha : null,
    totalHa: k.totalHa,
    tahunPkk: k.tahunPkk,
    tahunPct: k.pkk ? k.tahunPkk / k.pkk : null,
    tahunHa: k.tahunHa,
    tahunPctHa: k.ha ? k.tahunHa / k.ha : null,
  });
  const headCols = (
    <>
      <th rowSpan={3} className={th}>ESTATE</th>
      <th rowSpan={3} className={th}>DIVISI</th>
      <th rowSpan={3} className={th}>Blok</th>
      <th rowSpan={3} className={th}>Planting Material</th>
      <th rowSpan={3} className={th}>Tahun Tanam</th>
      <th rowSpan={3} className={th}>Ha</th>
      <th rowSpan={3} className={th}>SPH</th>
      <th rowSpan={3} className={th}>PKK</th>
      <th rowSpan={3} className={th}>Kondisi Pokok</th>
      <th rowSpan={3} className={th}>Field Number</th>
    </>
  );
  const totalHead = (
    <>
      <th colSpan={5} className={`${th} bg-[#e6f2dc]`}>TOTAL KESELURUHAN</th>
      <th rowSpan={3} className={`${th} bg-[#dbeafe]`}>TOTAL HA</th>
      <th colSpan={4} className={`${th} bg-[#fdefc8]`}>TOTAL/TAHUN {th_}</th>
    </>
  );
  const totalSub = ["PKK", "+/-", "%", "HA", "%"].map((l, i) => <th key={`t${i}`} rowSpan={2} className={`${th} bg-[#e6f2dc]`}>{l}</th>);
  const tahunSub = ["PKK", "%", "HA", "%"].map((l, i) => <th key={`y${i}`} rowSpan={2} className={`${th} bg-[#fdefc8]`}>{l}</th>);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <select value={estate} onChange={(e) => setEstate(e.target.value)} className={inputCls} aria-label="Estate">
          <option value="">Semua estate</option>
          {estates.map((e) => (
            <option key={e} value={e}>
              {ESTATE_LABEL[e] ?? e}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari blok / divisi" className={`${inputCls} pl-8 w-44`} />
        </div>
        <select
          value={String(tampil)}
          onChange={(e) => setTampil(e.target.value === "semua" || e.target.value === "tutup" ? (e.target.value as Tampil) : Number(e.target.value))}
          className={inputCls}
          aria-label="Kolom bulan"
          title="Kolom bulan yang ditampilkan di layar (Excel selalu lengkap)"
        >
          <option value="semua">
            Bulan: semua tahun ({data.tahunAwal}–{data.tahunAkhir})
          </option>
          {sum.years
            .slice()
            .reverse()
            .map((y) => (
              <option key={y} value={y}>
                Bulan: {y} saja
              </option>
            ))}
          <option value="tutup">Bulan: sembunyikan</option>
        </select>
        <select value={th_} onChange={(e) => setTahun(Number(e.target.value))} className={inputCls} aria-label="TOTAL/TAHUN">
          {sum.years
            .slice()
            .reverse()
            .map((y) => (
              <option key={y} value={y}>
                TOTAL/TAHUN {y}
              </option>
            ))}
        </select>
        <button onClick={excel} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[#f1f5f9] disabled:opacity-50">
          <FileSpreadsheet size={16} className="text-[var(--accent-green)]" /> {busy ? "Membuat..." : "Excel (format sheet)"}
        </button>
      </div>
      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-auto max-h-[75vh]">
        <table className="text-[11px] border-collapse">
          <thead className="sticky top-0 z-10 bg-[#eef5e9] text-[#1f3d12]">
            <tr>
              {headCols}
              {years.map((y) => (
                <th key={y} colSpan={24} className={th}>
                  {y}
                </th>
              ))}
              {totalHead}
            </tr>
            <tr>
              {years.flatMap((y) =>
                BULAN_SHEET.map((m) => (
                  <th key={`${y}-${m}`} colSpan={2} className={th}>
                    {m}
                  </th>
                ))
              )}
              {totalSub}
              {tahunSub}
            </tr>
            <tr>
              {years.flatMap((y) =>
                BULAN_SHEET.flatMap((m) => [
                  <th key={`${y}-${m}-p`} className={th}>PKK</th>,
                  <th key={`${y}-${m}-h`} className={th}>HA</th>,
                ])
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const x: Hitung = h(b);
              return (
                <tr key={b.id} className="hover:bg-[#f8fafc]">
                  <td className={td}>{ESTATE_SHEET[b.estate] ?? b.estate}</td>
                  <td className={td}>{b.divisi}</td>
                  <td className={`${td} font-semibold`}>
                    <span className="inline-flex items-center gap-1">
                      {b.blok}
                      {canEdit && (
                        <button onClick={() => setEdit(b)} title="Ubah data baris (Ha, SPH, tahun tanam ...)" className="text-[var(--text-muted)] hover:text-[var(--accent-blue)]">
                          <Pencil size={10} />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className={td}>{b.planting_material}</td>
                  <td className={`${td} text-center`}>{b.tahun_tanam ?? ""}</td>
                  <td className={`${td} text-right`}>{num(b.ha, 2)}</td>
                  <td className={`${td} text-right`}>{num(b.sph)}</td>
                  <td className={`${td} text-right`}>{num(b.pkk)}</td>
                  <td className={td}>{b.kondisi}</td>
                  <td className={td}>{b.field_number}</td>
                  {monthCells(b.bulan, String(b.id))}
                  {totalCells(x)}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="font-semibold">
            <tr className="bg-[#f6faf3]">
              <td className={td} colSpan={5}>
                Total keseluruhan pruning
              </td>
              <td className={`${td} text-right`} />
              <td className={td} />
              <td className={td} />
              <td className={td} colSpan={2} />
              {monthCells(s.bulan, "tot")}
              {totalCells({ ...kelompokTotals(s), selisih: null, pct: area ? s.total / area : null })}
            </tr>
            <tr className="bg-[#f8fafc]">
              <td className={td} colSpan={5}>
                Total keseluruhan area
              </td>
              <td className={`${td} text-right`}>{num(s.ha, 2)}</td>
              <td className={td} />
              <td className={`${td} text-right`}>{num(area)}</td>
              <td className={td} colSpan={2 + years.length * 24} />
              {totalCells({ total: area, selisih: null, pct: 1, haTotal: s.ha, pctHa: 1, totalHa: null, tahunPkk: area, tahunPct: 1, tahunHa: s.ha, tahunPctHa: 1 })}
            </tr>
            <tr className="bg-[#fff5f5]">
              <td className={td} colSpan={5}>
                Total belum pruning
              </td>
              <td className={td} colSpan={5 + years.length * 24} />
              {totalCells({
                total: area - s.total,
                selisih: null,
                pct: area ? (area - s.total) / area : null,
                haTotal: s.ha - s.haTotal,
                pctHa: s.ha ? (s.ha - s.haTotal) / s.ha : null,
                totalHa: null,
                tahunPkk: area - s.tahunPkk,
                tahunPct: area ? (area - s.tahunPkk) / area : null,
                tahunHa: s.ha - s.tahunHa,
                tahunPctHa: s.ha ? (s.ha - s.tahunHa) / s.ha : null,
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {(
          [
            ["Per Divisi", sum.perDivisi],
            ["Per Estate", sum.perEstate],
          ] as const
        ).map(([judul, list]) => (
          <div key={judul} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-auto">
            <div className="px-3 py-2 text-xs font-semibold uppercase text-[var(--text-secondary)] border-b border-[var(--border)]">{judul}</div>
            <table className="text-[11px] border-collapse w-full">
              <thead className="bg-[#eef5e9] text-[#1f3d12]">
                <tr>
                  <th className={th}>ESTATE</th>
                  <th className={th}>{judul === "Per Divisi" ? "DIVISI" : ""}</th>
                  <th className={th}>Ha</th>
                  <th className={th}>SPH</th>
                  <th className={th}>PKK</th>
                  <th className={`${th} bg-[#e6f2dc]`}>TOTAL PKK</th>
                  <th className={`${th} bg-[#e6f2dc]`}>%</th>
                  <th className={`${th} bg-[#e6f2dc]`}>HA</th>
                  <th className={`${th} bg-[#e6f2dc]`}>%</th>
                  <th className={`${th} bg-[#fdefc8]`}>{th_} PKK</th>
                  <th className={`${th} bg-[#fdefc8]`}>%</th>
                </tr>
              </thead>
              <tbody>
                {list.map((k) => {
                  const t = kelompokTotals(k);
                  return (
                    <tr key={`${k.estate}-${k.divisi}`}>
                      <td className={td}>{judul === "Per Estate" ? "ESTATE" : k.estate}</td>
                      <td className={td}>{judul === "Per Estate" ? `${k.estate}${k.divisi ? ` ${k.divisi}` : ""}` : k.divisi}</td>
                      <td className={`${td} text-right`}>{num(k.ha, 2)}</td>
                      <td className={`${td} text-right`}>{num(k.sph)}</td>
                      <td className={`${td} text-right`}>{num(k.pkk)}</td>
                      <td className={`${td} text-right`}>{num(k.total)}</td>
                      <td className={`${td} text-right`}>{pct(t.pct)}</td>
                      <td className={`${td} text-right`}>{num(k.haTotal, 2)}</td>
                      <td className={`${td} text-right`}>{pct(t.pctHa)}</td>
                      <td className={`${td} text-right`}>{num(k.tahunPkk)}</td>
                      <td className={`${td} text-right`}>{pct(t.tahunPct, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
        Rumus seperti sheet: PKK = Ha × SPH · TOTAL KESELURUHAN PKK = pokok pruning sejak {TOTAL_DARI}, +/- = TOTAL − PKK, % = TOTAL ÷ PKK · HA = Ha pruning {TOTAL_DARI}–{data.sekarang - 1}
        (tahun berjalan ada di TOTAL/TAHUN), % = HA ÷ Ha · TOTAL HA = yang lebih kecil dari HA dan Ha · TOTAL/TAHUN: PKK tahun itu, % = PKK ÷ (Ha × SPH), HA = PKK ÷ SPH. Ringkasan per estate = divisi A–C seperti di
        sheet; PLASMA tampil di baris sendiri.
      </p>

      {edit && (
        <EditBaris
          b={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function EditBaris({ b, onClose, onSaved }: { b: PruningRekapBaris; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    divisi: b.divisi,
    planting_material: b.planting_material,
    tahun_tanam: b.tahun_tanam === null ? "" : String(b.tahun_tanam),
    ha: b.ha === null ? "" : String(b.ha),
    sph: b.sph === null ? "" : String(Math.round(b.sph * 100) / 100),
    kondisi: b.kondisi,
    field_number: b.field_number,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.pruningBarisUpdate(b.id, {
        divisi: f.divisi,
        planting_material: f.planting_material,
        tahun_tanam: f.tahun_tanam === "" ? null : Number(f.tahun_tanam),
        ha: f.ha === "" ? null : Number(f.ha),
        sph: f.sph === "" ? null : Number(f.sph),
        kondisi: f.kondisi,
        field_number: f.field_number,
      });
      onSaved();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  const field = (label: string, key: keyof typeof f, type = "text") => (
    <label className="block text-xs text-[var(--text-secondary)] space-y-1">
      <span className="block">{label}</span>
      <input type={type} step="any" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={`${inputCls} w-full`} />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-[var(--bg-card)] shadow-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Baris rekap · {ESTATE_SHEET[b.estate] ?? b.estate} {b.blok}
          </h2>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("Divisi", "divisi")}
          {field("Planting Material", "planting_material")}
          {field("Tahun Tanam", "tahun_tanam", "number")}
          {field("Kondisi Pokok", "kondisi")}
          {field("Ha", "ha", "number")}
          {field("SPH", "sph", "number")}
          {field("Field Number", "field_number")}
          <div className="text-xs text-[var(--text-secondary)] self-end pb-2">
            PKK baru: <b>{f.ha && f.sph ? Math.round(Number(f.ha) * Number(f.sph)).toLocaleString("id-ID") : "-"}</b>
          </div>
        </div>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
            Batal
          </button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50">
            <Save size={15} /> {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// The Excel file in the sheet's layout: the title rows, the three header rows (year / month / PKK HA),
// a row per blok, the three total rows, then Per Divisi and Per Estate.
async function exportRekapExcel(data: PruningRekapData, rows: PruningRekapBaris[], tahun: number) {
  const { default: ExcelJS } = await import("exceljs");
  const sum = ringkasan(data, rows, tahun);
  const years = sum.years;
  // Sums of decimals rounded the way the sheet shows them (no 344.04999...).
  const rd = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BLOCK DETAIL", { views: [{ state: "frozen", xSplit: 3, ySplit: 7 }] });
  const fixed = ["ESTATE", "DIVISI", "Blok", "Planting Material", "Tahun Tanam", "Ha", "SPH", "PKK", "Kondisi Pokok", "Field Number"];
  const firstTotal = fixed.length + years.length * 24 + 1; // 1-based column of TOTAL KESELURUHAN PKK
  const INT = '#,##0;(#,##0);"-"';
  const DEC = '#,##0.00;(#,##0.00);"-"';
  ws.getCell(1, 1).value = "PT BAROKAH AGRO PERKASA";
  ws.getCell(2, 1).value = "BLOCK DETAIL";
  ws.getCell(4, 1).value = "AKSS - BLOCK DETAIL";
  ws.getCell(4, firstTotal + 6).value = `TAHUN ${tahun}`;
  [1, 2, 4].forEach((r) => (ws.getRow(r).font = { bold: true, size: r === 1 ? 13 : 11 }));
  fixed.forEach((l, i) => {
    ws.getCell(5, i + 1).value = l;
    ws.mergeCells(5, i + 1, 7, i + 1);
  });
  years.forEach((y, yi) => {
    const c0 = fixed.length + 1 + yi * 24;
    ws.getCell(5, c0).value = y;
    ws.mergeCells(5, c0, 5, c0 + 23);
    BULAN_SHEET.forEach((m, mi) => {
      ws.getCell(6, c0 + mi * 2).value = m;
      ws.mergeCells(6, c0 + mi * 2, 6, c0 + mi * 2 + 1);
      ws.getCell(7, c0 + mi * 2).value = "PKK";
      ws.getCell(7, c0 + mi * 2 + 1).value = "HA";
    });
  });
  ws.getCell(5, firstTotal).value = "TOTAL KESELURUHAN";
  ws.mergeCells(5, firstTotal, 5, firstTotal + 4);
  ["PKK", "", "%", "HA", "%"].forEach((l, i) => (ws.getCell(7, firstTotal + i).value = l));
  ws.getCell(5, firstTotal + 5).value = "TOTAL HA";
  ws.mergeCells(5, firstTotal + 5, 7, firstTotal + 5);
  ws.getCell(5, firstTotal + 6).value = "TOTAL/TAHUN";
  ws.mergeCells(5, firstTotal + 6, 5, firstTotal + 9);
  ["PKK", "%", "HA", "%"].forEach((l, i) => (ws.getCell(7, firstTotal + 6 + i).value = l));
  for (let r = 5; r <= 7; r++)
    ws.getRow(r).eachCell((c) => {
      c.font = { bold: true };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });

  const monthVals = (bulan: Record<string, [number, number]>) =>
    years.flatMap((y) => BULAN_SHEET.flatMap((_, i) => bulan[`${y}-${String(i + 1).padStart(2, "0")}`] ?? [0, 0]));
  const fmtRow = (row: import("exceljs").Row, pctCols: number[], pct2Cols: number[]) => {
    row.eachCell({ includeEmpty: true }, (c, n) => {
      if (n === 6 || (n > fixed.length && n < firstTotal && (n - fixed.length) % 2 === 0) || n === firstTotal + 3 || n === firstTotal + 5 || n === firstTotal + 8) c.numFmt = DEC;
      else if (typeof c.value === "number") c.numFmt = INT;
      if (pctCols.includes(n)) c.numFmt = "0%";
      if (pct2Cols.includes(n)) c.numFmt = "0.00%";
    });
  };
  const pctCols = [firstTotal + 2, firstTotal + 4];
  const pct2Cols = [firstTotal + 7, firstTotal + 9];
  let r = 9;
  for (const b of rows) {
    const x = hitung(b, tahun, data.sekarang);
    const row = ws.getRow(r++);
    row.values = [
      ESTATE_SHEET[b.estate] ?? b.estate,
      b.divisi,
      b.blok,
      b.planting_material,
      b.tahun_tanam,
      b.ha,
      b.sph,
      b.pkk,
      b.kondisi,
      b.field_number,
      ...monthVals(b.bulan).map((v) => rd(v, 4)),
      x.total,
      x.selisih,
      x.pct,
      rd(x.haTotal),
      x.pctHa,
      rd(x.totalHa),
      x.tahunPkk,
      x.tahunPct,
      rd(x.tahunHa),
      x.tahunPctHa,
    ];
    fmtRow(row, pctCols, pct2Cols);
  }
  const s = sum.semua;
  const area = s.pkk;
  const blank = (n: number) => Array(n).fill(null);
  const foot = (label: string, mid: (number | null)[], tot: (number | null)[]) => {
    const row = ws.getRow(r++);
    row.values = [...blank(7), label, ...blank(2), ...mid.map((v) => rd(v, 4)), ...tot.map((v) => rd(v, 4))];
    row.font = { bold: true };
    fmtRow(row, pctCols, pct2Cols);
  };
  r++;
  foot("Total keseluruhan pruning", monthVals(s.bulan), [s.total, null, area ? s.total / area : null, s.haTotal, s.ha ? s.haTotal / s.ha : null, s.totalHa, s.tahunPkk, area ? s.tahunPkk / area : null, s.tahunHa, s.ha ? s.tahunHa / s.ha : null]);
  foot("Total keseluruhan area", blank(years.length * 24), [area, null, 1, s.ha, 1, null, area, 1, s.ha, 1]);
  foot("Total belum pruning", blank(years.length * 24), [
    area - s.total,
    null,
    area ? (area - s.total) / area : null,
    s.ha - s.haTotal,
    s.ha ? (s.ha - s.haTotal) / s.ha : null,
    null,
    area - s.tahunPkk,
    area ? (area - s.tahunPkk) / area : null,
    s.ha - s.tahunHa,
    s.ha ? (s.ha - s.tahunHa) / s.ha : null,
  ]);
  r += 2;
  const group = (k: Kelompok, a: string, b: string, months: boolean) => {
    const row = ws.getRow(r++);
    row.values = [
      ...blank(3),
      a,
      b,
      rd(k.ha),
      k.sph,
      rd(k.pkk, 0),
      ...blank(2),
      ...(months ? monthVals(k.bulan).map((v) => rd(v)) : blank(years.length * 24)),
      k.total,
      rd(k.total - k.pkk, 0),
      k.pkk ? k.total / k.pkk : null,
      rd(k.haTotal),
      k.ha ? k.haTotal / k.ha : null,
      rd(k.totalHa),
      k.tahunPkk,
      k.pkk ? k.tahunPkk / k.pkk : null,
      rd(k.tahunHa),
      k.ha ? k.tahunHa / k.ha : null,
    ];
    fmtRow(row, pctCols, pct2Cols);
  };
  for (const k of sum.perDivisi) group(k, k.estate, k.divisi, true);
  r += 2;
  for (const k of sum.perEstate) group(k, "ESTATE", `${k.estate}${k.divisi ? ` ${k.divisi}` : ""}`, false);

  ws.getColumn(1).width = 9;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 8;
  ws.getColumn(4).width = 16;
  for (let c = 5; c <= firstTotal + 9; c++) if (c > 4) ws.getColumn(c).width = c <= 10 ? 10 : 9;
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `AKSS-BLOCK-DETAIL-pruning-${tahun}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
