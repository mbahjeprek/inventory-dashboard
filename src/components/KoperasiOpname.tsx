import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, Pencil, Plus, Save, Search, Trash2, XCircle } from "lucide-react";
import { api, errorText, type KopOpname, type KopOpnameLine } from "../lib/api";
import { ExportButtons } from "./ExportButtons";
import { ConfirmDialog } from "./ConfirmDialog";
import { fmtQty, isoDisplay, localToday } from "../lib/opname";
import { tanggalWaktu } from "../lib/datetime";

// Stok Opname of the koperasi (its own tab, separate from the inventory Stok Opname menu). Start =
// the stock of every active barang is noted; the counts are typed in and saved as a draft (Input);
// Selesai & Koreksi Stok books each difference (Edit). The lembar hitung prints with empty Fisik.
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";
const STATUS: Record<KopOpname["status"], { label: string; cls: string }> = {
  DRAFT: { label: "Sedang dihitung", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  SELESAI: { label: "Selesai", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  BATAL: { label: "Dibatalkan", cls: "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-secondary)]" },
};
// "12" / "12,5" / "1.500" -> number; "" -> null.
const parseFisik = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t);
  return Number.isFinite(n) ? n : NaN;
};

// A superuser may also edit any opname (a finished one is booked again) or delete it (its koreksi go too).
export function KoperasiOpname({ canInput, canEdit, isSuperuser, onChanged }: { canInput: boolean; canEdit: boolean; isSuperuser: boolean; onChanged: () => void }) {
  const [list, setList] = useState<KopOpname[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [tanggal, setTanggal] = useState(localToday());
  const [catatan, setCatatan] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [hapus, setHapus] = useState<KopOpname | null>(null);
  const doHapus = async () => {
    if (!hapus) return;
    setError("");
    try {
      await api.kopOpnameHapus(hapus.id);
      setHapus(null);
      setReload((n) => n + 1);
      onChanged();
    } catch (e) {
      setHapus(null);
      setError(errorText(e, "Gagal menghapus stok opname"));
    }
  };
  useEffect(() => {
    api
      .kopOpnameList()
      .then(setList)
      .catch(() => setList([]));
  }, [reload]);
  const draft = list?.find((o) => o.status === "DRAFT");

  const mulai = async () => {
    setError("");
    try {
      const r = await api.kopOpnameMulai(tanggal, catatan);
      setStarting(false);
      setCatatan("");
      setReload((n) => n + 1);
      setOpen(r.id);
    } catch (e) {
      setError(errorText(e, "Gagal memulai stok opname"));
    }
  };

  if (open !== null)
    return (
      <OpnameDetail
        id={open}
        canInput={canInput}
        canEdit={canEdit}
        isSuperuser={isSuperuser}
        onBack={() => (setOpen(null), setReload((n) => n + 1))}
        onDone={() => (setReload((n) => n + 1), onChanged())}
      />
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-[var(--text-secondary)] flex-1 min-w-[260px]">
          Hitung stok fisik koperasi, lalu selisihnya dikoreksi ke stok. Stok opname ini khusus koperasi, terpisah dari menu Stok Opname inventory.
        </p>
        {canInput && !draft && !starting && (
          <button onClick={() => setStarting(true)} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
            <Plus size={16} /> Mulai Stok Opname
          </button>
        )}
      </div>
      {starting && (
        <div className="bg-[var(--bg-card)] border border-[var(--accent-blue-border)] rounded-lg p-4 space-y-3">
          <div className="grid sm:grid-cols-[180px_1fr] gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal opname</label>
              <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan (opsional)</label>
              <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputCls} placeholder="mis. opname akhir bulan" />
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Stok sistem semua barang aktif dicatat saat ini. Stock out yang terjadi selama menghitung tidak mengganggu hasil.</p>
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setStarting(false)} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
              Batal
            </button>
            <button onClick={mulai} className="px-4 py-2 text-sm rounded-md bg-[var(--accent-blue)] text-white">
              Mulai
            </button>
          </div>
        </div>
      )}

      {error && !starting && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      {hapus && (
        <ConfirmDialog
          title={`Hapus stok opname #${hapus.id}?`}
          message={
            hapus.status === "SELESAI"
              ? `Opname ini beserta ${hapus.n_selisih ?? 0} koreksi stoknya dihapus: stok barang kembali seperti sebelum opname. Tidak bisa dibatalkan.`
              : "Opname ini dan hitungannya dihapus. Stok tidak berubah."
          }
          onConfirm={doHapus}
          onCancel={() => setHapus(null)}
        />
      )}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              <th className="px-3 py-2.5">No</th>
              <th className="px-3 py-2.5">Tanggal</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Dihitung</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Ada selisih</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Nilai selisih</th>
              <th className="px-3 py-2.5">Oleh</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {list === null ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !list.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  <ClipboardList size={20} className="inline mb-1" />
                  <div>Belum pernah stok opname koperasi.</div>
                </td>
              </tr>
            ) : (
              list.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-[#f8fafc]" onClick={() => setOpen(o.id)}>
                  <td className="px-3 py-2 text-[var(--text-muted)]">#{o.id}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {tanggalWaktu(o.tanggal_iso, o.created_at)}
                    {o.catatan && <div className="text-[11px] text-[var(--text-muted)]">{o.catatan}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {o.dihitung} / {o.n_barang}
                  </td>
                  <td className="px-3 py-2 text-right">{o.n_selisih}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${(o.nilai_selisih ?? 0) < 0 ? "text-[var(--accent-red)]" : ""}`}>{rp(o.nilai_selisih ?? 0)}</td>
                  <td className="px-3 py-2 text-xs">
                    {o.oleh || "-"}
                    {o.selesai_oleh_nama && o.status === "SELESAI" && <div className="text-[var(--text-muted)]">selesai: {o.selesai_oleh_nama}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-[var(--accent-blue)] whitespace-nowrap">
                    {o.status === "DRAFT" && canInput ? "Lanjut hitung" : "Lihat"}
                    {isSuperuser && (
                      <button
                        onClick={(e) => (e.stopPropagation(), setHapus(o))}
                        title="Hapus stok opname"
                        className="ml-2 p-1 rounded-md text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)] align-middle"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Row = KopOpnameLine & { input: string; ket: string };

function OpnameDetail({
  id,
  canInput,
  canEdit,
  isSuperuser,
  onBack,
  onDone,
}: {
  id: number;
  canInput: boolean;
  canEdit: boolean;
  isSuperuser: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  const [head, setHead] = useState<KopOpname | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<"" | "belum" | "selisih">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<"" | "selesai" | "batal" | "hapus" | "simpanEdit">("");
  // Superuser edit of an opname (any status): tanggal, catatan and the counts.
  const [editMode, setEditMode] = useState(false);
  const [eTanggal, setETanggal] = useState("");
  const [eCatatan, setECatatan] = useState("");
  const load = () =>
    api
      .kopOpname(id)
      .then((o) => {
        setHead(o);
        setRows(o.lines.map((l) => ({ ...l, input: l.fisik === null ? "" : String(l.fisik).replace(".", ","), ket: l.keterangan })));
        setDirty(false);
      })
      .catch((e) => setError(errorText(e, "Stok opname tidak bisa dimuat")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // Leaving the page with unsaved counts asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const editable = (head?.status === "DRAFT" && canInput) || editMode;
  const fisikOf = (r: Row) => (editable ? parseFisik(r.input) : r.fisik);
  const selisihOf = (r: Row) => {
    const f = fisikOf(r);
    return f === null || Number.isNaN(f) ? null : Math.round((f - r.stok_sistem) * 1000) / 1000;
  };
  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter((r) => {
        if (q && !r.nama.toLowerCase().includes(q) && !r.kode.toLowerCase().includes(q)) return false;
        const s = selisihOf(r);
        return only === "belum" ? fisikOf(r) === null : only === "selisih" ? !!s : true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, q, only, editable]
  );
  const counted = rows.filter((r) => fisikOf(r) !== null).length;
  const withDiff = rows.filter((r) => selisihOf(r)).length;
  const nilai = rows.reduce((s, r) => s + (selisihOf(r) ?? 0) * r.harga_beli, 0);
  const invalid = rows.find((r) => Number.isNaN(fisikOf(r) as number) || (fisikOf(r) ?? 0) < 0);

  const set = (kode: string, k: "input" | "ket", v: string) => {
    setRows((rs) => rs.map((r) => (r.kode === kode ? { ...r, [k]: v } : r)));
    setDirty(true);
    setNote("");
  };
  const simpan = async () => {
    if (invalid) {
      setError(`Stok fisik ${invalid.nama} bukan angka yang valid`);
      return false;
    }
    setBusy(true);
    setError("");
    try {
      await api.kopOpnameSimpan(
        id,
        rows.map((r) => ({ barang_kode: r.kode, fisik: parseFisik(r.input), keterangan: r.ket }))
      );
      setDirty(false);
      setNote("Tersimpan");
      return true;
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan hitungan"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const selesai = async () => {
    setConfirm("");
    if (dirty && !(await simpan())) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.kopOpnameSelesai(id);
      setNote(`Selesai: ${r.koreksi} barang dikoreksi`);
      await load();
      onDone();
    } catch (e) {
      setError(errorText(e, "Gagal menyelesaikan stok opname"));
    } finally {
      setBusy(false);
    }
  };
  const mulaiEdit = () => {
    if (!head) return;
    setETanggal(head.tanggal_iso);
    setECatatan(head.catatan);
    setEditMode(true);
    setNote("");
    setError("");
  };
  const simpanEdit = async () => {
    setConfirm("");
    if (invalid) return setError(`Stok fisik ${invalid.nama} bukan angka yang valid`);
    setBusy(true);
    setError("");
    try {
      const r = await api.kopOpnameEdit(id, { tanggal: eTanggal, catatan: eCatatan, lines: rows.map((x) => ({ barang_kode: x.kode, fisik: parseFisik(x.input), keterangan: x.ket })) });
      setEditMode(false);
      await load();
      setNote(r.koreksi !== null ? `Perubahan tersimpan, koreksi stok dibukukan ulang (${r.koreksi} barang)` : "Perubahan tersimpan");
      onDone();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan perubahan"));
    } finally {
      setBusy(false);
    }
  };
  const hapus = async () => {
    setConfirm("");
    try {
      await api.kopOpnameHapus(id);
      onDone();
      onBack();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus stok opname"));
    }
  };
  const batal = async () => {
    setConfirm("");
    try {
      await api.kopOpnameBatal(id);
      onBack();
    } catch (e) {
      setError(errorText(e, "Gagal membatalkan"));
    }
  };
  const buildReport = async () => ({
    title: `Stok Opname Koperasi PT.AKSS #${id}`,
    subtitle: [`Tanggal ${head ? isoDisplay(head.tanggal_iso) : ""}${head?.catatan ? ` · ${head.catatan}` : ""}`, head?.status === "DRAFT" ? "Lembar hitung (isi kolom Fisik)" : `Status: ${head ? STATUS[head.status].label : ""}`],
    columns: [
      { label: "No" },
      { label: "Kode" },
      { label: "Barang" },
      { label: "Satuan" },
      { label: "Stok Sistem", align: "right" as const },
      { label: "Fisik", align: "right" as const },
      { label: "Selisih", align: "right" as const },
      { label: "Nilai Selisih (Rp)", align: "right" as const },
      { label: "Keterangan" },
    ],
    rows: shown.map((r, i) => {
      const f = fisikOf(r);
      const s = selisihOf(r);
      return [i + 1, r.kode, r.nama, r.satuan, r.stok_sistem, f ?? "", s ?? "", s === null ? "" : Math.round(s * r.harga_beli), editable ? r.ket : r.keterangan];
    }),
  });

  if (!head) return <p className="text-sm text-[var(--text-muted)]">{error || "Memuat..."}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => (dirty && !window.confirm("Hitungan belum disimpan. Tetap keluar?") ? null : onBack())} className="inline-flex items-center gap-1 text-sm text-[var(--accent-blue)] hover:underline">
          <ArrowLeft size={15} /> Daftar stok opname
        </button>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Stok Opname #{id} · {isoDisplay(head.tanggal_iso)}
        </h2>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS[head.status].cls}`}>{STATUS[head.status].label}</span>
        {head.catatan && <span className="text-xs text-[var(--text-muted)]">{head.catatan}</span>}
        {isSuperuser && !editMode && (
          <div className="ml-auto flex gap-2">
            <button onClick={mulaiEdit} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
              <Pencil size={14} /> Edit
            </button>
            <button
              onClick={() => setConfirm("hapus")}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
            >
              <Trash2 size={14} /> Hapus
            </button>
          </div>
        )}
      </div>
      {editMode && (
        <div className="bg-[var(--accent-amber-bg)] border border-[var(--accent-amber-border)] rounded-lg p-3 space-y-2">
          <div className="text-sm font-medium text-[var(--accent-amber)]">
            Mode edit Super User{head.status === "SELESAI" ? " - saat disimpan, koreksi stok opname ini dibukukan ulang sesuai angka baru" : ""}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[var(--text-secondary)]">
              Tanggal
              <input type="date" value={eTanggal} max={localToday()} onChange={(e) => setETanggal(e.target.value)} className="block mt-1 text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white" />
            </label>
            <label className="text-xs text-[var(--text-secondary)] flex-1 min-w-[200px]">
              Catatan
              <input value={eCatatan} onChange={(e) => setECatatan(e.target.value)} className="block w-full mt-1 text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white" />
            </label>
            <button onClick={() => (setEditMode(false), load())} disabled={busy} className="px-3.5 py-1.5 text-sm rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)]">
              Batal edit
            </button>
            <button onClick={() => setConfirm("simpanEdit")} disabled={busy} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50">
              <Save size={15} /> {busy ? "Menyimpan..." : "Simpan perubahan"}
            </button>
          </div>
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Barang", rows.length.toLocaleString("id-ID")],
          ["Sudah dihitung", `${counted} / ${rows.length}`],
          ["Ada selisih", withDiff.toLocaleString("id-ID")],
          ["Nilai selisih", rp(nilai)],
        ].map(([l, v]) => (
          <div key={l} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-3">
            <div className="text-xs text-[var(--text-secondary)]">{l}</div>
            <div className={`text-lg font-semibold ${l === "Nilai selisih" && nilai < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>{v}</div>
          </div>
        ))}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari barang / kode..." className={`${inputCls} pl-8`} />
          </div>
          <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className="text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white">
            <option value="">Semua barang</option>
            <option value="belum">Belum dihitung</option>
            <option value="selisih">Ada selisih</option>
          </select>
          <div className="ml-auto flex flex-wrap gap-2">
            <ExportButtons total={shown.length} buildReport={buildReport} fileName={`koperasi-opname-${id}`} />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table text-sm">
            <thead>
              <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
                <th className="px-3 py-2.5">Barang</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Stok sistem</th>
                <th className="px-3 py-2.5 text-right w-32">Fisik</th>
                <th className="px-3 py-2.5 text-right">Selisih</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Nilai selisih</th>
                <th className="px-3 py-2.5">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {shown.map((r) => {
                const s = selisihOf(r);
                const bad = editable && Number.isNaN(parseFisik(r.input) as number);
                return (
                  <tr key={r.kode}>
                    <td className="col-grow px-3 py-1.5">
                      <div className="text-[var(--text-primary)]">{r.nama}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">{r.kode}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {fmtQty(r.stok_sistem)} {r.satuan}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {editable ? (
                        <input
                          value={r.input}
                          onChange={(e) => set(r.kode, "input", e.target.value)}
                          inputMode="decimal"
                          placeholder="-"
                          className={`w-24 text-sm rounded border px-2 py-1 text-right ${bad ? "border-[var(--accent-red)]" : "border-[var(--border)]"}`}
                        />
                      ) : r.fisik === null ? (
                        <span className="text-[var(--text-muted)]">-</span>
                      ) : (
                        fmtQty(r.fisik)
                      )}
                    </td>
                    <td className={`px-3 py-1.5 text-right whitespace-nowrap font-semibold ${s ? (s < 0 ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]") : "text-[var(--text-muted)]"}`}>
                      {s === null ? "" : s === 0 ? "cocok" : `${s > 0 ? "+" : ""}${fmtQty(s)}`}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{s ? rp(s * r.harga_beli) : ""}</td>
                    <td className="px-3 py-1.5">
                      {editable ? (
                        <input value={r.ket} onChange={(e) => set(r.kode, "ket", e.target.value)} placeholder={s ? "alasan selisih" : ""} className="w-full min-w-[140px] text-sm rounded border border-[var(--border)] px-2 py-1" />
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">{r.keterangan}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {head.status === "DRAFT" && !editMode && (canInput || canEdit) && (
          <div className="flex flex-wrap items-center gap-2 p-3 border-t border-[var(--border)]">
            {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
            {note && <span className="text-xs text-[var(--accent-green)]">{note}</span>}
            {dirty && <span className="text-xs text-[var(--accent-amber)]">Ada hitungan yang belum disimpan</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              {canEdit && (
                <button onClick={() => setConfirm("batal")} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                  <XCircle size={16} /> Batalkan opname
                </button>
              )}
              {canInput && (
                <button onClick={simpan} disabled={busy || !dirty} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)] disabled:opacity-50">
                  <Save size={16} /> Simpan hitungan
                </button>
              )}
              {canEdit && (
                <button onClick={() => setConfirm("selesai")} disabled={busy || !counted} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50">
                  <CheckCircle2 size={16} /> Selesai & Koreksi Stok
                </button>
              )}
            </div>
            {!canEdit && <p className="w-full text-[11px] text-[var(--text-muted)]">Setelah selesai menghitung, minta akun dengan hak Edit Koperasi menekan "Selesai & Koreksi Stok".</p>}
          </div>
        )}
        {head.status !== "DRAFT" && note && <p className="p-3 text-xs text-[var(--accent-green)] border-t border-[var(--border)]">{note}</p>}
      </div>
      {confirm === "selesai" && (
        <ConfirmDialog
          title="Selesaikan stok opname?"
          message={`${withDiff} barang akan dikoreksi sesuai stok fisik (nilai selisih ${rp(nilai)}). ${rows.length - counted} barang yang belum dihitung tidak diubah. Ini tidak bisa diulang.`}
          confirmLabel="Ya, Selesai & Koreksi"
          onConfirm={selesai}
          onCancel={() => setConfirm("")}
        />
      )}
      {confirm === "hapus" && (
        <ConfirmDialog
          title={`Hapus stok opname #${id}?`}
          message={
            head.status === "SELESAI"
              ? `Opname ini beserta ${withDiff} koreksi stoknya dihapus: stok barang kembali seperti sebelum opname. Tidak bisa dibatalkan.`
              : "Opname ini dan hitungannya dihapus. Stok tidak berubah."
          }
          onConfirm={hapus}
          onCancel={() => setConfirm("")}
        />
      )}
      {confirm === "simpanEdit" && (
        <ConfirmDialog
          title="Simpan perubahan stok opname?"
          message={
            head.status === "SELESAI"
              ? `Koreksi stok opname ini dibukukan ulang: ${withDiff} barang, nilai selisih ${rp(nilai)}. Stok barang ikut berubah.`
              : "Tanggal, catatan dan hitungan disimpan."
          }
          confirmLabel="Ya, Simpan"
          onConfirm={simpanEdit}
          onCancel={() => setConfirm("")}
        />
      )}
      {confirm === "batal" && (
        <ConfirmDialog title="Batalkan stok opname?" message="Hitungan yang sudah diisi tidak dipakai. Stok tidak berubah." confirmLabel="Ya, Batalkan" onConfirm={batal} onCancel={() => setConfirm("")} />
      )}
    </div>
  );
}
