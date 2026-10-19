import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Banknote, Boxes, HandCoins, Package, PackageX, Pencil, Plus, Search, ShoppingBasket, Trash2, Truck, UserPlus, Users, X } from "lucide-react";
import {
  api,
  errorText,
  type KopAnggota,
  type KopBarang,
  type KopBayar,
  type KopRekap,
  type KopRingkasan,
  type KopTx,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EvidenceInput, EvidenceLink } from "../components/EvidenceInput";
import { fmtQty, isoDisplay, localToday } from "../lib/opname";

// Koperasi karyawan Nilam: anggota (karyawan) take goods, deducted from the salary of the month taken
// (periode = calendar month), up to Rp 1,5 juta a month, no cicilan; Kantor / Mess Tamu are billed to the company. The koperasi
// buys goods in (Pembelian) and writes off what spoiled (Barang Rusak). Stock = beli - jual - rusak.
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const btnPrimary = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50";
const btnOutline =
  "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)] disabled:opacity-50";

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const periodeLabel = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1] ?? ""} ${p.slice(0, 4)}`;
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const num = (n: number) => Math.round(n).toLocaleString("id-ID");
const BAYAR_LABEL: Record<KopBayar, string> = { POTONG_GAJI: "Potong Gaji", TUNAI: "Tunai", INSTANSI: "Instansi" };
const BAYAR_CLS: Record<KopBayar, string> = {
  POTONG_GAJI: "bg-[var(--accent-blue-bg)] border-[var(--accent-blue-border)] text-[var(--accent-blue)]",
  TUNAI: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]",
  INSTANSI: "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-secondary)]",
};
// Number typed the Indonesian way ("1.500" or "2,5").
const parseNum = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

type Tab = "jual" | "rekap" | "stok" | "beli" | "anggota";
const TABS: { key: Tab; label: string; icon: typeof Package }[] = [
  { key: "jual", label: "Pengambilan", icon: ShoppingBasket },
  { key: "rekap", label: "Rekap Potong Gaji", icon: HandCoins },
  { key: "stok", label: "Stok Barang", icon: Boxes },
  { key: "beli", label: "Pembelian & Rusak", icon: Truck },
  { key: "anggota", label: "Anggota", icon: Users },
];

export function KoperasiPage() {
  const { user } = useAuth();
  const canInput = can(user, "koperasi.input");
  const canEdit = can(user, "koperasi.edit");
  const [tab, setTab] = useState<Tab>("jual");
  const [periodes, setPeriodes] = useState<string[]>([]);
  const [periode, setPeriode] = useState(localToday().slice(0, 7));
  const [ringkasan, setRingkasan] = useState<KopRingkasan | null>(null);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<"" | "jual" | "beli" | "rusak">("");

  useEffect(() => {
    api.kopPeriode().then(setPeriodes).catch(() => setPeriodes([]));
  }, [reload]);
  useEffect(() => {
    api.kopRingkasan(periode).then(setRingkasan).catch(() => setRingkasan(null));
  }, [periode, reload]);
  const done = () => {
    setModal("");
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Koperasi Karyawan Nilam</h1>
          <p className="text-sm text-[var(--text-secondary)]">Pengambilan barang oleh karyawan, dipotong dari gaji bulan itu (limit Rp 1.500.000 per bulan)</p>
        </div>
        {canInput && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setModal("rusak")} className={btnOutline}>
              <PackageX size={16} /> Barang Rusak
            </button>
            <button onClick={() => setModal("beli")} className={btnOutline}>
              <Truck size={16} /> Catat Pembelian
            </button>
            <button onClick={() => setModal("jual")} className={btnPrimary}>
              <Plus size={16} /> Input Pengambilan
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[var(--text-secondary)]">Periode gaji</label>
        <select value={periode} onChange={(e) => setPeriode(e.target.value)} className={selectCls} aria-label="Periode">
          {(periodes.length ? periodes : [periode]).map((p) => (
            <option key={p} value={p}>
              {periodeLabel(p)}
            </option>
          ))}
        </select>
      </div>

      {ringkasan && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label={`Pengambilan ${periodeLabel(periode)}`}
            value={rp(ringkasan.jual)}
            icon={ShoppingBasket}
            tone="blue"
            footer={<span className="text-[11px] text-[var(--text-muted)]">{ringkasan.anggota} anggota/instansi</span>}
          />
          <StatCard
            label="Potong Gaji"
            value={rp(ringkasan.potong_gaji)}
            icon={HandCoins}
            tone="amber"
            onClick={() => setTab("rekap")}
            title="Buka Rekap Potong Gaji"
            footer={
              <span className="text-[11px] text-[var(--text-muted)]">
                Tunai {rp(ringkasan.tunai)} · Instansi {rp(ringkasan.instansi)}
              </span>
            }
          />
          <StatCard label={`Pembelian ${periodeLabel(periode)}`} value={rp(ringkasan.beli)} icon={Truck} tone="green" onClick={() => setTab("beli")} title="Buka Pembelian" />
          <StatCard
            label="Nilai Stok (harga beli)"
            value={rp(ringkasan.nilai_stok)}
            icon={Boxes}
            tone={ringkasan.menipis ? "red" : "green"}
            onClick={() => setTab("stok")}
            title="Buka Stok Barang"
            footer={<span className={`text-[11px] ${ringkasan.menipis ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]"}`}>{ringkasan.menipis} barang stok menipis / habis</span>}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm -mb-px border-b-2 ${
              tab === t.key ? "border-[var(--accent-blue)] text-[var(--accent-blue)] font-medium" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "jual" && <TxTable jenis="JUAL" periode={periode} reload={reload} canEdit={canEdit} onChanged={done} />}
      {tab === "rekap" && <RekapTab periode={periode} reload={reload} />}
      {tab === "stok" && <StokTab reload={reload} canEdit={canEdit} onChanged={done} />}
      {tab === "beli" && (
        <div className="space-y-4">
          <TxTable jenis="BELI" periode={periode} reload={reload} canEdit={canEdit} onChanged={done} />
          <h2 className="text-sm font-semibold text-[var(--text-primary)] pt-2">Barang Rusak / Dibuang</h2>
          <TxTable jenis="RUSAK" periode={periode} reload={reload} canEdit={canEdit} onChanged={done} />
        </div>
      )}
      {tab === "anggota" && <AnggotaTab reload={reload} canEdit={canEdit} onChanged={done} />}

      {modal === "jual" && <JualModal onClose={() => setModal("")} onSuccess={done} />}
      {modal === "beli" && <BeliModal onClose={() => setModal("")} onSuccess={done} />}
      {modal === "rusak" && <RusakModal onClose={() => setModal("")} onSuccess={done} />}
    </div>
  );
}

