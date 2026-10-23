import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, Map as MapIcon, Pencil, Plus, Save, Search, Trash2, Upload, X } from "lucide-react";
import { api, errorText, type PetaPruning, type PruningBlok, type PruningBlokOption, type PruningImportRow, type PruningLog } from "../lib/api";
import { downloadPruningTemplate, readPruningUpload, type PruningUploadRow } from "../lib/pruningExcel";
import { useAuth } from "../context/AuthContext";
import { can, pageAllowed } from "../lib/access";
import { localToday } from "../lib/opname";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { ExportButtons } from "../components/ExportButtons";
import type { TableReport } from "../lib/printTable";

const ESTATE_LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "-" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));
const tgl = (iso: string) => iso.split("-").reverse().join("/");
// Entries from the old sheet are a month's total, dated the 1st: shown as the month.
const tglLog = (r: PruningLog) => (r.sumber === "sheet" ? `${BULAN[Number(r.tanggal_iso.slice(5, 7)) - 1]} ${r.tanggal_iso.slice(0, 4)}` : tgl(r.tanggal_iso));
const bulanTahun = (iso: string | null) => (iso ? `${BULAN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "-");
const pctOf = (b: { pkk: number; target: number | null }) => (b.target ? (b.pkk / b.target) * 100 : null);
const inputCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const btnCls = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[#f1f5f9] disabled:opacity-50";

type Tab = "input" | "rekap";

// Kebun > Pruning PT.AKSS: pruning entered per date and blok (pokok, Ha), its history, and the rekap per
// blok per month like the old sheet (pokok vs Ha x SPH). The Peta Blok colours each blok from the same data.
export function PruningPage() {
  const { user } = useAuth();
  const canInput = can(user, "pruning.input");
  const canEdit = can(user, "pruning.edit");
  const [tab, setTab] = useState<Tab>(canInput ? "input" : "rekap");
  const [blokList, setBlokList] = useState<PruningBlokOption[]>([]);
  const estates = useMemo(() => [...new Set(blokList.map((b) => b.estate))], [blokList]);
  // A change anywhere (input, edit, target) reloads the other tab's data too.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);
  useEffect(() => {
    api.pruningBlokOptions().then(setBlokList).catch(() => {});
  }, [version]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? "border-[var(--accent-blue)] text-[var(--accent-blue)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Pruning PT.AKSS</h1>
          <p className="text-sm text-[var(--text-secondary)]">Input pruning per blok, riwayat, dan rekap per bulan (pokok vs Ha × SPH)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pageAllowed(user, "/peta-blok") && (
            <Link to="/peta-blok" className={btnCls}>
              <MapIcon size={16} /> Lihat di Peta Blok
            </Link>
          )}
          <ActivityLogButton module="PRUNING" estate="" />
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--border)]">
        {tabBtn("input", canInput ? "Input & Riwayat" : "Riwayat")}
        {tabBtn("rekap", "Rekap per Blok")}
      </div>

      {tab === "input" ? (
        <InputRiwayat blokList={blokList} estates={estates} canInput={canInput} canEdit={canEdit} version={version} onChanged={changed} />
      ) : (
        <Rekap estates={estates} canEdit={canEdit} version={version} onChanged={changed} />
      )}
    </div>
  );
}

// ---- Input & Riwayat ----
type Baris = { blok: string; pkk: string; ha: string; keterangan: string };
const barisKosong = (): Baris => ({ blok: "", pkk: "", ha: "", keterangan: "" });

function InputRiwayat({
  blokList,
  estates,
  canInput,
  canEdit,
  version,
  onChanged,
}: {
  blokList: PruningBlokOption[];
  estates: string[];
  canInput: boolean;
  canEdit: boolean;
  version: number;
  onChanged: () => void;
}) {
  const [estate, setEstate] = useState("");
  const est = estate || estates[0] || "";
  const [tanggal, setTanggal] = useState(localToday());
  const [baris, setBaris] = useState<Baris[]>([barisKosong()]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // This year's progress of the estate's blok, shown next to each row.
  const [rekap, setRekap] = useState<PetaPruning | null>(null);
  useEffect(() => {
    if (!est || !canInput) return;
    api.pruningRekap(Number(tanggal.slice(0, 4)) || null, est).then(setRekap).catch(() => {});
  }, [est, tanggal.slice(0, 4), version, canInput]);
  const blokEst = blokList.filter((b) => b.estate === est);
  const findBlok = (s: string) => blokEst.find((b) => b.blok.toUpperCase() === s.trim().toUpperCase());
  const findRekap = (s: string) => rekap?.blok.find((b) => b.estate === est && b.blok.toUpperCase() === s.trim().toUpperCase());
  const setRow = (i: number, patch: Partial<Baris>) => setBaris((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const haKira = (r: Baris) => {
    const b = findBlok(r.blok);
    const p = Number(r.pkk);
    return b?.sph && p > 0 ? Math.round((p / b.sph) * 100) / 100 : null;
  };

  // Upload Excel: read the file, let the server check every row (preview), then save the OK ones.
  const [upload, setUpload] = useState<{ file: string; rows: PruningUploadRow[]; check: Awaited<ReturnType<typeof api.pruningImport>> } | null>(null);
  const [reading, setReading] = useState(false);
  const pilihFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    setReading(true);
    try {
      const rows = await readPruningUpload(f, est);
      setUpload({ file: f.name, rows, check: await api.pruningImport(rows, true) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && !("status" in e) ? e.message : errorText(e, "Gagal membaca file") });
    } finally {
      setReading(false);
    }
  };

  const simpan = async () => {
    setMsg(null);
    const isi = baris.filter((r) => r.blok.trim() || r.pkk);
    if (!isi.length) return setMsg({ ok: false, text: "Isi minimal satu blok" });
    const salah = isi.find((r) => !findBlok(r.blok));
    if (salah) return setMsg({ ok: false, text: `Blok "${salah.blok}" tidak ada di ${ESTATE_LABEL[est] ?? est}` });
    const nol = isi.find((r) => !(Number(r.pkk) > 0));
    if (nol) return setMsg({ ok: false, text: `Blok ${nol.blok}: isi jumlah pokok` });
    setSaving(true);
    try {
      await api.pruningCreate({
        estate: est,
        tanggal_iso: tanggal,
        rows: isi.map((r) => ({ blok: r.blok.trim(), pkk: Number(r.pkk), ha: r.ha ? Number(r.ha) : haKira(r) ?? 0, keterangan: r.keterangan })),
      });
      setMsg({ ok: true, text: `Tersimpan: ${isi.length} blok, ${fmt(isi.reduce((s, r) => s + Number(r.pkk), 0))} pokok` });
      setBaris([barisKosong()]);
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "Gagal menyimpan") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {canInput && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[var(--text-secondary)] space-y-1">
              <span className="block">Tanggal pruning</span>
              <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
            </label>
            <label className="text-xs text-[var(--text-secondary)] space-y-1">
              <span className="block">Estate</span>
              <select value={est} onChange={(e) => (setEstate(e.target.value), setBaris([barisKosong()]))} className={inputCls}>
                {estates.map((e) => (
                  <option key={e} value={e}>
                    {ESTATE_LABEL[e] ?? e}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <datalist id="pruning-blok">
            {blokEst.map((b) => (
              <option key={b.blok} value={b.blok}>
                {b.divisi ? `Div ${b.divisi}` : ""}
              </option>
            ))}
          </datalist>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs text-[var(--text-secondary)]">
                  <th className="py-1.5 pr-2 w-36">Blok</th>
                  <th className="py-1.5 pr-2 w-32">Pokok</th>
                  <th className="py-1.5 pr-2 w-32">Ha</th>
                  <th className="py-1.5 pr-2">Keterangan (mandor, catatan)</th>
                  <th className="py-1.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {baris.map((r, i) => {
                  const b = findBlok(r.blok);
                  const rk = findRekap(r.blok);
                  const kira = haKira(r);
                  return (
                    <tr key={i} className="align-top">
                      <td className="py-1 pr-2">
                        <input
                          list="pruning-blok"
                          value={r.blok}
                          onChange={(e) => setRow(i, { blok: e.target.value })}
                          placeholder="cth. L62"
                          className={`${inputCls} w-full ${r.blok && !b ? "border-[var(--accent-red)]" : ""}`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" min={0} value={r.pkk} onChange={(e) => setRow(i, { pkk: e.target.value })} className={`${inputCls} w-full`} />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={r.ha}
                          onChange={(e) => setRow(i, { ha: e.target.value })}
                          placeholder={kira !== null ? `≈ ${fmt(kira, 2)}` : ""}
                          title={kira !== null ? "Kosongkan untuk memakai perkiraan pokok ÷ SPH" : undefined}
                          className={`${inputCls} w-full`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input value={r.keterangan} onChange={(e) => setRow(i, { keterangan: e.target.value })} className={`${inputCls} w-full`} />
                        {b && (
                          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                            {b.divisi ? `Div ${b.divisi} · ` : ""}
                            {fmt(b.ha, 2)} Ha · target {fmt(b.ha && b.sph ? b.ha * b.sph : null)} pokok
                            {rk && ` · sudah ${fmt(rk.pkk)} di ${rekap?.tahun} (${fmt(pctOf(rk), 1)}%)`}
                            {rk?.terakhir && ` · terakhir ${bulanTahun(rk.terakhir)}`}
                          </div>
                        )}
                      </td>
                      <td className="py-1">
                        {baris.length > 1 && (
                          <button onClick={() => setBaris((x) => x.filter((_, j) => j !== i))} title="Hapus baris" className="p-2 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                            <X size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setBaris((x) => [...x, barisKosong()])} className={btnCls}>
              <Plus size={15} /> Tambah blok
            </button>
            <button
              onClick={simpan}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save size={15} /> {saving ? "Menyimpan..." : "Simpan"}
            </button>
            <span className="mx-1 h-6 w-px bg-[var(--border)]" />
            <button onClick={() => downloadPruningTemplate(blokList)} className={btnCls} title="Template Excel untuk input banyak blok / tanggal sekaligus">
              <Download size={15} /> Unduh template
            </button>
            <label className={`${btnCls} cursor-pointer ${reading ? "opacity-50 pointer-events-none" : ""}`} title="Upload file Excel isian pruning">
              <Upload size={15} /> {reading ? "Membaca..." : "Upload Excel"}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  pilihFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {msg && <span className={`text-sm ${msg.ok ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}>{msg.text}</span>}
          </div>
        </div>
      )}
      {upload && (
        <UploadPreview
          {...upload}
          onClose={() => setUpload(null)}
          onSaved={(n, dup) => {
            setUpload(null);
            setMsg({ ok: true, text: `Upload tersimpan: ${n} baris${dup ? ` · ${dup} baris sudah ada, dilewati` : ""}` });
            onChanged();
          }}
        />
      )}

      <Riwayat estates={estates} blokList={blokList} canEdit={canEdit} version={version} onChanged={onChanged} />
    </div>
  );
}

