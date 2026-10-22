import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, FileText, PackageX, X } from "lucide-react";
import { api, errorText, type KlinikBatch, type KlinikExpiredBatch, type KlinikTarik, type PickerItem } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { EvidenceInput, EvidenceLink, useEvidenceEnabled } from "./EvidenceInput";
import { printTable } from "../lib/printTable";
import { isoDisplay, localToday } from "../lib/opname";

// Klinik > Expired & Rusak: obat / BHP past its expiry shows up here by itself (per batch); Tarik takes it
// out of its batch with a photo (quarantined, it can't go to a patient), a second account with Approve
// Klinik checks it (Setujui, or Tolak: the stock goes back), and what was approved is printed on the
// Berita Acara Pemusnahan, signed by the penanggung jawab, pemeriksa and two saksi. Obat expired /
// rusak is limbah medis (B3): destroyed by incinerator or a licensed third party, or returned.

export const TARIK_ALASAN: Record<string, string> = { EXPIRED: "Expired", RUSAK: "Rusak", RETUR: "Retur ke supplier" };
const STATUS: Record<string, { label: string; cls: string }> = {
  MENUNGGU: { label: "Menunggu pemeriksaan", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  DISETUJUI: { label: "Disetujui", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  DITOLAK: { label: "Ditolak, stok kembali", cls: "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]" },
};
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
const btnPrimary = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50";
const btnOutline = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[#f1f5f9]";
const hariLalu = (iso: string) => Math.round((Date.parse(localToday()) - Date.parse(iso)) / 86400000);
const batchText = (t: KlinikTarik) => (t.alloc ?? []).map((a) => (a.exp ? isoDisplay(a.exp) : "tanpa tanggal")).join(", ") || "-";
const waktu = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jakarta" });
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const periodeLabel = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1] ?? ""} ${p.slice(0, 4)}`;

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-lg mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
            {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// Tarik: one obat out of one batch (preset from an expired batch, or picked here for rusak / retur).
export function TarikModal({
  klinik,
  preset,
  onClose,
  onSuccess,
}: {
  klinik: string;
  preset?: { kode: string; nama: string; satuan: string; exp: string; qty: number };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fotoAktif = useEvidenceEnabled();
  const [alasan, setAlasan] = useState(preset ? "EXPIRED" : "RUSAK");
  const [cari, setCari] = useState("");
  const [pilihan, setPilihan] = useState<PickerItem[]>([]);
  const [obat, setObat] = useState<{ kode: string; nama: string; satuan: string } | null>(preset ? { kode: preset.kode, nama: preset.nama, satuan: preset.satuan } : null);
  const [batches, setBatches] = useState<KlinikBatch[]>([]);
  const [exp, setExp] = useState<string | null>(preset ? preset.exp : null);
  const [qty, setQty] = useState(preset ? String(preset.qty) : "");
  const [note, setNote] = useState(preset ? `Expired ${isoDisplay(preset.exp)}` : "");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (obat) return;
    const t = setTimeout(() => {
      api
        .klinikPickItems({ klinik, search: cari.trim(), page: 1, pageSize: 30 })
        .then((r) => setPilihan(r.data.filter((x) => x.stock_tersedia > 0)))
        .catch(() => setPilihan([]));
    }, 250);
    return () => clearTimeout(t);
  }, [cari, obat, klinik]);
  useEffect(() => {
    if (!obat) return setBatches([]);
    api
      .klinikBatches(klinik, obat.kode)
      .then((b) => {
        setBatches(b);
        if (exp === null && b.length === 1) setExp(b[0].expired_date);
      })
      .catch(() => setBatches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obat, klinik]);
  const batch = batches.find((b) => b.expired_date === exp);
  const save = async () => {
    const n = Number(qty);
    if (!obat) return setError("Pilih obat / barang");
    if (exp === null) return setError("Pilih batch-nya");
    if (!Number.isInteger(n) || n <= 0) return setError("Jumlah harus bilangan bulat lebih dari 0");
    if (batch && n > batch.qty) return setError(`Batch ini tinggal ${batch.qty}`);
    if (!note.trim()) return setError("Isi keterangannya");
    if (fotoAktif && !evidence) return setError("Foto wajib: tanggal expired / kerusakan dan jumlahnya terlihat");
    setBusy(true);
    setError("");
    try {
      await api.klinikTarik({ klinik, obat_kode: obat.kode, qty: n, expired_date: exp, alasan, note: note.trim(), evidence_id: evidence });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Tarik Obat / BHP" subtitle="Stoknya langsung dikarantina (tidak bisa keluar ke pasien), lalu diperiksa orang kedua" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(TARIK_ALASAN).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setAlasan(k)}
              className={`px-2 py-2 text-sm rounded-md border ${alasan === k ? "border-[var(--accent-blue)] bg-[#eef4ff] text-[var(--accent-blue)] font-medium" : "border-[var(--border)] text-[var(--text-secondary)]"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div>
          <label className={labelCls}>Obat / barang</label>
          {obat ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <span>
                {obat.nama} <span className="text-xs text-[var(--text-muted)]">{obat.kode}</span>
              </span>
              {!preset && (
                <button onClick={() => (setObat(null), setExp(null))} className="text-xs text-[var(--accent-blue)] hover:underline">
                  Ganti
                </button>
              )}
            </div>
          ) : (
            <>
              <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama / kode..." className={inputCls} autoFocus />
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
                {pilihan.map((x) => (
                  <button key={x.kode} onClick={() => setObat({ kode: x.kode, nama: x.nama, satuan: x.satuan })} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[#f8fafc]">
                    {x.nama} <span className="text-xs text-[var(--accent-green)]">stok {x.stock_tersedia.toLocaleString("id-ID")} {x.satuan}</span>
                  </button>
                ))}
                {!pilihan.length && <p className="px-3 py-2 text-xs text-[var(--text-muted)]">Tidak ada obat dengan stok.</p>}
              </div>
            </>
          )}
        </div>
        {obat && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Batch (tanggal expired)</label>
              <select value={exp ?? "\u0000"} onChange={(e) => setExp(e.target.value === "\u0000" ? null : e.target.value)} className={inputCls}>
                <option value={"\u0000"}>-- Pilih batch --</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.expired_date}>
                    {b.expired_date ? isoDisplay(b.expired_date) : "Tanpa tanggal"} · {b.qty.toLocaleString("id-ID")}
                    {b.expired_date && b.expired_date < localToday() ? " (expired)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Jumlah fisik ({obat.satuan})</label>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={inputCls} />
            </div>
          </div>
        )}
        <div>
          <label className={labelCls}>Keterangan</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={alasan === "RETUR" ? "mis. retur ke PBF ..., no. surat ..." : "mis. kemasan bocor"} className={inputCls} />
        </div>
        <EvidenceInput value={evidence} onChange={setEvidence} label="Foto (wajib: tanggal expired / kerusakan dan jumlahnya terlihat)" />
        <p className="text-[11px] text-[var(--text-muted)]">
          Simpan di kotak karantina berlabel "EXPIRED - JANGAN DIGUNAKAN", jangan dibuang ke sampah biasa: pemeriksa mencocokkan fisiknya, lalu dimusnahkan sebagai limbah medis (B3) atau diretur.
        </p>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnOutline}>
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Simpan, minta pemeriksaan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PeriksaModal({ t, onClose, onSuccess }: { t: KlinikTarik; onClose: () => void; onSuccess: () => void }) {
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kirim = async (setuju: boolean) => {
    if (!setuju && !catatan.trim()) return setError("Tulis alasan penolakannya");
    setBusy(true);
    setError("");
    try {
      await api.klinikPeriksaTarik(t.id, { setuju, catatan: catatan.trim() });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Periksa Obat / BHP Ditarik" subtitle="Cocokkan dengan barang di kotak karantina dan fotonya" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="rounded-md border border-[var(--border)] p-3 space-y-1">
          <div className="font-medium text-[var(--text-primary)]">
            {t.nama} <span className="text-xs text-[var(--text-muted)]">{t.kode}</span>
          </div>
          <div>
            <b>
              {t.qty.toLocaleString("id-ID")} {t.satuan}
            </b>{" "}
            · {TARIK_ALASAN[t.alasan ?? ""] ?? "Dibuang"} · batch {batchText(t)} · {waktu(t.created_at)}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {t.note} <EvidenceLink id={t.evidence_id} label="lihat foto" />
          </div>
          <div className="text-xs text-[var(--text-muted)]">diinput oleh {t.oleh || "-"}</div>
        </div>
        <ul className="text-xs text-[var(--text-secondary)] list-disc pl-4 space-y-0.5">
          <li>Jumlah fisik di kotak karantina sama dengan yang diinput?</li>
          <li>Tanggal expired di kemasan / kerusakannya sesuai foto dan batch-nya?</li>
          <li>Retur: sudah ada konfirmasi dari supplier?</li>
        </ul>
        <div>
          <label className={labelCls}>Catatan (wajib bila ditolak)</label>
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. fisik hanya 1, bukan 2" className={inputCls} />
        </div>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => kirim(false)}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)] disabled:opacity-50"
          >
            Tolak (stok kembali)
          </button>
          <button onClick={() => kirim(true)} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Setujui"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