// ---- Transaksi (Pengambilan / Pembelian / Rusak), 100 per page ----
function TxTable({
  jenis,
  periode,
  anggota,
  barang,
  reload,
  canEdit,
  onChanged,
}: {
  jenis: "JUAL" | "BELI" | "RUSAK" | "";
  periode: string;
  anggota?: string;
  barang?: string;
  reload: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<{ data: KopTx[]; total: number; sum_total: number; sum_qty: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hapus, setHapus] = useState<{ tx: KopTx; bon: boolean } | null>(null);
  const [error, setError] = useState("");
  const pageSize = 100;
  const params = useMemo(() => ({ jenis, periode, anggota: anggota ?? "", barang: barang ?? "", search: q }), [jenis, periode, anggota, barang, q]);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [params]);
  useEffect(() => {
    setLoading(true);
    api
      .kopTx({ ...params, page, pageSize })
      .then(setRes)
      .catch(() => setRes(null))
      .finally(() => setLoading(false));
  }, [params, page, reload]);

  const doHapus = async () => {
    if (!hapus) return;
    setError("");
    try {
      await api.kopHapus(hapus.tx.id, hapus.bon);
      setHapus(null);
      onChanged();
    } catch (e) {
      setHapus(null);
      setError(errorText(e, "Gagal menghapus"));
    }
  };

  const jual = jenis === "JUAL";
  const beli = jenis === "BELI";
  const rusak = jenis === "RUSAK";
  const cols = [
    "Tanggal",
    ...(jual || !jenis ? ["Anggota"] : []),
    ...(beli ? ["No PO"] : []),
    "Barang",
    "Jumlah",
    ...(rusak ? [] : ["Harga", "Total"]),
    ...(jual ? ["Bayar"] : []),
    "Keterangan",
  ];
  const label = jual ? "pengambilan" : beli ? "pembelian" : rusak ? "barang rusak" : "transaksi";
  const pages = Math.max(1, Math.ceil((res?.total ?? 0) / pageSize));
  const buildReport = async () => {
    const all = await api.kopTx({ ...params, page: 1, pageSize: 500 });
    let rows = all.data;
    for (let p = 2; rows.length < all.total && p <= 40; p++) rows = rows.concat((await api.kopTx({ ...params, page: p, pageSize: 500 })).data);
    return {
      title: `Koperasi Nilam - ${jual ? "Pengambilan" : beli ? "Pembelian" : rusak ? "Barang Rusak" : "Riwayat"}`,
      subtitle: [periode ? `Periode ${periodeLabel(periode)}` : "Semua periode", ...(q ? [`Cari: ${q}`] : [])],
      landscape: true,
      columns: cols.map((c) => ({ label: c, align: ["Jumlah", "Harga", "Total"].includes(c) ? ("right" as const) : undefined })),
      rows: rows.map((t) => [
        isoDisplay(t.tanggal_iso),
        ...(jual || !jenis ? [t.anggota_kode ? `${t.anggota_nama || "-"} (${t.anggota_kode})` : "-"] : []),
        ...(beli ? [t.no_po] : []),
        t.barang_nama,
        `${fmtQty(t.qty)} ${t.satuan}`,
        ...(rusak ? [] : [t.harga, t.total]),
        ...(jual ? [BAYAR_LABEL[t.bayar]] : []),
        t.keterangan,
      ]),
    };
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Cari ${jual ? "nama / NIK / barang" : "barang / keterangan"}...`} className={`${inputCls} pl-8`} />
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          {(res?.total ?? 0).toLocaleString("id-ID")} baris{!rusak && res ? ` · ${rp(res.sum_total)}` : ""}
        </span>
        {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
        <div className="ml-auto flex gap-2">
          <ExportButtons total={res?.total ?? 0} buildReport={buildReport} fileName={`koperasi-${label.replace(/ /g, "-")}-${periode}`} />
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              {cols.map((c) => (
                <th key={c} className={`px-3 py-2.5 whitespace-nowrap ${["Jumlah", "Harga", "Total"].includes(c) ? "text-right" : ""}`}>
                  {c}
                </th>
              ))}
              {canEdit && <th className="px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading ? (
              <tr>
                <td colSpan={cols.length + 1} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !res?.data.length ? (
              <tr>
                <td colSpan={cols.length + 1} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  Belum ada {label}
                  {periode ? ` di ${periodeLabel(periode)}` : ""}.
                </td>
              </tr>
            ) : (
              res.data.map((t, i) => {
                // A bon's lines sit together; its date / anggota are shown once.
                const sameBon = jual && i > 0 && t.bon && res.data[i - 1].bon === t.bon;
                return (
                  <tr key={t.id} className={`align-top ${sameBon ? "" : jual && i > 0 ? "border-t-2 border-t-[var(--border)]" : ""}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{sameBon ? "" : isoDisplay(t.tanggal_iso)}</td>
                    {(jual || !jenis) && (
                      <td className="px-3 py-2">
                        {!sameBon && t.anggota_kode && (
                          <>
                            <div className="font-medium text-[var(--text-primary)]">{t.anggota_nama || <span className="italic text-[var(--text-muted)]">nama tidak tercatat</span>}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">{t.anggota_kode}</div>
                          </>
                        )}
                      </td>
                    )}
                    {beli && <td className="px-3 py-2 whitespace-nowrap">{t.no_po || "-"}</td>}
                    <td className="col-grow px-3 py-2">
                      <div className="text-[var(--text-primary)]">{t.barang_nama}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {t.barang_kode}
                        {!jenis && ` · ${t.jenis === "JUAL" ? "Pengambilan" : t.jenis === "BELI" ? "Pembelian" : "Rusak"}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {fmtQty(t.qty)} {t.satuan}
                    </td>
                    {!rusak && <td className="px-3 py-2 text-right whitespace-nowrap">{num(t.harga)}</td>}
                    {!rusak && <td className="px-3 py-2 text-right whitespace-nowrap font-medium">{num(t.total)}</td>}
                    {jual && (
                      <td className="px-3 py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${BAYAR_CLS[t.bayar]}`}>{BAYAR_LABEL[t.bayar]}</span>
                      </td>
                    )}
                    <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">
                      <div>
                        {t.keterangan || (t.sumber?.startsWith("IMPORT") ? "" : "-")} <EvidenceLink id={t.evidence_id} label="foto" />
                      </div>
                      <div className="text-[var(--text-muted)]">{t.sumber?.startsWith("IMPORT") ? "dari spreadsheet" : `oleh ${t.oleh || "-"}`}</div>
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setHapus({ tx: t, bon: false })} title="Hapus baris ini" className="p-1.5 rounded-md text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                          <Trash2 size={14} />
                        </button>
                        {jual && t.bon && !sameBon && (
                          <button onClick={() => setHapus({ tx: t, bon: true })} title="Hapus seluruh bon" className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                            bon
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2.5 py-1 rounded-md border border-[var(--border)] disabled:opacity-40">
            Sebelumnya
          </button>
          <span>
            {page} / {pages}
          </span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-2.5 py-1 rounded-md border border-[var(--border)] disabled:opacity-40">
            Berikutnya
          </button>
        </div>
      )}
      {hapus && (
        <ConfirmDialog
          message={
            hapus.bon
              ? `Hapus seluruh bon ${hapus.tx.anggota_nama || hapus.tx.anggota_kode} tanggal ${isoDisplay(hapus.tx.tanggal_iso)}? Stok barangnya kembali.`
              : `Hapus ${hapus.tx.barang_nama} ${fmtQty(hapus.tx.qty)} ${hapus.tx.satuan} (${isoDisplay(hapus.tx.tanggal_iso)})?`
          }
          onConfirm={doHapus}
          onCancel={() => setHapus(null)}
        />
      )}
    </div>
  );
}