function Riwayat({
  estates,
  blokList,
  canEdit,
  version,
  onChanged,
}: {
  estates: string[];
  blokList: PruningBlokOption[];
  canEdit: boolean;
  version: number;
  onChanged: () => void;
}) {
  const LIMIT = 50;
  const [estate, setEstate] = useState("");
  const [periode, setPeriode] = useState("");
  const [search, setSearch] = useState("");
  const [sumber, setSumber] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: PruningLog[]; total: number; pkk: number; ha: number } | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<PruningLog | null>(null);
  const params = { estate, periode, search, sumber };
  useEffect(() => setPage(0), [estate, periode, search, sumber]);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .pruningList({ ...params, limit: LIMIT, offset: page * LIMIT })
        .then(setData)
        .catch((e) => setError(errorText(e, "Gagal memuat riwayat")));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate, periode, search, sumber, page, version]);

  const hapus = async (r: PruningLog) => {
    if (!window.confirm(`Hapus pruning blok ${r.blok} tanggal ${tglLog(r)} (${fmt(r.pkk)} pokok)?`)) return;
    try {
      await api.pruningDelete(r.id);
      onChanged();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus"));
    }
  };

  const report = async (): Promise<TableReport> => {
    const all = await api.pruningList({ ...params, limit: 500, offset: 0 });
    return {
      title: "Riwayat Pruning PT.AKSS",
      subtitle: [`Estate: ${estate ? ESTATE_LABEL[estate] : "Semua"}`, periode && `Periode: ${periode}`, search && `Cari: ${search}`].filter(Boolean) as string[],
      columns: [{ label: "Tanggal" }, { label: "Estate" }, { label: "Blok" }, { label: "Pokok", align: "right" }, { label: "Ha", align: "right" }, { label: "Keterangan" }, { label: "Oleh" }],
      rows: all.rows.map((r) => [tglLog(r), ESTATE_LABEL[r.estate] ?? r.estate, r.blok, r.pkk, r.ha, r.keterangan, r.created_by]),
    };
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <div className="text-sm font-semibold mr-2">Riwayat pruning</div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari blok / keterangan" className={`${inputCls} pl-8 w-48`} />
        </div>
        <select value={estate} onChange={(e) => setEstate(e.target.value)} className={inputCls} aria-label="Estate">
          <option value="">Semua estate</option>
          {estates.map((e) => (
            <option key={e} value={e}>
              {ESTATE_LABEL[e] ?? e}
            </option>
          ))}
        </select>
        <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} className={inputCls} aria-label="Bulan" title="Bulan" />
        {periode && (
          <button onClick={() => setPeriode("")} className="text-xs text-[var(--accent-blue)] hover:underline">
            semua bulan
          </button>
        )}
        <select value={sumber} onChange={(e) => setSumber(e.target.value)} className={inputCls} aria-label="Sumber">
          <option value="">Semua input</option>
          <option value="app">Input aplikasi</option>
          <option value="sheet">Rekap sheet lama</option>
        </select>
        <div className="ml-auto flex gap-2">
          <ExportButtons total={data?.total ?? 0} buildReport={report} fileName="riwayat-pruning" />
        </div>
      </div>
      {error && <p className="px-3 pt-2 text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc] text-xs text-[var(--text-secondary)]">
            <tr className="text-left">
              <th className="px-3 py-2">Tanggal</th>
              <th className="px-3 py-2">Estate</th>
              <th className="px-3 py-2">Blok</th>
              <th className="px-3 py-2 text-right">Pokok</th>
              <th className="px-3 py-2 text-right">Ha</th>
              <th className="px-3 py-2">Keterangan</th>
              <th className="px-3 py-2">Oleh</th>
              {canEdit && <th className="px-3 py-2 w-20" />}
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Belum ada data pruning
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 whitespace-nowrap">{tglLog(r)}</td>
                  <td className="px-3 py-2">{ESTATE_LABEL[r.estate] ?? r.estate}</td>
                  <td className="px-3 py-2 font-medium">{r.blok}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.pkk)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.ha, 2)}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.keterangan || "-"}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{r.created_by || "-"}</td>
                  {canEdit && (
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button onClick={() => setEdit(r)} title="Edit" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-blue)]">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => hapus(r)} title="Hapus" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {data && data.total > 0 && (
            <tfoot className="border-t border-[var(--border)] bg-[#f8fafc] text-sm font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  Total {fmt(data.total)} input
                </td>
                <td className="px-3 py-2 text-right">{fmt(data.pkk)}</td>
                <td className="px-3 py-2 text-right">{fmt(data.ha, 2)}</td>
                <td colSpan={canEdit ? 3 : 2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {data && data.total > LIMIT && (
        <div className="flex items-center justify-end gap-2 p-3 text-sm text-[var(--text-secondary)]">
          {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, data.total)} dari {fmt(data.total)}
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="p-1.5 rounded border border-[var(--border)] disabled:opacity-40">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * LIMIT >= data.total} className="p-1.5 rounded border border-[var(--border)] disabled:opacity-40">
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      {edit && (
        <EditModal
          row={edit}
          blokList={blokList.filter((b) => b.estate === edit.estate)}
          onClose={() => setEdit(null)}
          onSaved={() => (setEdit(null), onChanged())}
        />
      )}
    </div>
  );
}