async function cetakBeritaAcara(klinik: string, periode: string) {
  const all = await api.klinikTarikList({ klinik, status: "DISETUJUI", periode });
  if (!all.length) throw new Error(`Belum ada obat / BHP ditarik yang disetujui di ${periodeLabel(periode)}`);
  const uniq = (v: (string | null)[]) => [...new Set(v.filter(Boolean))].join(", ");
  printTable({
    title: "Berita Acara Pemusnahan / Retur Obat & BHP",
    subtitle: [
      `Klinik ${klinik} · Periode ${periodeLabel(periode)} · ${all.length} baris`,
      "Obat / BHP di bawah ini sudah diperiksa dan dicocokkan fisiknya. Cara: [ ] Insinerator   [ ] Pihak ketiga pengelola limbah B3, nama: .........................   [ ] Retur ke supplier: .........................   Tanggal: ....................",
    ],
    columns: [
      { label: "No", align: "right" },
      { label: "Tanggal" },
      { label: "Kode" },
      { label: "Nama Obat / BHP" },
      { label: "Batch (Exp)" },
      { label: "Jumlah", align: "right" },
      { label: "Alasan" },
      { label: "Keterangan" },
      { label: "Input / Diperiksa" },
    ],
    rows: all.map((t, i) => [
      i + 1,
      waktu(t.created_at),
      t.kode,
      t.nama,
      batchText(t),
      `${t.qty.toLocaleString("id-ID")} ${t.satuan}`,
      TARIK_ALASAN[t.alasan ?? ""] ?? "Expired (dibuang)",
      t.note ?? "",
      `${t.oleh || "-"} / ${t.diperiksa_nama || "-"}`,
    ]),
    landscape: true,
    signatures: [
      { label: "Penanggung Jawab Klinik", nama: "" },
      { label: "Pemeriksa", nama: uniq(all.map((t) => t.diperiksa_nama)) },
      { label: "Saksi 1", nama: "" },
      { label: "Saksi 2", nama: "" },
      { label: "Mengetahui", nama: "" },
    ],
  });
}