// ---- Rekap Potong Gaji: per anggota for the periode, to send to HRD / payroll ----
function RekapTab({ periode, reload }: { periode: string; reload: number }) {
  const [rows, setRows] = useState<KopRekap[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [detail, setDetail] = useState<KopRekap | null>(null);
  const [filter, setFilter] = useState<"" | "POTONG_GAJI" | "INSTANSI">("POTONG_GAJI");
  useEffect(() => {
    setRows(null);
    api
      .kopRekap(periode)
      .then((r) => (setRows(r.data), setLimit(r.limit)))
      .catch(() => setRows([]));
  }, [periode, reload]);
  const shown = (rows ?? []).filter((r) => (filter === "POTONG_GAJI" ? r.potong_gaji > 0 : filter === "INSTANSI" ? r.instansi > 0 : true));
  const sum = (k: "potong_gaji" | "tunai" | "instansi" | "total") => shown.reduce((s, r) => s + r[k], 0);
  const lewat = (r: KopRekap) => limit > 0 && r.potong_gaji > limit;
  const nLewat = shown.filter(lewat).length;
  const buildReport = async () => ({
    title: `Rekap Potong Gaji Koperasi Nilam - ${periodeLabel(periode)}`,
    subtitle: [filter === "POTONG_GAJI" ? "Karyawan dengan potong gaji" : filter === "INSTANSI" ? "Instansi (ditagih ke kantor)" : "Semua anggota"],
    columns: [
      { label: "No" },
      { label: "NIK" },
      { label: "Nama" },
      { label: "Jabatan" },
      { label: "Estate / Divisi" },
      { label: "Jml Bon", align: "right" as const },
      { label: "Potong Gaji", align: "right" as const },
      { label: "Tunai", align: "right" as const },
      { label: "Instansi", align: "right" as const },
      { label: "Total", align: "right" as const },
    ],
    rows: [
      ...shown.map((r, i) => [i + 1, r.kode, r.nama || "-", r.jabatan, [r.estate, r.divisi].filter(Boolean).join(" / "), r.n_bon, r.potong_gaji, r.tunai, r.instansi, r.total]),
      ["", "", "TOTAL", "", "", shown.reduce((s, r) => s + r.n_bon, 0), sum("potong_gaji"), sum("tunai"), sum("instansi"), sum("total")],
    ],
  });

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={selectCls} aria-label="Filter">
          <option value="POTONG_GAJI">Potong gaji</option>
          <option value="INSTANSI">Instansi (Kantor, Mess)</option>
          <option value="">Semua</option>
        </select>
        <span className="text-xs text-[var(--text-muted)]">
          {shown.length} orang · Potong gaji <b className="text-[var(--text-primary)]">{rp(sum("potong_gaji"))}</b>
          {limit > 0 && ` · limit ${rp(limit)}/orang`}
          {nLewat > 0 && <b className="text-[var(--accent-red)]"> · {nLewat} melebihi limit</b>}
        </span>
        <div className="ml-auto flex gap-2">
          <ExportButtons total={shown.length} buildReport={buildReport} fileName={`koperasi-potong-gaji-${periode}`} />
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              <th className="px-3 py-2.5">No</th>
              <th className="px-3 py-2.5">NIK</th>
              <th className="px-3 py-2.5">Nama</th>
              <th className="px-3 py-2.5">Jabatan</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Estate / Divisi</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Jml Bon</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Potong Gaji</th>
              <th className="px-3 py-2.5 text-right">Tunai</th>
              <th className="px-3 py-2.5 text-right">Instansi</th>
              <th className="px-3 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows === null ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  Belum ada pengambilan di {periodeLabel(periode)}.
                </td>
              </tr>
            ) : (
              <>
                {shown.map((r, i) => (
                  <tr key={r.kode} onClick={() => setDetail(r)} className="cursor-pointer hover:bg-[#f8fafc]" title="Lihat rincian">
                    <td className="px-3 py-2 text-[var(--text-muted)]">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.kode}</td>
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                      {r.nama || <span className="italic text-[var(--text-muted)]">nama tidak tercatat</span>}
                      {r.jenis === "KARYAWAN" && !r.di_master && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]">tidak di master karyawan</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.jabatan || "-"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{[r.estate, r.divisi].filter(Boolean).join(" / ") || "-"}</td>
                    <td className="px-3 py-2 text-right">{r.n_bon}</td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${lewat(r) ? "text-[var(--accent-red)]" : ""}`} title={lewat(r) ? "Melebihi limit per bulan" : undefined}>
                      {r.potong_gaji ? num(r.potong_gaji) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.tunai ? num(r.tunai) : "-"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{r.instansi ? num(r.instansi) : "-"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{num(r.total)}</td>
                  </tr>
                ))}
                <tr className="bg-[#f8fafc] font-semibold">
                  <td colSpan={5} className="px-3 py-2 text-right">
                    TOTAL
                  </td>
                  <td className="px-3 py-2 text-right">{shown.reduce((s, r) => s + r.n_bon, 0)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{num(sum("potong_gaji"))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{num(sum("tunai"))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{num(sum("instansi"))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{num(sum("total"))}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {detail && (
        <Modal title={`${detail.nama || detail.kode} · ${periodeLabel(periode)}`} subtitle={`${detail.kode} · total ${rp(detail.total)}`} onClose={() => setDetail(null)} wide>
          <TxTable jenis="JUAL" periode={periode} anggota={detail.kode} reload={reload} canEdit={false} onChanged={() => {}} />
        </Modal>
      )}
    </div>
  );
}

// ---- Stok Barang ----
function StokTab({ reload, canEdit, onChanged }: { reload: number; canEdit: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<KopBarang[] | null>(null);
  const [search, setSearch] = useState("");
  const [aktif, setAktif] = useState("1");
  const [only, setOnly] = useState<"" | "ada" | "menipis">("");
  const [editing, setEditing] = useState<KopBarang | "new" | null>(null);
  const [riwayat, setRiwayat] = useState<KopBarang | null>(null);
  useEffect(() => {
    setRows(null);
    api
      .kopBarang({ aktif })
      .then(setRows)
      .catch(() => setRows([]));
  }, [aktif, reload]);
  const q = search.trim().toLowerCase();
  const menipis = (b: KopBarang) => b.lacak_stok && b.stok <= b.stok_min;
  const shown = (rows ?? []).filter(
    (b) => (!q || b.nama.toLowerCase().includes(q) || b.kode.toLowerCase().includes(q)) && (only === "ada" ? b.stok > 0 : only === "menipis" ? menipis(b) : true)
  );
  const buildReport = async () => ({
    title: "Stok Barang Koperasi Nilam",
    subtitle: [`Per ${isoDisplay(localToday())}`],
    columns: [
      { label: "Kode" },
      { label: "Nama Barang" },
      { label: "Stok", align: "right" as const },
      { label: "Satuan" },
      { label: "Harga Beli", align: "right" as const },
      { label: "Harga Jual", align: "right" as const },
      { label: "Nilai Stok", align: "right" as const },
    ],
    rows: shown.map((b) => [b.kode, b.nama, b.lacak_stok ? b.stok : "tidak dilacak", b.satuan, b.harga_beli, b.harga_jual, b.lacak_stok ? Math.max(b.stok, 0) * b.harga_beli : ""]),
  });

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari barang / kode..." className={`${inputCls} pl-8`} />
        </div>
        <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className={selectCls} aria-label="Stok">
          <option value="">Semua stok</option>
          <option value="ada">Ada stok</option>
          <option value="menipis">Menipis / habis</option>
        </select>
        <select value={aktif} onChange={(e) => setAktif(e.target.value)} className={selectCls} aria-label="Status">
          <option value="1">Barang aktif</option>
          <option value="0">Tidak aktif</option>
          <option value="">Semua</option>
        </select>
        <span className="text-xs text-[var(--text-muted)]">{shown.length} barang</span>
        <div className="ml-auto flex gap-2">
          <ExportButtons total={shown.length} buildReport={buildReport} fileName="koperasi-stok" />
          {canEdit && (
            <button onClick={() => setEditing("new")} className={btnPrimary}>
              <Plus size={16} /> Barang Baru
            </button>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              <th className="px-3 py-2.5">Kode</th>
              <th className="px-3 py-2.5">Nama Barang</th>
              <th className="px-3 py-2.5 text-right">Stok</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Harga Beli</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Harga Jual</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Terakhir Bergerak</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  Tidak ada barang.
                </td>
              </tr>
            ) : (
              shown.map((b) => (
                <tr key={b.kode}>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--text-muted)]">{b.kode}</td>
                  <td className="col-grow px-3 py-2 font-medium text-[var(--text-primary)]">
                    {b.nama}
                    {!b.aktif && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#f1f5f9] text-[var(--text-secondary)]">tidak aktif</span>}
                  </td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${!b.lacak_stok ? "text-[var(--text-muted)]" : menipis(b) ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>
                    {b.lacak_stok ? `${fmtQty(b.stok)} ${b.satuan}` : <span className="text-xs font-normal">tidak dilacak</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{num(b.harga_beli)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{num(b.harga_jual)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--text-secondary)]">{b.terakhir ? isoDisplay(b.terakhir) : "-"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setRiwayat(b)} className="text-xs text-[var(--accent-blue)] hover:underline mr-2">
                      Riwayat
                    </button>
                    {canEdit && (
                      <button onClick={() => setEditing(b)} title="Edit barang" className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                        <Pencil size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {editing && <BarangModal barang={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSuccess={() => (setEditing(null), onChanged())} />}
      {riwayat && (
        <Modal title={riwayat.nama} subtitle={`${riwayat.kode} · stok ${riwayat.lacak_stok ? `${fmtQty(riwayat.stok)} ${riwayat.satuan}` : "tidak dilacak"}`} onClose={() => setRiwayat(null)} wide>
          <TxTable jenis="" periode="" barang={riwayat.kode} reload={reload} canEdit={false} onChanged={() => {}} />
        </Modal>
      )}
    </div>
  );
}

function BarangModal({ barang, onClose, onSuccess }: { barang: KopBarang | null; onClose: () => void; onSuccess: () => void }) {
  const [f, setF] = useState({
    nama: barang?.nama ?? "",
    satuan: barang?.satuan ?? "PCS",
    harga_beli: String(barang?.harga_beli ?? ""),
    harga_jual: String(barang?.harga_jual ?? ""),
    stok_min: String(barang?.stok_min ?? 0),
    aktif: barang?.aktif ?? true,
    lacak_stok: barang?.lacak_stok ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.kopSaveBarang(barang?.kode ?? null, {
        nama: f.nama,
        satuan: f.satuan,
        harga_beli: parseNum(f.harga_beli || "0"),
        harga_jual: parseNum(f.harga_jual || "0"),
        stok_min: parseNum(f.stok_min || "0"),
        aktif: f.aktif,
        lacak_stok: f.lacak_stok,
      });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan barang"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={barang ? `Edit ${barang.kode}` : "Barang Baru"} subtitle={barang ? undefined : "Kode dibuat otomatis (K....)"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Nama barang</label>
          <input value={f.nama} onChange={set("nama")} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Satuan</label>
            <input value={f.satuan} onChange={set("satuan")} className={inputCls} placeholder="PCS / BKS / BTL / KG" />
          </div>
          <div>
            <label className={labelCls}>Stok minimum (peringatan)</label>
            <input value={f.stok_min} onChange={set("stok_min")} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Harga beli (Rp)</label>
            <input value={f.harga_beli} onChange={set("harga_beli")} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Harga jual ke anggota (Rp)</label>
            <input value={f.harga_jual} onChange={set("harga_jual")} inputMode="decimal" className={inputCls} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.lacak_stok} onChange={set("lacak_stok")} /> Lacak stok (matikan untuk barang yang tidak dibeli, mis. air galon depo)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.aktif} onChange={set("aktif")} /> Aktif (muncul di form pengambilan / pembelian)
        </label>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Anggota ----
function AnggotaTab({ reload, canEdit, onChanged }: { reload: number; canEdit: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<KopAnggota[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("aktif");
  const [editing, setEditing] = useState<KopAnggota | "new" | null>(null);
  const [riwayat, setRiwayat] = useState<KopAnggota | null>(null);
  useEffect(() => {
    setRows(null);
    api
      .kopAnggota({ status })
      .then(setRows)
      .catch(() => setRows([]));
  }, [status, reload]);
  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter((a) => !q || a.kode.toLowerCase().includes(q) || a.nama.toLowerCase().includes(q) || a.jabatan.toLowerCase().includes(q));
  const keluar = (rows ?? []).filter((a) => a.jenis === "KARYAWAN" && !a.di_master).length;
  const buildReport = async () => ({
    title: "Anggota Koperasi Nilam",
    subtitle: [status === "aktif" ? "Anggota aktif" : status === "nonaktif" ? "Anggota tidak aktif" : "Semua anggota"],
    columns: [
      { label: "NIK / Kode" },
      { label: "Nama" },
      { label: "Jenis" },
      { label: "Jabatan" },
      { label: "Estate" },
      { label: "Divisi" },
      { label: "Di Master Karyawan" },
      { label: "Terakhir Ambil" },
      { label: "Bulan Ini", align: "right" as const },
    ],
    rows: shown.map((a) => [a.kode, a.nama, a.jenis === "INSTANSI" ? "Instansi" : "Karyawan", a.jabatan, a.estate, a.divisi, a.jenis === "INSTANSI" ? "-" : a.di_master ? "Ya" : "Tidak", a.terakhir ? isoDisplay(a.terakhir) : "", a.total_bulan_ini ?? 0]),
  });

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama / NIK / jabatan..." className={`${inputCls} pl-8`} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
          <option value="aktif">Aktif</option>
          <option value="nonaktif">Tidak aktif (keluar)</option>
          <option value="">Semua</option>
        </select>
        <span className="text-xs text-[var(--text-muted)]">
          {shown.length} anggota{status !== "nonaktif" && keluar ? ` · ${keluar} tidak ada di master karyawan` : ""}
        </span>
        <div className="ml-auto flex gap-2">
          <ExportButtons total={shown.length} buildReport={buildReport} fileName="koperasi-anggota" />
          {canEdit && (
            <button onClick={() => setEditing("new")} className={btnPrimary}>
              <UserPlus size={16} /> Tambah Anggota
            </button>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              <th className="px-3 py-2.5 whitespace-nowrap">NIK / Kode</th>
              <th className="px-3 py-2.5">Nama</th>
              <th className="px-3 py-2.5">Jabatan</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Estate / Divisi</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Terakhir Ambil</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Bulan Ini</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  Tidak ada anggota.
                </td>
              </tr>
            ) : (
              shown.map((a) => (
                <tr key={a.kode}>
                  <td className="px-3 py-2 whitespace-nowrap">{a.kode}</td>
                  <td className="col-grow px-3 py-2">
                    <span className="font-medium text-[var(--text-primary)]">{a.nama || <span className="italic text-[var(--text-muted)]">nama tidak tercatat</span>}</span>
                    {a.jenis === "INSTANSI" && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#f1f5f9] text-[var(--text-secondary)]">instansi</span>}
                    {a.jenis === "KARYAWAN" && !a.di_master && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]" title="NIK ini tidak ada di master karyawan (sudah keluar?)">
                        tidak di master karyawan
                      </span>
                    )}
                    {a.catatan && <div className="text-[11px] text-[var(--text-muted)]">{a.catatan}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{a.jabatan || "-"}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{[a.estate, a.divisi].filter(Boolean).join(" / ") || "-"}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{a.terakhir ? isoDisplay(a.terakhir) : "-"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{a.total_bulan_ini ? num(a.total_bulan_ini) : "-"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setRiwayat(a)} className="text-xs text-[var(--accent-blue)] hover:underline mr-2">
                      Riwayat
                    </button>
                    {canEdit && (
                      <button onClick={() => setEditing(a)} title="Edit anggota" className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                        <Pencil size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {editing && <AnggotaModal anggota={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSuccess={() => (setEditing(null), onChanged())} />}
      {riwayat && (
        <Modal title={riwayat.nama || riwayat.kode} subtitle={`${riwayat.kode} · semua pengambilan`} onClose={() => setRiwayat(null)} wide>
          <TxTable jenis="JUAL" periode="" anggota={riwayat.kode} reload={reload} canEdit={false} onChanged={() => {}} />
        </Modal>
      )}
    </div>
  );
}

function AnggotaModal({ anggota, onClose, onSuccess }: { anggota: KopAnggota | null; onClose: () => void; onSuccess: () => void }) {
  const [jenis, setJenis] = useState<"KARYAWAN" | "INSTANSI">(anggota?.jenis ?? "KARYAWAN");
  const [picked, setPicked] = useState<KopAnggota | null>(null);
  const [f, setF] = useState({
    kode: anggota?.kode ?? "",
    nama: anggota?.nama ?? "",
    jabatan: anggota?.jabatan ?? "",
    estate: anggota?.estate ?? "",
    divisi: anggota?.divisi ?? "",
    catatan: anggota?.catatan ?? "",
    aktif: anggota?.aktif ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  // Name / estate of a karyawan still in master karyawan come from there.
  const fromMaster = !!anggota && anggota.jenis === "KARYAWAN" && anggota.di_master;
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (anggota) await api.kopSaveAnggota(anggota.kode, f);
      else if (jenis === "KARYAWAN") {
        if (!picked) throw new Error("Pilih karyawan dulu");
        await api.kopAddAnggota({ jenis, kode: picked.kode, jabatan: f.jabatan, catatan: f.catatan });
      } else await api.kopAddAnggota({ jenis, kode: f.kode, nama: f.nama, catatan: f.catatan });
      onSuccess();
    } catch (e) {
      setError(errorText(e, e instanceof Error ? e.message : "Gagal menyimpan anggota"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={anggota ? `Edit ${anggota.kode}` : "Tambah Anggota"} onClose={onClose}>
      <div className="space-y-3">
        {!anggota && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={jenis === "KARYAWAN"} onChange={() => setJenis("KARYAWAN")} /> Karyawan
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={jenis === "INSTANSI"} onChange={() => setJenis("INSTANSI")} /> Instansi (Kantor, Mess, dll)
            </label>
          </div>
        )}
        {!anggota && jenis === "KARYAWAN" ? (
          <AnggotaPicker value={picked} onChange={setPicked} karyawanOnly />
        ) : !anggota ? (
          <>
            <div>
              <label className={labelCls}>Kode (mis. KANTOR, MESS TAMU)</label>
              <input value={f.kode} onChange={set("kode")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nama</label>
              <input value={f.nama} onChange={set("nama")} className={inputCls} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelCls}>Nama {fromMaster && "(dari master karyawan)"}</label>
              <input value={f.nama} onChange={set("nama")} disabled={fromMaster} className={`${inputCls} disabled:bg-[#f8fafc]`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Estate</label>
                <input value={f.estate} onChange={set("estate")} disabled={fromMaster} className={`${inputCls} disabled:bg-[#f8fafc]`} />
              </div>
              <div>
                <label className={labelCls}>Divisi</label>
                <input value={f.divisi} onChange={set("divisi")} disabled={fromMaster} className={`${inputCls} disabled:bg-[#f8fafc]`} />
              </div>
            </div>
          </>
        )}
        {jenis === "KARYAWAN" && (
          <div>
            <label className={labelCls}>Jabatan</label>
            <input value={f.jabatan} onChange={set("jabatan")} className={inputCls} />
          </div>
        )}
        <div>
          <label className={labelCls}>Catatan</label>
          <input value={f.catatan} onChange={set("catatan")} className={inputCls} />
        </div>
        {anggota && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.aktif} onChange={set("aktif")} /> Aktif (boleh mengambil barang)
          </label>
        )}
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Search box for an anggota or a karyawan (any karyawan becomes anggota on the first pengambilan).
function AnggotaPicker({ value, onChange, karyawanOnly = false }: { value: KopAnggota | null; onChange: (a: KopAnggota | null) => void; karyawanOnly?: boolean }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<KopAnggota[]>([]);
  useEffect(() => {
    const s = search.trim();
    if (s.length < 2) return setOptions([]);
    const t = setTimeout(() => {
      api
        .kopPickAnggota(s)
        .then((o) => setOptions(karyawanOnly ? o.filter((a) => a.baru) : o))
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, karyawanOnly]);
  if (value)
    return (
      <div className="flex items-center gap-3 rounded-md border border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-[var(--text-primary)]">{value.nama || value.kode}</div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            {value.kode}
            {value.jabatan && ` · ${value.jabatan}`}
            {[value.estate, value.divisi].filter(Boolean).length > 0 && ` · ${[value.estate, value.divisi].filter(Boolean).join(" / ")}`}
            {value.jenis === "INSTANSI" && " · instansi (ditagih ke kantor)"}
          </div>
        </div>
        <button onClick={() => onChange(null)} title="Ganti" className="p-1 rounded hover:bg-white/60">
          <X size={16} />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <label className={labelCls}>{karyawanOnly ? "Cari karyawan (nama / NIK)" : "Anggota / karyawan (ketik nama atau NIK)"}</label>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="min. 2 huruf" className={inputCls} autoFocus />
      {options.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-64 overflow-auto bg-white border border-[var(--border)] rounded-md shadow-lg">
          {options.map((o) => (
            <button
              key={o.kode}
              type="button"
              onClick={() => (onChange(o), setSearch(""), setOptions([]))}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#f1f5f9] border-b border-[var(--border)] last:border-0"
            >
              <div className="font-medium text-[var(--text-primary)]">{o.nama || o.kode}</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {o.kode} · {[o.estate, o.divisi].filter(Boolean).join(" / ") || (o.jenis === "INSTANSI" ? "instansi" : "-")}
                {o.baru && " · belum pernah ambil (jadi anggota baru)"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Forms: lines of barang (pengambilan uses harga jual, pembelian harga beli) ----
type Line = { barang: KopBarang; qty: string; harga: string };

function useBarangAktif() {
  const [barang, setBarang] = useState<KopBarang[]>([]);
  useEffect(() => {
    api.kopBarang({ aktif: "1" }).then(setBarang).catch(() => setBarang([]));
  }, []);
  return barang;
}

function BarangLines({ lines, setLines, harga, checkStok }: { lines: Line[]; setLines: (f: (l: Line[]) => Line[]) => void; harga: "jual" | "beli"; checkStok: boolean }) {
  const barang = useBarangAktif();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = search.trim().toLowerCase();
  const options = q ? barang.filter((b) => (b.nama.toLowerCase().includes(q) || b.kode.toLowerCase().includes(q)) && !lines.some((l) => l.barang.kode === b.kode)).slice(0, 12) : [];
  const add = (b: KopBarang) => {
    setLines((l) => [...l, { barang: b, qty: "1", harga: String(harga === "jual" ? b.harga_jual : b.harga_beli) }]);
    setSearch("");
    setOpen(false);
  };
  const update = (i: number, k: "qty" | "harga", v: string) => setLines((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = lines.reduce((s, l) => s + (parseNum(l.qty) || 0) * (parseNum(l.harga) || 0), 0);
  return (
    <div className="space-y-2">
      <div ref={box} className="relative">
        <label className={labelCls}>Tambah barang</label>
        <input
          value={search}
          onChange={(e) => (setSearch(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && options[0]) {
              e.preventDefault();
              add(options[0]);
            }
          }}
          placeholder="Ketik nama / kode barang, Enter untuk pilih yang teratas"
          className={inputCls}
        />
        {open && options.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-64 overflow-auto bg-white border border-[var(--border)] rounded-md shadow-lg">
            {options.map((b) => (
              <button key={b.kode} type="button" onClick={() => add(b)} className="w-full flex justify-between gap-3 text-left px-3 py-2 text-sm hover:bg-[#f1f5f9] border-b border-[var(--border)] last:border-0">
                <span>
                  {b.nama} <span className="text-[11px] text-[var(--text-muted)]">{b.kode}</span>
                </span>
                <span className={`text-xs whitespace-nowrap ${b.lacak_stok && b.stok <= 0 ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]"}`}>
                  {b.lacak_stok ? `stok ${fmtQty(b.stok)} ${b.satuan}` : "tanpa stok"} · {num(harga === "jual" ? b.harga_jual : b.harga_beli)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <div className="border border-[var(--border)] rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-xs text-[var(--text-secondary)] text-left">
                <th className="px-2 py-1.5">Barang</th>
                <th className="px-2 py-1.5 w-24">Jumlah</th>
                <th className="px-2 py-1.5 w-28">{harga === "jual" ? "Harga" : "Harga beli"}</th>
                <th className="px-2 py-1.5 text-right">Subtotal</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const qty = parseNum(l.qty) || 0;
                const kurang = checkStok && l.barang.lacak_stok && qty > l.barang.stok;
                return (
                  <tr key={l.barang.kode} className="border-t border-[var(--border)] align-top">
                    <td className="px-2 py-1.5">
                      <div className="text-[var(--text-primary)]">{l.barang.nama}</div>
                      <div className={`text-[11px] ${kurang ? "text-[var(--accent-red)] font-medium" : "text-[var(--text-muted)]"}`}>
                        {l.barang.lacak_stok ? `stok ${fmtQty(l.barang.stok)} ${l.barang.satuan}${kurang ? " - tidak cukup" : ""}` : l.barang.satuan}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={l.qty} onChange={(e) => update(i, "qty", e.target.value)} inputMode="decimal" className="w-full text-sm rounded border border-[var(--border)] px-2 py-1" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={l.harga} onChange={(e) => update(i, "harga", e.target.value)} inputMode="decimal" className="w-full text-sm rounded border border-[var(--border)] px-2 py-1" />
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{num(qty * (parseNum(l.harga) || 0))}</td>
                    <td className="px-1 py-1.5">
                      <button onClick={() => setLines((x) => x.filter((_, j) => j !== i))} title="Hapus baris" className="p-1 rounded text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-[var(--border)] font-semibold">
                <td colSpan={3} className="px-2 py-1.5 text-right">
                  Total
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{rp(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const linesBody = (lines: Line[]) => lines.map((l) => ({ barang_kode: l.barang.kode, qty: parseNum(l.qty), harga: parseNum(l.harga || "0") }));
const linesError = (lines: Line[]) =>
  !lines.length ? "Tambahkan minimal satu barang" : lines.some((l) => !(parseNum(l.qty) > 0) || !(parseNum(l.harga || "0") >= 0)) ? "Jumlah harus lebih dari 0 dan harga diisi angka" : "";

function JualModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [tanggal, setTanggal] = useState(localToday());
  const [anggota, setAnggota] = useState<KopAnggota | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [limit, setLimit] = useState<{ limit: number; terpakai: number; sisa: number } | null>(null);
  const periode = tanggal.slice(0, 7);
  useEffect(() => {
    setLimit(null);
    if (!anggota || anggota.jenis === "INSTANSI") return;
    api.kopLimit(anggota.kode, periode).then(setLimit).catch(() => setLimit(null));
  }, [anggota, periode]);
  const total = lines.reduce((s, l) => s + (parseNum(l.qty) || 0) * (parseNum(l.harga) || 0), 0);
  const lewat = !!limit && total > limit.sisa + 0.005;
  const [keterangan, setKeterangan] = useState("");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!anggota) return setError("Pilih anggota / karyawan");
    const le = linesError(lines);
    if (le) return setError(le);
    if (lewat) return setError(`Melebihi limit: sisa ${rp(limit!.sisa)} di ${periodeLabel(periode)}`);
    setBusy(true);
    setError("");
    try {
      await api.kopJual({ tanggal, anggota_kode: anggota.kode, bayar: anggota.jenis === "INSTANSI" ? "INSTANSI" : "POTONG_GAJI", keterangan, evidence_id: evidence, items: linesBody(lines) });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan pengambilan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Input Pengambilan" subtitle={`Masuk potong gaji periode ${periodeLabel(tanggal.slice(0, 7))}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3">
          <AnggotaPicker value={anggota} onChange={setAnggota} />
          <div>
            <label className={labelCls}>Tanggal</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
          </div>
        </div>
        {limit && (
          <div className={`rounded-md border px-3 py-2 text-xs ${lewat ? "border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)]" : "border-[var(--border)] bg-[#f8fafc] text-[var(--text-secondary)]"}`}>
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                Limit potong gaji {periodeLabel(periode)}: <b>{rp(limit.limit)}</b> · sudah diambil {rp(limit.terpakai)}
              </span>
              <span>
                Sisa <b>{rp(Math.max(limit.sisa - total, 0))}</b>
                {lewat && ` - bon ini lewat ${rp(total - limit.sisa)}`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white overflow-hidden border border-[var(--border)]">
              <div
                className={`h-full ${lewat ? "bg-[var(--accent-red)]" : "bg-[var(--accent-blue)]"}`}
                style={{ width: `${Math.min(100, ((limit.terpakai + total) / limit.limit) * 100)}%` }}
              />
            </div>
          </div>
        )}
        <BarangLines lines={lines} setLines={setLines} harga="jual" checkStok />
        <div>
          <label className={labelCls}>Keterangan (opsional)</label>
          <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className={inputCls} />
        </div>
        <EvidenceInput value={evidence} onChange={setEvidence} label="Foto bon yang ditandatangani (opsional)" />
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
            Batal
          </button>
          <button onClick={save} disabled={busy || lewat} className={btnPrimary}>
            <Banknote size={16} /> {busy ? "Menyimpan..." : "Simpan Pengambilan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BeliModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [tanggal, setTanggal] = useState(localToday());
  const [noPo, setNoPo] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [keterangan, setKeterangan] = useState("");
  const [updateHarga, setUpdateHarga] = useState(true);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const le = linesError(lines);
    if (le) return setError(le);
    setBusy(true);
    setError("");
    try {
      await api.kopBeli({ tanggal, no_po: noPo, keterangan, evidence_id: evidence, update_harga: updateHarga, items: linesBody(lines) });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan pembelian"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Catat Pembelian" subtitle="Barang masuk ke stok koperasi" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Tanggal</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>No PO / nota (opsional)</label>
            <input value={noPo} onChange={(e) => setNoPo(e.target.value)} className={inputCls} />
          </div>
        </div>
        <BarangLines lines={lines} setLines={setLines} harga="beli" checkStok={false} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={updateHarga} onChange={(e) => setUpdateHarga(e.target.checked)} /> Harga jual ke anggota ikut harga beli ini
        </label>
        <div>
          <label className={labelCls}>Keterangan (opsional)</label>
          <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className={inputCls} />
        </div>
        <EvidenceInput value={evidence} onChange={setEvidence} label="Foto nota (opsional)" />
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Simpan Pembelian"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RusakModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const barang = useBarangAktif();
  const [tanggal, setTanggal] = useState(localToday());
  const [kode, setKode] = useState("");
  const [qty, setQty] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const b = barang.find((x) => x.kode === kode);
  const save = async () => {
    if (!kode) return setError("Pilih barang");
    if (!(parseNum(qty) > 0)) return setError("Jumlah harus lebih dari 0");
    setBusy(true);
    setError("");
    try {
      await api.kopRusak({ tanggal, barang_kode: kode, qty: parseNum(qty), keterangan, evidence_id: evidence });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Barang Rusak / Dibuang" subtitle="Mengurangi stok tanpa ditagihkan ke siapa pun" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Barang</label>
          <select value={kode} onChange={(e) => setKode(e.target.value)} className={`${selectCls} w-full`}>
            <option value="">-- Pilih barang --</option>
            {barang
              .filter((x) => x.lacak_stok && x.stok > 0)
              .map((x) => (
                <option key={x.kode} value={x.kode}>
                  {x.nama} (stok {fmtQty(x.stok)} {x.satuan})
                </option>
              ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Jumlah {b && `(${b.satuan})`}</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tanggal</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Alasan (mis. expired, pecah, digigit tikus)</label>
          <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className={inputCls} />
        </div>
        <EvidenceInput value={evidence} onChange={setEvidence} label="Foto (opsional)" />
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-start sm:items-center justify-center z-50 p-2 sm:p-4" onClick={onClose}>
      <div className={`bg-white rounded-lg w-full ${wide ? "max-w-4xl" : "max-w-lg"} shadow-xl max-h-[calc(100vh-1rem)] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">{title}</h3>
            {subtitle && <p className="text-xs text-[var(--text-secondary)]">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[#f1f5f9]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