// The checked rows of an uploaded file: OK ones are saved with Simpan, rows already in are skipped,
// rows with an error are shown so the file can be fixed and uploaded again.
function UploadPreview({
  file,
  rows,
  check,
  onClose,
  onSaved,
}: {
  file: string;
  rows: PruningUploadRow[];
  check: { rows: PruningImportRow[]; ok: number; duplikat: number; error: number };
  onClose: () => void;
  onSaved: (saved: number, duplikat: number) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [only, setOnly] = useState<"" | "error" | "duplikat">(check.error ? "error" : "");
  const shown = check.rows.filter((r) => !only || r.status === only);
  const totalOk = check.rows.filter((r) => r.status === "ok").reduce((s, r) => s + r.pkk, 0);
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.pruningImport(rows, false);
      onSaved(r.saved, r.duplikat);
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  const badge = (r: PruningImportRow) =>
    r.status === "ok" ? (
      <span className="text-[var(--accent-green)]">OK</span>
    ) : r.status === "duplikat" ? (
      <span className="text-[var(--text-muted)]">{r.error}</span>
    ) : (
      <span className="text-[var(--accent-red)]">{r.error}</span>
    );
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-full flex flex-col rounded-lg bg-[var(--bg-card)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[var(--border)]">
          <div>
            <h2 className="font-semibold">Upload Excel pruning</h2>
            <p className="text-xs text-[var(--text-secondary)]">{file}</p>
          </div>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
          {(
            [
              ["", `Semua ${check.rows.length}`],
              ["error", `Error ${check.error}`],
              ["duplikat", `Sudah ada ${check.duplikat}`],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setOnly(k)}
              className={`px-2.5 py-1 rounded-md border text-xs ${only === k ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]" : "border-[var(--border)]"}`}
            >
              {l}
            </button>
          ))}
          <span className="ml-auto text-[var(--text-secondary)]">
            Siap disimpan: <b className="text-[var(--text-primary)]">{check.ok} baris</b> · {fmt(totalOk)} pokok
          </span>
        </div>
        <div className="overflow-auto px-4 flex-1">
          <table className="w-full text-xs">
            <thead className="bg-[#f8fafc] text-[var(--text-secondary)] sticky top-0">
              <tr className="text-left">
                <th className="px-2 py-1.5">Baris</th>
                <th className="px-2 py-1.5">Tanggal</th>
                <th className="px-2 py-1.5">Estate</th>
                <th className="px-2 py-1.5">Blok</th>
                <th className="px-2 py-1.5 text-right">Pokok</th>
                <th className="px-2 py-1.5 text-right">Ha</th>
                <th className="px-2 py-1.5">Keterangan</th>
                <th className="px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.row} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1 text-[var(--text-muted)]">{r.row}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{/^\d{4}-\d{2}-\d{2}$/.test(r.tanggal_iso) ? tgl(r.tanggal_iso) : r.tanggal_iso || "-"}</td>
                  <td className="px-2 py-1">{ESTATE_LABEL[r.estate] ?? r.estate}</td>
                  <td className="px-2 py-1 font-medium">{r.blok || "-"}</td>
                  <td className="px-2 py-1 text-right">{Number.isFinite(r.pkk) && r.pkk >= 0 ? fmt(r.pkk) : "-"}</td>
                  <td className="px-2 py-1 text-right">{Number.isFinite(r.ha) && r.ha >= 0 ? fmt(r.ha, 2) : "-"}</td>
                  <td className="px-2 py-1 text-[var(--text-secondary)]">{r.keterangan}</td>
                  <td className="px-2 py-1">{badge(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 p-4 border-t border-[var(--border)]">
          {check.error > 0 && (
            <span className="mr-auto text-xs text-[var(--accent-red)]">
              {check.error} baris error tidak ikut disimpan. Perbaiki di file lalu upload lagi; baris yang sudah tersimpan tidak akan dobel.
            </span>
          )}
          {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
          <button onClick={onClose} className={btnCls}>
            Batal
          </button>
          <button
            onClick={save}
            disabled={saving || !check.ok}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50"
          >
            <Save size={15} /> {saving ? "Menyimpan..." : `Simpan ${check.ok} baris`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ row, blokList, onClose, onSaved }: { row: PruningLog; blokList: PruningBlokOption[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ blok: row.blok, tanggal_iso: row.tanggal_iso, pkk: String(row.pkk), ha: String(row.ha), keterangan: row.keterangan });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.pruningUpdate(row.id, { ...f, pkk: Number(f.pkk), ha: Number(f.ha) || 0 });
      onSaved();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  const field = (label: string, el: React.ReactNode) => (
    <label className="block text-xs text-[var(--text-secondary)] space-y-1">
      <span className="block">{label}</span>
      {el}
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-[var(--bg-card)] shadow-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Edit pruning · {ESTATE_LABEL[row.estate] ?? row.estate}</h2>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <datalist id="pruning-blok-edit">
          {blokList.map((b) => (
            <option key={b.blok} value={b.blok} />
          ))}
        </datalist>
        <div className="grid grid-cols-2 gap-3">
          {field("Tanggal", <input type="date" value={f.tanggal_iso} max={localToday()} onChange={(e) => setF({ ...f, tanggal_iso: e.target.value })} className={`${inputCls} w-full`} />)}
          {field("Blok", <input list="pruning-blok-edit" value={f.blok} onChange={(e) => setF({ ...f, blok: e.target.value })} className={`${inputCls} w-full`} />)}
          {field("Pokok", <input type="number" min={0} value={f.pkk} onChange={(e) => setF({ ...f, pkk: e.target.value })} className={`${inputCls} w-full`} />)}
          {field("Ha", <input type="number" min={0} step="0.01" value={f.ha} onChange={(e) => setF({ ...f, ha: e.target.value })} className={`${inputCls} w-full`} />)}
        </div>
        {field("Keterangan", <input value={f.keterangan} onChange={(e) => setF({ ...f, keterangan: e.target.value })} className={`${inputCls} w-full`} />)}
        {row.sumber === "sheet" && <p className="text-[11px] text-[var(--text-muted)]">Baris ini total satu bulan dari rekap sheet lama (bertanggal tanggal 1).</p>}
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnCls}>
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

// ---- Rekap per Blok: like the old sheet, pokok per month for one year vs Ha x SPH ----
function Rekap({ estates, canEdit, version, onChanged }: { estates: string[]; canEdit: boolean; version: number; onChanged: () => void }) {
  const [tahun, setTahun] = useState<number | null>(null);
  const [estate, setEstate] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "belum" | "kurang" | "selesai">("");
  const [data, setData] = useState<PetaPruning | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<{ key: string; ha: string; sph: string } | null>(null);
  useEffect(() => {
    api
      .pruningRekap(tahun, estate)
      .then(setData)
      .catch((e) => setError(errorText(e, "Gagal memuat rekap")));
  }, [tahun, estate, version]);

  const q = search.trim().toUpperCase();
  const rows = (data?.blok ?? []).filter((b) => {
    if (q && !b.blok.toUpperCase().includes(q) && !(b.divisi ?? "").toUpperCase().includes(q)) return false;
    const p = pctOf(b);
    if (status === "belum") return !b.pkk;
    if (status === "kurang") return !!b.pkk && (p === null || p < 100);
    if (status === "selesai") return p !== null && p >= 100;
    return true;
  });
  const tot = rows.reduce(
    (s, b) => ({ target: s.target + (b.target ?? 0), pkk: s.pkk + b.pkk, ha: s.ha + (b.ha ?? 0), haP: s.haP + b.ha_pruning, bulan: s.bulan.map((v, i) => v + b.bulan[i]) }),
    { target: 0, pkk: 0, ha: 0, haP: 0, bulan: Array(12).fill(0) as number[] }
  );
  const key = (b: PruningBlok) => `${b.estate}|${b.blok}`;

  const saveTarget = async (b: PruningBlok) => {
    if (!edit) return;
    try {
      await api.pruningTarget({ estate: b.estate, blok: b.blok, ha: edit.ha === "" ? null : Number(edit.ha), sph: edit.sph === "" ? null : Number(edit.sph) });
      setEdit(null);
      onChanged();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan target"));
    }
  };

  const report = async (): Promise<TableReport> => ({
    title: `Rekap Pruning PT.AKSS ${data?.tahun ?? ""}`,
    subtitle: [`Estate: ${estate ? ESTATE_LABEL[estate] : "Semua"}`, "Pokok per bulan; target = Ha × SPH"],
    landscape: true,
    columns: [
      { label: "Estate" },
      { label: "Divisi" },
      { label: "Blok" },
      { label: "Ha", align: "right" },
      { label: "SPH", align: "right" },
      { label: "Target", align: "right" },
      ...BULAN.map((m) => ({ label: m, align: "right" as const })),
      { label: "Total", align: "right" },
      { label: "Ha pruning", align: "right" },
      { label: "%", align: "right" },
      { label: "Terakhir" },
    ],
    rows: [
      ...rows.map((b) => [
        ESTATE_LABEL[b.estate] ?? b.estate,
        b.divisi ?? "",
        b.blok,
        b.ha,
        b.sph === null ? null : Math.round(b.sph * 100) / 100,
        b.target === null ? null : Math.round(b.target),
        ...b.bulan.map((v) => v || null),
        b.pkk,
        Math.round(b.ha_pruning * 100) / 100,
        pctOf(b) === null ? null : `${fmt(pctOf(b), 1)}%`,
        bulanTahun(b.terakhir),
      ]),
      ["TOTAL", "", `${rows.length} blok`, Math.round(tot.ha * 100) / 100, null, Math.round(tot.target), ...tot.bulan, tot.pkk, Math.round(tot.haP * 100) / 100, tot.target ? `${fmt((tot.pkk / tot.target) * 100, 1)}%` : null, ""],
    ],
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <select value={data?.tahun ?? ""} onChange={(e) => setTahun(Number(e.target.value))} className={inputCls} aria-label="Tahun">
          {(data?.tahunList ?? []).map((t) => (
            <option key={t} value={t}>
              Tahun {t}
            </option>
          ))}
        </select>
        <select value={estate} onChange={(e) => setEstate(e.target.value)} className={inputCls} aria-label="Estate">
          <option value="">Semua estate</option>
          {estates.map((e) => (
            <option key={e} value={e}>
              {ESTATE_LABEL[e] ?? e}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls} aria-label="Status">
          <option value="">Semua blok</option>
          <option value="belum">Belum pruning</option>
          <option value="kurang">Sudah, belum 100%</option>
          <option value="selesai">Selesai (≥ 100%)</option>
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari blok / divisi" className={`${inputCls} pl-8 w-44`} />
        </div>
        <div className="ml-auto flex gap-2">
          <ExportButtons total={rows.length} buildReport={report} fileName={`rekap-pruning-${data?.tahun ?? ""}`} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Target pokok", fmt(tot.target)],
          [`Sudah pruning ${data?.tahun ?? ""}`, fmt(tot.pkk)],
          ["Progress", tot.target ? `${fmt((tot.pkk / tot.target) * 100, 2)}%` : "-"],
          ["Blok belum pruning", `${rows.filter((b) => !b.pkk).length} dari ${rows.length}`],
        ].map(([l, v]) => (
          <div key={l} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
            <div className="text-[11px] text-[var(--text-muted)]">{l}</div>
            <div className="text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-auto max-h-[70vh]">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-[#f8fafc] text-[var(--text-secondary)] sticky top-0 z-10">
            <tr className="text-left">
              <th className="px-2 py-2">Estate</th>
              <th className="px-2 py-2">Div</th>
              <th className="px-2 py-2">Blok</th>
              <th className="px-2 py-2 text-right">Ha</th>
              <th className="px-2 py-2 text-right">SPH</th>
              <th className="px-2 py-2 text-right">Target</th>
              {BULAN.map((m) => (
                <th key={m} className="px-2 py-2 text-right">
                  {m}
                </th>
              ))}
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-right">Ha prun.</th>
              <th className="px-2 py-2 text-right">%</th>
              <th className="px-2 py-2">Terakhir</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={22} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const p = pctOf(b);
                const editing = edit?.key === key(b);
                return (
                  <tr key={key(b)} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-2 py-1.5">{ESTATE_LABEL[b.estate] ?? b.estate}</td>
                    <td className="px-2 py-1.5">{b.divisi ?? "-"}</td>
                    <td className="px-2 py-1.5 font-semibold">{b.blok}</td>
                    {editing ? (
                      <>
                        <td className="px-1 py-1" colSpan={3}>
                          <div className="flex items-center gap-1">
                            <input type="number" step="0.01" value={edit.ha} onChange={(e) => setEdit({ ...edit, ha: e.target.value })} className="w-16 rounded border border-[var(--border)] px-1 py-0.5 text-right" title="Ha" />
                            <input type="number" step="0.01" value={edit.sph} onChange={(e) => setEdit({ ...edit, sph: e.target.value })} className="w-14 rounded border border-[var(--border)] px-1 py-0.5 text-right" title="SPH" />
                            <button onClick={() => saveTarget(b)} title="Simpan" className="p-1 text-[var(--accent-blue)]">
                              <Save size={13} />
                            </button>
                            <button onClick={() => setEdit(null)} title="Batal" className="p-1 text-[var(--text-muted)]">
                              <X size={13} />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 text-right">{fmt(b.ha, 2)}</td>
                        <td className="px-2 py-1.5 text-right" title={b.target_sumber === "master" ? "Dari Master Blok" : undefined}>
                          {fmt(b.sph, 0)}
                          {b.target_sumber === "master" && <span className="text-[var(--text-muted)]">*</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <span className="inline-flex items-center gap-1">
                            {fmt(b.target)}
                            {canEdit && (
                              <button
                                onClick={() => setEdit({ key: key(b), ha: b.ha === null ? "" : String(b.ha), sph: b.sph === null ? "" : String(Math.round(b.sph * 100) / 100) })}
                                title="Ubah Ha / SPH target"
                                className="text-[var(--text-muted)] hover:text-[var(--accent-blue)]"
                              >
                                <Pencil size={11} />
                              </button>
                            )}
                          </span>
                        </td>
                      </>
                    )}
                    {b.bulan.map((v, i) => (
                      <td key={i} className={`px-2 py-1.5 text-right ${v ? "" : "text-[var(--text-muted)]"}`}>
                        {v ? fmt(v) : "-"}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold">{b.pkk ? fmt(b.pkk) : "-"}</td>
                    <td className="px-2 py-1.5 text-right">{b.ha_pruning ? fmt(b.ha_pruning, 2) : "-"}</td>
                    <td
                      className={`px-2 py-1.5 text-right font-semibold ${
                        p === null ? "" : p >= 100 ? "text-[var(--accent-green)]" : p > 0 ? "text-[var(--accent-amber)]" : "text-[var(--accent-red)]"
                      }`}
                    >
                      {p === null ? "-" : `${fmt(p, 1)}%`}
                    </td>
                    <td className="px-2 py-1.5 text-[var(--text-secondary)]">{bulanTahun(b.terakhir)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {data && rows.length > 0 && (
            <tfoot className="bg-[#f8fafc] font-semibold sticky bottom-0">
              <tr className="border-t border-[var(--border)]">
                <td className="px-2 py-2" colSpan={3}>
                  Total {rows.length} blok
                </td>
                <td className="px-2 py-2 text-right">{fmt(tot.ha, 2)}</td>
                <td />
                <td className="px-2 py-2 text-right">{fmt(tot.target)}</td>
                {tot.bulan.map((v, i) => (
                  <td key={i} className="px-2 py-2 text-right">
                    {v ? fmt(v) : "-"}
                  </td>
                ))}
                <td className="px-2 py-2 text-right">{fmt(tot.pkk)}</td>
                <td className="px-2 py-2 text-right">{fmt(tot.haP, 2)}</td>
                <td className="px-2 py-2 text-right">{tot.target ? `${fmt((tot.pkk / tot.target) * 100, 1)}%` : "-"}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">
        % = pokok pruning di tahun terpilih ÷ (Ha × SPH). * = SPH dari Master Blok (blok belum punya target pruning sendiri).
        {canEdit && " Klik ikon pensil di kolom Target untuk mengubah Ha / SPH."}
      </p>
    </div>
  );
}