export function KlinikRusakTab({ klinik, refreshKey, onChanged }: { klinik: string; refreshKey: number; onChanged: () => void }) {
  const { user } = useAuth();
  const canInput = can(user, "klinik.input");
  const canApprove = can(user, "klinik.approve");
  const [periode, setPeriode] = useState(localToday().slice(0, 7));
  const [status, setStatus] = useState("");
  const [expired, setExpired] = useState<KlinikExpiredBatch[]>([]);
  const [rows, setRows] = useState<KlinikTarik[] | null>(null);
  const [tarik, setTarik] = useState<{ preset?: KlinikExpiredBatch } | null>(null);
  const [periksa, setPeriksa] = useState<KlinikTarik | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const done = () => {
    setTarik(null);
    setPeriksa(null);
    setReload((n) => n + 1);
    onChanged();
  };
  useEffect(() => {
    api
      .klinikExpired(klinik)
      .then(setExpired)
      .catch(() => setExpired([]));
  }, [klinik, reload, refreshKey]);
  useEffect(() => {
    setRows(null);
    api
      .klinikTarikList({ klinik, status, periode: status === "MENUNGGU" ? "" : periode })
      .then(setRows)
      .catch(() => setRows([]));
  }, [klinik, status, periode, reload, refreshKey]);

  return (
    <div className="space-y-4">
      {expired.length > 0 && (
        <div className="bg-[var(--bg-card)] border border-[var(--accent-red-border)] rounded-lg">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] rounded-t-lg">
            <CalendarClock size={18} className="text-[var(--accent-red)]" />
            <h2 className="text-sm font-semibold text-[var(--accent-red)]">Expired, perlu ditarik ({expired.length} batch)</h2>
            <span className="text-xs text-[var(--accent-red)] opacity-90">Masih tercatat sebagai stok. Pisahkan ke kotak karantina, hitung, foto, lalu klik Tarik.</span>
          </div>
          <div className="table-scroll">
            <table className="data-table text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-secondary)]">
                  <th className="px-3 py-2">Obat / BHP</th>
                  <th className="px-3 py-2">Batch (Exp)</th>
                  <th className="px-3 py-2 text-right">Stok</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {expired.map((b) => (
                  <tr key={`${b.kode}-${b.expired_date}`}>
                    <td className="col-grow px-3 py-2">
                      <div className="text-[var(--text-primary)]">{b.nama}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">{b.kode}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--accent-red)]">
                      {isoDisplay(b.expired_date)} ({hariLalu(b.expired_date)} hari lalu)
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-semibold text-[var(--accent-red)]">
                      {b.qty.toLocaleString("id-ID")} {b.satuan}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canInput ? (
                        <button onClick={() => setTarik({ preset: b })} className="text-xs px-2.5 py-1 rounded-md bg-[var(--accent-red)] text-white hover:opacity-90">
                          Tarik
                        </button>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">perlu hak Input Klinik</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mr-2">Obat / BHP ditarik</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white" aria-label="Status">
            <option value="">Semua status</option>
            <option value="MENUNGGU">Menunggu pemeriksaan</option>
            <option value="DISETUJUI">Disetujui</option>
            <option value="DITOLAK">Ditolak</option>
          </select>
          {status !== "MENUNGGU" && (
            <input type="month" value={periode} max={localToday().slice(0, 7)} onChange={(e) => e.target.value && setPeriode(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white" aria-label="Periode" />
          )}
          {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => (setError(""), cetakBeritaAcara(klinik, periode).catch((e) => setError(errorText(e, "Gagal mencetak"))))}
              className={btnOutline}
              title="Yang sudah disetujui di periode ini, dengan kolom cara pemusnahan dan tanda tangan"
            >
              <FileText size={15} /> Berita Acara
            </button>
            {canInput && (
              <button onClick={() => setTarik({})} className={btnPrimary}>
                <PackageX size={15} /> Tarik obat rusak / retur
              </button>
            )}
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table text-sm">
            <thead>
              <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
                <th className="px-3 py-2.5">Tanggal</th>
                <th className="px-3 py-2.5">Obat / BHP</th>
                <th className="px-3 py-2.5">Batch (Exp)</th>
                <th className="px-3 py-2.5 text-right">Jumlah</th>
                <th className="px-3 py-2.5">Keterangan</th>
                <th className="px-3 py-2.5">Pemeriksaan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows === null ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[var(--text-muted)]">
                    Belum ada obat / BHP ditarik{status === "MENUNGGU" ? " yang menunggu pemeriksaan" : ` di ${periodeLabel(periode)}`}.
                  </td>
                </tr>
              ) : (
                rows.map((t) => {
                  const st = STATUS[t.status ?? "DISETUJUI"];
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{waktu(t.created_at)}</td>
                      <td className="col-grow px-3 py-2">
                        <div className="text-[var(--text-primary)]">{t.nama}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">{t.kode}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{batchText(t)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {t.qty.toLocaleString("id-ID")} {t.satuan}
                      </td>
                      <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">
                        <div>
                          <span className={`mr-1 text-[10px] px-1.5 py-0.5 rounded border ${t.alasan === "RETUR" ? "border-[var(--border)]" : "border-[var(--accent-red-border)] text-[var(--accent-red)]"}`}>
                            {TARIK_ALASAN[t.alasan ?? ""] ?? "Dibuang"}
                          </span>
                          {t.note || "-"} <EvidenceLink id={t.evidence_id} label="foto" />
                        </div>
                        <div className="text-[var(--text-muted)]">oleh {t.oleh || "-"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${st.cls}`}>{st.label}</span>
                        {t.status && t.status !== "MENUNGGU" && (
                          <div className="mt-1 text-[var(--text-muted)]">
                            oleh {t.diperiksa_nama || "-"}
                            {t.diperiksa_catatan && <span className="block text-[var(--text-secondary)]">{t.diperiksa_catatan}</span>}
                          </div>
                        )}
                        {t.status === "MENUNGGU" &&
                          (canApprove && t.user_id !== user?.id ? (
                            <button onClick={() => setPeriksa(t)} className="mt-1 block text-[11px] px-2 py-0.5 rounded border border-[var(--accent-blue)] text-[var(--accent-blue)] hover:bg-[#eef4ff]">
                              Periksa
                            </button>
                          ) : (
                            <div className="mt-1 text-[var(--text-muted)]">{t.user_id === user?.id ? "diperiksa orang lain" : "perlu hak Approve Klinik"}</div>
                          ))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {tarik && (
        <TarikModal
          klinik={klinik}
          preset={tarik.preset && { kode: tarik.preset.kode, nama: tarik.preset.nama, satuan: tarik.preset.satuan, exp: tarik.preset.expired_date, qty: tarik.preset.qty }}
          onClose={() => setTarik(null)}
          onSuccess={done}
        />
      )}
      {periksa && <PeriksaModal t={periksa} onClose={() => setPeriksa(null)} onSuccess={done} />}
    </div>
  );
}
