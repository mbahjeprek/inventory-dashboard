import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PetugasBaris, usePetugas } from "../components/PetugasAlur";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Banknote, Boxes, ChevronRight, ChevronsDownUp, ChevronsUpDown, CalendarClock, Check, ClipboardCheck, ClipboardList, Droplets, FileText, HandCoins, ShieldCheck, LayoutDashboard, ListPlus, Lock, Package, Receipt, PackageX, Pencil, Plus, Search, ShoppingBasket, Trash2, Truck, UserPlus, Users, X } from "lucide-react";
import {
  api,
  errorText,
  type KopAnggota,
  type KopBarang,
  type KopBayar,
  type KopBayarRow,
  type KopCara,
  type KopTagihan,
  type KopTunggakan,
  type KopRekap,
  type KopRingkasan,
  type KopTx,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EvidenceInput, EvidenceLink, useEvidenceEnabled } from "../components/EvidenceInput";
import { printTable } from "../lib/printTable";
import { BaDaftar, itemsKoperasi, jenisKoperasi } from "../components/BaPemusnahan";
import { DepoAirTab } from "../components/DepoAirTab";
import { KopPermintaanTab } from "../components/KopPermintaanTab";
import { fmtQty, isoDisplay, localToday } from "../lib/opname";
import { tanggalWaktu } from "../lib/datetime";
import { KopBeliBatchModal, KopJualBatchModal } from "../components/KoperasiBatchModal";
import { KoperasiDashboard } from "../components/KoperasiDashboard";
import { KoperasiOpname } from "../components/KoperasiOpname";
import { printKopSlips } from "../lib/kopSlip";
// Number typed the Indonesian way ("1.500" thousands, "2,5" or "0.5" decimal).
import { parseNum } from "../components/BatchGrid";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { DokumenButton } from "../components/DokumenButton";

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
// Money is always shown as "Rp 1.500.000" (dots for thousands).
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
// A typed rupiah amount shown with its thousands dots as it is typed ("1500000" -> "1.500.000").
const rpText = (v: string | number) => {
  const digits = String(typeof v === "number" ? Math.round(v) : v).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits).toLocaleString("id-ID") : "";
};
const BAYAR_LABEL: Record<KopBayar, string> = { POTONG_GAJI: "Potong Gaji", TUNAI: "Tunai", INSTANSI: "Instansi" };
// A line's date with the time it was entered; spreadsheet imports carry their import time, so date only.
const txWaktu = (t: KopTx) => tanggalWaktu(t.tanggal_iso, t.sumber?.startsWith("IMPORT") ? null : t.created_at);
const BAYAR_CLS: Record<KopBayar, string> = {
  POTONG_GAJI: "bg-[var(--accent-blue-bg)] border-[var(--accent-blue-border)] text-[var(--accent-blue)]",
  TUNAI: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]",
  INSTANSI: "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-secondary)]",
};

type Tab = "dashboard" | "jual" | "rekap" | "stok" | "opname" | "beli" | "permintaan" | "depo" | "anggota";
const TABS: { key: Tab; label: string; icon: typeof Package }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "jual", label: "Stock Out", icon: ShoppingBasket },
  { key: "rekap", label: "Rekap Potong Gaji", icon: HandCoins },
  { key: "stok", label: "Stok Barang", icon: Boxes },
  { key: "opname", label: "Stok Opname", icon: ClipboardCheck },
  { key: "beli", label: "Stock In, Rusak & Koreksi", icon: Truck },
  { key: "permintaan", label: "Permintaan Barang", icon: ClipboardList },
  { key: "depo", label: "Depo Air", icon: Droplets },
  { key: "anggota", label: "Anggota", icon: Users },
];

// Sortable columns (as in the other menus): click a title to sort by it, again for the other way. A
// number / date column starts with the largest / newest. Empty values go last.
type Sort = { key: string; dir: "asc" | "desc" };
type SortVal = string | number | null | undefined;
function sortBy<T>(rows: T[], sort: Sort, get: Record<string, (r: T) => SortVal>): T[] {
  const f = get[sort.key];
  if (!f) return rows;
  const m = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === "") return 1;
    if (y === null || y === undefined || y === "") return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "id", { numeric: true })) * m;
  });
}
function SortTh({
  label,
  k,
  sort,
  setSort,
  num = false,
  desc = num,
  className = "",
}: {
  label: string;
  k: string;
  sort: Sort;
  setSort: (s: Sort) => void;
  num?: boolean;
  // First click sorts largest / newest first (numbers and dates).
  desc?: boolean;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`px-3 py-2.5 whitespace-nowrap ${num ? "text-right" : ""} ${className}`}>
      <button
        type="button"
        onClick={() => setSort(active ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: desc ? "desc" : "asc" })}
        className={`inline-flex items-center gap-1 hover:text-[var(--accent-blue)] ${active ? "text-[var(--accent-blue)]" : ""}`}
        title="Urutkan"
      >
        {label}
        <Icon size={12} />
      </button>
    </th>
  );
}

export function KoperasiPage() {
  const { user } = useAuth();
  const canInput = can(user, "koperasi.input");
  const canEdit = can(user, "koperasi.edit");
  // Marking bills paid / not paid is HR's (its own tick), not the koperasi admin's.
  const canBayar = can(user, "koperasi.pelunasan");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [rusakAlasan, setRusakAlasan] = useState<"EXPIRED" | "RUSAK">("RUSAK");
  const [periodes, setPeriodes] = useState<string[]>([]);
  const [periode, setPeriode] = useState(localToday().slice(0, 7));
  const [ringkasan, setRingkasan] = useState<KopRingkasan | null>(null);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<"" | "jual" | "beli" | "rusak" | "jualBatch" | "beliBatch">("");

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
  // Opens the list where the expired barang are processed (tarik ke Barang Rusak / Expired).
  const expCard = <ExpCard reload={reload} onLihat={() => setTab("beli")} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Koperasi PT.AKSS</h1>
          <p className="text-sm text-[var(--text-secondary)]">Stock Out barang ke karyawan, dipotong dari gaji bulan itu (limit Rp 1.500.000 per bulan)</p>
        </div>
        {canInput && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => (setRusakAlasan("RUSAK"), setModal("rusak"))} className={btnOutline}>
              <PackageX size={16} /> Barang Rusak / Expired
            </button>
            <button onClick={() => setModal("beli")} className={btnOutline}>
              <Truck size={16} /> Input Stock In
            </button>
            <button onClick={() => setModal("beliBatch")} className={btnOutline}>
              <ListPlus size={16} /> Input Banyak Stock In
            </button>
            <button onClick={() => setModal("jualBatch")} className={btnOutline}>
              <ListPlus size={16} /> Input Banyak Stock Out
            </button>
            <button onClick={() => setModal("jual")} className={btnPrimary}>
              <Plus size={16} /> Input Stock Out
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ActivityLogButton module="KOPERASI" estate="NILAM" />
          <DokumenButton modul="KOPERASI" estate="NILAM" />
        </div>
      </div>

      <TunggakanBanner reload={reload} canBayar={canBayar} onChanged={done} />
      <RusakMenungguBanner reload={reload} canApprove={can(user, "koperasi.approve")} onLihat={() => setTab("beli")} />

      {ringkasan && tab !== "dashboard" && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <StatCard
            label={`Stock Out ${periodeLabel(periode)}`}
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
          <StatCard label={`Stock In ${periodeLabel(periode)}`} value={rp(ringkasan.beli)} icon={Truck} tone="green" onClick={() => setTab("beli")} title="Buka Stock In" />
          <StatCard
            label={`Nilai Stok akhir ${periodeLabel(periode)}`}
            value={rp(ringkasan.nilai_stok)}
            icon={Boxes}
            tone={ringkasan.menipis ? "red" : "green"}
            onClick={() => setTab("stok")}
            title="Buka Stok Barang"
            footer={<span className={`text-[11px] ${ringkasan.menipis ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]"}`}>{ringkasan.menipis} barang stok menipis / habis · harga beli</span>}
          />
          {expCard}
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

      {tab === "dashboard" && <KoperasiDashboard periode={periode} reload={reload} extraCard={expCard} />}
      {tab === "jual" && <TxTable jenis="JUAL" periode={periode} reload={reload} canEdit={canEdit} onChanged={done} />}
      {tab === "rekap" && <RekapTab periode={periode} reload={reload} canBayar={canBayar} onChanged={done} />}
      {tab === "stok" && <StokTab reload={reload} canEdit={canEdit} canInput={canInput} onChanged={done} />}
      {tab === "opname" && <KoperasiOpname canInput={canInput} canEdit={canEdit} isSuperuser={user?.role === "superuser"} onChanged={done} />}
      {tab === "beli" && (
        <div className="space-y-4">
          <ExpiredPerluDitarik reload={reload} canInput={canInput} onChanged={done} />
          <TxTable jenis="BELI" periode={periode} reload={reload} canEdit={canEdit} onChanged={done} />
          <h2 className="text-sm font-semibold text-[var(--text-primary)] pt-2">Barang Rusak / Expired</h2>
          <KopAlurRusak periode={periode} reload={reload} />
          <p className="text-xs text-[var(--text-muted)] -mt-2">
            Diinput dengan foto, lalu diperiksa orang kedua (hak Approve Koperasi) yang mencocokkan barang fisiknya. Yang disetujui masuk Berita Acara Pemusnahan; pemusnahan disaksikan minimal 2 orang.
          </p>
          <TxTable jenis="RUSAK" periode={periode} reload={reload} canEdit={canEdit} onChanged={done} />
          <div id="ba-daftar">
            <BaDaftar jenis={jenisKoperasi()} items={itemsKoperasi} reload={reload} />
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] pt-2">Koreksi Stok</h2>
          <p className="text-xs text-[var(--text-muted)] -mt-2">
            Dihitung tanpa melihat stok sistem, dengan foto. Stok baru berubah setelah diperiksa orang kedua (hak Approve Koperasi). Koreksi dari Stok Opname ikut tercatat di sini.
          </p>
          <TxTable jenis="KOREKSI" periode={periode} reload={reload} canEdit={canEdit} onChanged={done} />
        </div>
      )}
      {tab === "permintaan" && <KopPermintaanTab canInput={canInput} canEdit={canEdit} />}
      {tab === "depo" && <DepoAirTab periode={periode} reload={reload} canInput={canInput} canEdit={canEdit} />}
      {tab === "anggota" && <AnggotaTab reload={reload} canEdit={canEdit} onChanged={done} />}

      {modal === "jual" && <JualModal onClose={() => setModal("")} onSuccess={done} />}
      {modal === "beli" && <BeliModal onClose={() => setModal("")} onSuccess={done} />}
      {modal === "rusak" && <RusakModal alasanAwal={rusakAlasan} onClose={() => setModal("")} onSuccess={done} />}
      {modal === "jualBatch" && <KopJualBatchModal onClose={() => setModal("")} onSuccess={done} />}
      {modal === "beliBatch" && <KopBeliBatchModal onClose={() => setModal("")} onSuccess={done} />}
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
  jenis: "JUAL" | "BELI" | "RUSAK" | "KOREKSI" | "";
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
  const [edit, setEdit] = useState<KopTx | null>(null);
  const [periksa, setPeriksa] = useState<KopTx | null>(null);
  // Barang Rusak / Koreksi: a row opens its process; the Berita Acara of Barang Rusak is a form + formal letter.
  const [detail, setDetail] = useState<KopTx | null>(null);
  // A month whose rekap went to HRD (from the 1st) is locked for Stock Out changes, except for HR / Super User.
  const { user } = useAuth();
  const bukaKunci = user?.role === "superuser" || can(user, "koperasi.pelunasan");
  const bulanIni = localToday().slice(0, 7);
  const terkunci = (t: KopTx) => t.jenis === "JUAL" && t.periode < bulanIni && !bukaKunci;
  const canApprove = can(user, "koperasi.approve");
  const kunciIcon = (
    <span title="Periode sudah dikunci: rekapnya sudah disetor ke HRD. Perubahan lewat HR (Pelunasan Koperasi) atau Super User." className="inline-flex p-1.5 text-[var(--text-muted)]">
      <Lock size={14} />
    </span>
  );
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
  const koreksi = jenis === "KOREKSI";
  // Barang Rusak / Expired and Koreksi Stok: a nilai (harga beli) and a pemeriksaan instead of harga / total.
  const rusak = jenis === "RUSAK" || koreksi;
  const cols = [
    "Tanggal",
    ...(jual || !jenis ? ["Anggota"] : []),
    ...(beli ? ["No PO"] : []),
    "Barang",
    "Jumlah",
    ...(rusak ? ["Nilai"] : ["Harga", "Total"]),
    ...(jual ? ["Bayar"] : []),
    "Keterangan",
    ...(rusak ? ["Pemeriksaan"] : []),
  ];
  const label = jual ? "stock out" : beli ? "stock in" : koreksi ? "koreksi stok" : rusak ? "barang rusak" : "transaksi";
  const pages = Math.max(1, Math.ceil((res?.total ?? 0) / pageSize));

  // Stock Out lines grouped per bon (one person's input), folded until opened; other lists stay one row each.
  const bonKey = (t: KopTx) => t.bon || `id-${t.id}`;
  const groups = useMemo(() => {
    // By bon over the whole page (Input Banyak can interleave two people's lines), in order of first appearance.
    const out: KopTx[][] = [];
    const byBon = new Map<string, KopTx[]>();
    for (const t of res?.data ?? []) {
      const g = jual && t.bon ? byBon.get(t.bon) : undefined;
      if (g) g.push(t);
      else {
        out.push([t]);
        if (jual && t.bon) byBon.set(t.bon, out[out.length - 1]);
      }
    }
    return out;
  }, [res, jual]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (t: KopTx) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (!n.delete(bonKey(t))) n.add(bonKey(t));
      return n;
    });
  const multiBons = groups.filter((g) => g.length > 1);
  const allOpen = multiBons.length > 0 && multiBons.every((g) => expanded.has(bonKey(g[0])));
  const buildReport = async () => {
    const all = await api.kopTx({ ...params, page: 1, pageSize: 500 });
    let rows = all.data;
    for (let p = 2; rows.length < all.total && p <= 40; p++) rows = rows.concat((await api.kopTx({ ...params, page: p, pageSize: 500 })).data);
    return {
      title: `Koperasi PT.AKSS - ${jual ? "Stock Out" : beli ? "Stock In" : koreksi ? "Koreksi Stok" : rusak ? "Barang Rusak" : "Riwayat"}`,
      subtitle: [periode ? `Periode ${periodeLabel(periode)}` : "Semua periode", ...(q ? [`Cari: ${q}`] : [])],
      landscape: true,
      columns: cols.map((c) => ({ label: ["Harga", "Total", "Nilai"].includes(c) ? `${c} (Rp)` : c, align: ["Jumlah", "Harga", "Total", "Nilai"].includes(c) ? ("right" as const) : undefined })),
      rows: rows.map((t) => [
        txWaktu(t),
        ...(jual || !jenis ? [t.anggota_kode ? `${t.anggota_nama || "-"} (${t.anggota_kode})` : "-"] : []),
        ...(beli ? [t.no_po] : []),
        t.barang_nama,
        `${koreksi && t.qty > 0 ? "+" : ""}${fmtQty(t.qty)} ${t.satuan}`,
        ...(rusak ? [t.total] : [t.harga, t.total]),
        ...(jual ? [BAYAR_LABEL[t.bayar]] : []),
        rusak && t.alasan ? `${ALASAN_LABEL[t.alasan] ?? t.alasan}: ${t.keterangan}` : t.keterangan,
        ...(rusak ? [periksaText(t)] : []),
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
          {jual && multiBons.length > 0 && (
            <button
              onClick={() => setExpanded(allOpen ? new Set() : new Set(multiBons.map((g) => bonKey(g[0]))))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
            >
              {allOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
              {allOpen ? "Ringkas semua" : "Buka semua"}
            </button>
          )}
          {rusak && (
            <button
              onClick={() => (koreksi ? cetakBeritaAcara("KOREKSI", periode).catch((e) => setError(errorText(e, "Gagal mencetak"))) : (() => document.getElementById("ba-daftar")?.scrollIntoView({ behavior: "smooth", block: "start" }))())}
              className={btnOutline}
              title={`${koreksi ? "Koreksi stok" : "Barang rusak / expired"} yang sudah disetujui di periode ini, dengan kolom tanda tangan`}
            >
              <FileText size={15} /> Berita Acara
            </button>
          )}
          <ExportButtons total={res?.total ?? 0} buildReport={buildReport} fileName={`koperasi-${label.replace(/ /g, "-")}-${periode}`} />
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              {cols.map((c) => (
                <th key={c} className={`px-3 py-2.5 whitespace-nowrap ${["Jumlah", "Harga", "Total", "Nilai"].includes(c) ? "text-right" : ""}`}>
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
              groups.map((g, gi) => {
                const head = g[0];
                // A Stock Out bon of several barang folds into one line per person; click it to see the barang.
                if (jual && g.length > 1 && !expanded.has(bonKey(head))) {
                  const bayar = new Set(g.map((t) => t.bayar)).size === 1 ? head.bayar : null;
                  return (
                    <tr
                      key={`bon-${head.id}`}
                      onClick={() => toggle(head)}
                      className={`align-top cursor-pointer hover:bg-[#f8fafc] ${gi > 0 ? "border-t-2 border-t-[var(--border)]" : ""}`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <ChevronRight size={14} className="text-[var(--text-muted)]" />
                          {txWaktu(head)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[var(--text-primary)]">{head.anggota_nama || <span className="italic text-[var(--text-muted)]">nama tidak tercatat</span>}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">{head.anggota_kode}</div>
                      </td>
                      <td className="col-grow px-3 py-2">
                        <div className="font-medium text-[var(--accent-blue)]">{g.length} barang</div>
                        <div className="text-[11px] text-[var(--text-muted)] line-clamp-1">{g.map((t) => t.barang_nama).join(", ")}</div>
                      </td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">{rp(g.reduce((s, t) => s + t.total, 0))}</td>
                      <td className="px-3 py-2">
                        {bayar ? (
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${BAYAR_CLS[bayar]}`}>{BAYAR_LABEL[bayar]}</span>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)]">Campur</span>
                        )}
                      </td>
                      <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">
                        <div>{head.keterangan || (head.sumber?.startsWith("IMPORT") ? "" : "-")}</div>
                        <div className="text-[var(--text-muted)]">{head.sumber?.startsWith("IMPORT") ? "dari spreadsheet" : `oleh ${head.oleh || "-"}`}</div>
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {terkunci(head) ? kunciIcon : head.bon && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setHapus({ tx: head, bon: true });
                              }}
                              title="Hapus seluruh bon"
                              className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                            >
                              bon
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                }
                return g.map((t, li) => {
                // A bon's lines sit together; its date / anggota are shown once.
                const sameBon = li > 0;
                const foldable = jual && g.length > 1;
                return (
                  <tr
                    key={t.id}
                    {...(rusak && !t.opname_id ? { onClick: () => setDetail(t), title: "Lihat proses" } : {})}
                    className={`align-top ${sameBon ? "" : jual && gi > 0 ? "border-t-2 border-t-[var(--border)]" : ""} ${foldable ? "bg-[#fafcff]" : ""} ${rusak && !t.opname_id ? "cursor-pointer hover:bg-[#f8fafc]" : ""}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {!sameBon &&
                        (foldable ? (
                          <button onClick={() => toggle(t)} title="Ringkas bon ini" className="inline-flex items-center gap-1 hover:text-[var(--accent-blue)]">
                            <ChevronRight size={14} className="rotate-90 text-[var(--text-muted)]" />
                            {txWaktu(t)}
                          </button>
                        ) : (
                          txWaktu(t)
                        ))}
                    </td>
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
                        {!jenis && ` · ${t.jenis === "JUAL" ? "Stock Out" : t.jenis === "BELI" ? "Stock In" : t.jenis === "KOREKSI" ? "Koreksi stok" : "Rusak"}`}
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap ${koreksi ? (t.qty < 0 ? "text-[var(--accent-red)] font-medium" : "text-[var(--accent-green)] font-medium") : ""}`}>
                      {koreksi && t.qty > 0 ? "+" : ""}
                      {fmtQty(t.qty)} {t.satuan}
                    </td>
                    {!rusak && <td className="px-3 py-2 text-right whitespace-nowrap">{rp(t.harga)}</td>}
                    <td className={`px-3 py-2 text-right whitespace-nowrap ${rusak ? "text-[var(--text-secondary)]" : "font-medium"}`}>{rusak && !t.total ? "-" : `${koreksi && t.total > 0 ? "+" : ""}${rp(t.total)}`}</td>
                    {jual && (
                      <td className="px-3 py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${BAYAR_CLS[t.bayar]}`}>{BAYAR_LABEL[t.bayar]}</span>
                      </td>
                    )}
                    <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">
                      <div>
                        {rusak && t.alasan && <span className={`mr-1 text-[10px] px-1.5 py-0.5 rounded border ${["EXPIRED", "HILANG"].includes(t.alasan) ? "border-[var(--accent-red-border)] text-[var(--accent-red)]" : "border-[var(--border)]"}`}>{ALASAN_LABEL[t.alasan] ?? t.alasan}</span>}
                        {t.keterangan || (t.sumber?.startsWith("IMPORT") ? "" : "-")}{" "}
                        <span onClick={(e) => e.stopPropagation()}>
                          <EvidenceLink id={t.evidence_id} label="foto" />
                        </span>
                      </div>
                      <div className="text-[var(--text-muted)]">{t.sumber?.startsWith("IMPORT") ? "dari spreadsheet" : `oleh ${t.oleh || "-"}`}</div>
                    </td>
                    {rusak && (
                      <td className="px-3 py-2 text-xs">
                        {t.opname_id ? (
                          <span className="text-[var(--text-muted)] whitespace-nowrap">Stok Opname #{t.opname_id}</span>
                        ) : (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_RUSAK[t.status ?? "DISETUJUI"].cls}`}>
                          {t.status === "DITOLAK" && koreksi ? "Ditolak, stok tetap" : STATUS_RUSAK[t.status ?? "DISETUJUI"].label}
                        </span>
                        )}
                        {t.status && t.status !== "MENUNGGU" && (
                          <div className="mt-1 text-[var(--text-muted)]">
                            oleh {t.diperiksa_nama || "-"}
                            {t.diperiksa_catatan && <span className="block text-[var(--text-secondary)]">{t.diperiksa_catatan}</span>}
                          </div>
                        )}
                        {t.status === "MENUNGGU" &&
                          (canApprove && t.user_id !== user?.id ? (
                            <button onClick={(e) => (e.stopPropagation(), setPeriksa(t))} className="mt-1 block text-[11px] px-2 py-0.5 rounded border border-[var(--accent-blue)] text-[var(--accent-blue)] hover:bg-[#eef4ff]">
                              Periksa
                            </button>
                          ) : (
                            <div className="mt-1 text-[var(--text-muted)]">{t.user_id === user?.id ? "diperiksa orang lain" : "perlu hak Approve"}</div>
                          ))}
                      </td>
                    )}
                    {canEdit && (
                      <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {terkunci(t) ? (
                          !sameBon && kunciIcon
                        ) : (
                          <>
                        {jual && (
                          <button onClick={() => setEdit(t)} title="Edit barang / jumlah" className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                            <Pencil size={14} />
                          </button>
                        )}
                        <button onClick={() => setHapus({ tx: t, bon: false })} title="Hapus baris ini" className="p-1.5 rounded-md text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                          <Trash2 size={14} />
                        </button>
                        {jual && t.bon && !sameBon && (
                          <button onClick={() => setHapus({ tx: t, bon: true })} title="Hapus seluruh bon" className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                            bon
                          </button>
                        )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
                });
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
      {detail && (
        <KopDetailProses
          t={detail}
          bisaPeriksa={detail.status === "MENUNGGU" && canApprove && detail.user_id !== user?.id}
          onPeriksa={() => (setPeriksa(detail), setDetail(null))}
          onBa={detail.jenis === "RUSAK" ? () => (setDetail(null), setTimeout(() => document.getElementById("ba-daftar")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)) : undefined}
          onClose={() => setDetail(null)}
        />
      )}
      {periksa && (
        <PeriksaRusakModal
          tx={periksa}
          onClose={() => setPeriksa(null)}
          onSuccess={() => {
            setPeriksa(null);
            onChanged();
          }}
        />
      )}
      {edit && (
        <EditTxModal
          tx={edit}
          onClose={() => setEdit(null)}
          onSuccess={() => {
            setEdit(null);
            onChanged();
          }}
        />
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

// ---- Rekap Potong Gaji: per anggota for the periode, sent to HRD on the 1st of the next month and
// deducted on the 10th-15th. Each karyawan's bill shows what is paid; Tandai lunas books the rest as
// potong gaji for the ticked ones, Bayar records a part / cash payment (gaji tidak cukup). ----
type StatusBayar = "LUNAS" | "SEBAGIAN" | "MENUNGGU" | "BELUM";
const STATUS_BAYAR: Record<StatusBayar, { label: string; cls: string }> = {
  LUNAS: { label: "Lunas", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  SEBAGIAN: { label: "Kurang bayar", cls: "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]" },
  MENUNGGU: { label: "Menunggu potong gaji", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  BELUM: { label: "Belum lunas", cls: "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]" },
};
const statusBayar = (r: { potong_gaji: number; dibayar: number }, jatuhTempo: string, today: string): StatusBayar | null => {
  if (r.potong_gaji <= 0.5) return null;
  const sisa = r.potong_gaji - r.dibayar;
  if (sisa <= 0.5) return "LUNAS";
  // Before the jatuh tempo a part-paid bill (e.g. a bon added after Tandai lunas) is still waiting for the salary cut.
  if (today <= jatuhTempo) return "MENUNGGU";
  return r.dibayar > 0.5 ? "SEBAGIAN" : "BELUM";
};

function RekapTab({ periode, reload, canBayar, onChanged }: { periode: string; reload: number; canBayar: boolean; onChanged: () => void }) {
  const canInput = canBayar;
  const [rows, setRows] = useState<KopRekap[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [today, setToday] = useState(localToday());
  const [detail, setDetail] = useState<KopRekap | null>(null);
  const [bayar, setBayar] = useState<KopRekap | null>(null);
  const [filter, setFilter] = useState<"" | "POTONG_GAJI" | "INSTANSI">("POTONG_GAJI");
  const [statusF, setStatusF] = useState<"" | "LUNAS" | "BELUM" | "KELUAR">("");
  const [cari, setCari] = useState("");
  const words = cari.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmLunas, setConfirmLunas] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    setRows(null);
    setPicked(new Set());
    api
      .kopRekap(periode)
      .then((r) => (setRows(r.data), setLimit(r.limit), setJatuhTempo(r.jatuh_tempo), setToday(r.today)))
      .catch(() => setRows([]));
  }, [periode, reload]);
  const [sort, setSort] = useState<Sort>({ key: "", dir: "asc" });
  const st = (r: KopRekap) => statusBayar(r, jatuhTempo, today);
  const sisaOf = (r: KopRekap) => Math.max(r.potong_gaji - r.dibayar, 0);
  // A karyawan no longer in master karyawan has likely resigned / moved: their bill must be taken from the last salary.
  const keluar = (r: KopRekap) => r.jenis === "KARYAWAN" && !r.di_master;
  const keluarOpen = (rows ?? []).filter((r) => keluar(r) && sisaOf(r) > 0.5);
  const [slipBusy, setSlipBusy] = useState(false);
  const cetakSlip = async (people: KopRekap[]) => {
    const list = people.filter((r) => r.potong_gaji > 0);
    if (!list.length) return setMsg("Tidak ada karyawan dengan potong gaji untuk dicetak");
    setSlipBusy(true);
    try {
      const r = await api.kopSlip(periode, list.map((p) => p.kode));
      printKopSlips({ periode, jatuhTempo: r.jatuh_tempo, limit: r.limit, people: list, lines: r.data });
    } catch {
      setMsg("Gagal menyiapkan slip bon");
    } finally {
      setSlipBusy(false);
    }
  };
  const shown = sortBy(
    (rows ?? []).filter(
      (r) =>
        (filter === "POTONG_GAJI" ? r.potong_gaji > 0 : filter === "INSTANSI" ? r.instansi > 0 : true) &&
        (statusF === "LUNAS" ? st(r) === "LUNAS" : statusF === "BELUM" ? !!st(r) && st(r) !== "LUNAS" : statusF === "KELUAR" ? keluar(r) : true) &&
        words.every((w) => [r.kode, r.nama, r.jabatan, r.estate, r.divisi].join(" ").toLowerCase().includes(w))
    ),
    sort,
    {
      kode: (r) => r.kode,
      nama: (r) => r.nama,
      jabatan: (r) => r.jabatan,
      estate: (r) => [r.estate, r.divisi].filter(Boolean).join(" / "),
      n_bon: (r) => r.n_bon,
      potong_gaji: (r) => r.potong_gaji,
      dibayar: (r) => r.dibayar,
      sisa: (r) => sisaOf(r),
      status: (r) => ["BELUM", "SEBAGIAN", "MENUNGGU", "LUNAS"].indexOf(st(r) ?? "z"),
      instansi: (r) => r.instansi,
      total: (r) => r.total,
    }
  );
  const sum = (f: (r: KopRekap) => number) => shown.reduce((s, r) => s + f(r), 0);
  const lewat = (r: KopRekap) => limit > 0 && r.potong_gaji > limit;
  const nLewat = shown.filter(lewat).length;
  const openRows = shown.filter((r) => sisaOf(r) > 0.5);
  const nBelum = (rows ?? []).filter((r) => st(r) === "BELUM" || st(r) === "SEBAGIAN").length;
  const pickedRows = openRows.filter((r) => picked.has(r.kode));
  const toggle = (kode: string) => setPicked((p) => (p.has(kode) ? new Set([...p].filter((x) => x !== kode)) : new Set([...p, kode])));
  const allPicked = openRows.length > 0 && openRows.every((r) => picked.has(r.kode));
  const tandaiLunas = async () => {
    setConfirmLunas(false);
    try {
      const r = await api.kopBayarLunas(
        periode,
        pickedRows.map((x) => x.kode),
        Object.fromEntries(pickedRows.map((x) => [x.kode, sisaOf(x)]))
      );
      setMsg(`${r.count} orang ditandai lunas (${rp(r.total)})`);
      setPicked(new Set());
      onChanged();
    } catch (e) {
      setMsg(errorText(e, "Gagal menandai lunas"));
    }
  };
  const buildReport = async () => ({
    title: `Rekap Potong Gaji Koperasi PT.AKSS - ${periodeLabel(periode)}`,
    subtitle: [
      filter === "POTONG_GAJI" ? "Karyawan dengan potong gaji" : filter === "INSTANSI" ? "Instansi (ditagih ke kantor)" : "Semua anggota",
      ...(cari.trim() ? [`Cari: ${cari.trim()}`] : []),
      ...(jatuhTempo ? [`Disetor ke HRD tgl 1, potong gaji paling lambat ${isoDisplay(jatuhTempo)}`] : []),
    ],
    landscape: true,
    columns: [
      { label: "No" },
      { label: "NIK" },
      { label: "Nama" },
      { label: "Jabatan" },
      { label: "Estate / Divisi" },
      { label: "Jml Bon", align: "right" as const },
      { label: "Potong Gaji (Rp)", align: "right" as const },
      { label: "Dibayar (Rp)", align: "right" as const },
      { label: "Sisa (Rp)", align: "right" as const },
      { label: "Status" },
      { label: "Instansi (Rp)", align: "right" as const },
      { label: "Total (Rp)", align: "right" as const },
    ],
    rows: [
      ...shown.map((r, i) => [
        i + 1,
        r.kode,
        r.nama || "-",
        r.jabatan,
        [r.estate, r.divisi].filter(Boolean).join(" / "),
        r.n_bon,
        r.potong_gaji,
        r.dibayar,
        sisaOf(r),
        st(r) ? STATUS_BAYAR[st(r)!].label : "-",
        r.instansi,
        r.total,
      ]),
      ["", "", "TOTAL", "", "", sum((r) => r.n_bon), sum((r) => r.potong_gaji), sum((r) => r.dibayar), sum(sisaOf), "", sum((r) => r.instansi), sum((r) => r.total)],
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
        <select value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} className={selectCls} aria-label="Status">
          <option value="">Semua status</option>
          <option value="BELUM">Belum lunas</option>
          <option value="LUNAS">Lunas</option>
          <option value="KELUAR">Tidak di master karyawan (resign / pindah?)</option>
        </select>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari NIK / nama / jabatan / divisi..." className={`${inputCls} pl-8`} />
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          {shown.length} orang · Potong gaji <b className="text-[var(--text-primary)]">{rp(sum((r) => r.potong_gaji))}</b> · sisa{" "}
          <b className={sum(sisaOf) > 0.5 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}>{rp(sum(sisaOf))}</b>
          {limit > 0 && ` · limit ${rp(limit)}/orang`}
          {nLewat > 0 && <b className="text-[var(--accent-red)]"> · {nLewat} melebihi limit</b>}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canInput && pickedRows.length > 0 && (
            <button onClick={() => setConfirmLunas(true)} className={btnPrimary}>
              Tandai lunas ({pickedRows.length})
            </button>
          )}
          <button
            onClick={() => cetakSlip(pickedRows.length ? pickedRows : shown)}
            disabled={slipBusy}
            title={pickedRows.length ? "Cetak slip yang dicentang" : "Cetak slip semua yang tampil (pakai filter / cari untuk memilih)"}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50"
          >
            <Receipt size={15} />
            {slipBusy ? "Menyiapkan..." : `Slip bon karyawan (${(pickedRows.length ? pickedRows : shown).filter((r) => r.potong_gaji > 0).length})`}
          </button>
          <ExportButtons total={shown.length} buildReport={buildReport} fileName={`koperasi-potong-gaji-${periode}`} />
        </div>
      </div>
      {keluarOpen.length > 0 && statusF !== "KELUAR" && (
        <div className="px-3 pt-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border-l-4 border-[var(--accent-red)] bg-[var(--accent-red-bg)] px-4 py-3 text-sm text-[var(--accent-red)]">
            <AlertTriangle size={20} className="shrink-0" />
            <p className="flex-1 min-w-[220px]">
              <b>
                {keluarOpen.length} karyawan masih punya tagihan {rp(keluarOpen.reduce((t, r) => t + sisaOf(r), 0))}
              </b>{" "}
              tapi sudah tidak ada di master karyawan (kemungkinan resign / pindah). Pastikan dipotong dari gaji terakhirnya atau ditagih langsung.
            </p>
            <button onClick={() => setStatusF("KELUAR")} className="px-3 py-1.5 rounded-md bg-[var(--accent-red)] text-white text-xs font-medium hover:opacity-90">
              Tampilkan
            </button>
          </div>
        </div>
      )}
      {jatuhTempo && (
        // A callout HR can't miss: when the rekap goes to HRD, when salaries are cut, and what to do after.
        <div className="px-3 py-3 border-b border-[var(--border)]">
          <div
            className={`flex gap-3 rounded-lg border-l-4 px-4 py-3 ${
              today > jatuhTempo && nBelum
                ? "bg-[var(--accent-red-bg)] border-[var(--accent-red)] text-[var(--accent-red)]"
                : today > jatuhTempo
                  ? "bg-[var(--accent-green-bg)] border-[var(--accent-green)] text-[var(--accent-green)]"
                  : "bg-[#fff7e0] border-[#f5b400] text-[#7a5200]"
            }`}
          >
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div className="text-sm space-y-1">
              <p className="font-semibold">
                Rekap {periodeLabel(periode)} disetor ke HRD tgl 1, dipotong dari gaji tgl 10–{isoDisplay(jatuhTempo)}.
              </p>
              {today <= jatuhTempo ? (
                canBayar ? (
                  <ol className="list-decimal pl-5 space-y-0.5">
                    <li>
                      Setelah gaji dipotong, <b>centang</b> yang sudah terpotong lalu tekan <b>Tandai lunas</b>.
                    </li>
                    <li>
                      Yang gajinya tidak cukup: tekan <b>Bayar</b> dan isi yang terpotong saja.
                    </li>
                  </ol>
                ) : (
                  <p>Setelah gaji dipotong, HR menandai lunas di sini.</p>
                )
              ) : nBelum ? (
                <p>
                  <b>{nBelum} orang belum lunas</b>: mereka tidak bisa ngebon lagi sampai tagihannya dilunasi.
                </p>
              ) : (
                <p>Semua sudah lunas.</p>
              )}
              {msg && <p className="font-semibold">{msg}</p>}
            </div>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              {canInput && (
                <th className="px-2 py-2.5">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    disabled={!openRows.length}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(openRows.map((r) => r.kode)))}
                    title="Pilih semua yang belum lunas"
                  />
                </th>
              )}
              <th className="px-3 py-2.5">No</th>
              <SortTh label="NIK" k="kode" sort={sort} setSort={setSort} />
              <SortTh label="Nama" k="nama" sort={sort} setSort={setSort} />
              <SortTh label="Jabatan" k="jabatan" sort={sort} setSort={setSort} />
              <SortTh label="Estate / Divisi" k="estate" sort={sort} setSort={setSort} />
              <SortTh label="Jml Bon" k="n_bon" sort={sort} setSort={setSort} num />
              <SortTh label="Potong Gaji" k="potong_gaji" sort={sort} setSort={setSort} num />
              <SortTh label="Dibayar" k="dibayar" sort={sort} setSort={setSort} num />
              <SortTh label="Sisa" k="sisa" sort={sort} setSort={setSort} num />
              <SortTh label="Status" k="status" sort={sort} setSort={setSort} />
              {filter !== "POTONG_GAJI" && <SortTh label="Instansi" k="instansi" sort={sort} setSort={setSort} num />}
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows === null ? (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  Tidak ada data di {periodeLabel(periode)}.
                </td>
              </tr>
            ) : (
              <>
                {shown.map((r, i) => {
                  const s = st(r);
                  const sisa = sisaOf(r);
                  return (
                    <tr key={r.kode} className={s === "BELUM" || s === "SEBAGIAN" ? "bg-[#fff7f7]" : ""}>
                      {canInput && (
                        <td className="px-2 py-2">{sisa > 0.5 && <input type="checkbox" checked={picked.has(r.kode)} onChange={() => toggle(r.kode)} aria-label={`Pilih ${r.nama}`} />}</td>
                      )}
                      <td className="px-3 py-2 text-[var(--text-muted)]">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.kode}</td>
                      <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                        <button onClick={() => setDetail(r)} className="text-left hover:underline" title="Lihat rincian bon">
                          {r.nama || <span className="italic text-[var(--text-muted)]">nama tidak tercatat</span>}
                        </button>
                        {keluar(r) && (
                          <span
                            title="NIK ini sudah tidak ada di master karyawan: kemungkinan resign / pindah. Tagihannya perlu diambil dari gaji terakhir."
                            className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${sisa > 0.5 ? "bg-[var(--accent-red-bg)] text-[var(--accent-red)] font-semibold" : "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"}`}
                          >
                            resign / pindah?
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.jabatan || "-"}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{[r.estate, r.divisi].filter(Boolean).join(" / ") || "-"}</td>
                      <td className="px-3 py-2 text-right">{r.n_bon}</td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${lewat(r) ? "text-[var(--accent-red)]" : ""}`} title={lewat(r) ? "Melebihi limit per bulan" : undefined}>
                        {r.potong_gaji ? rp(r.potong_gaji) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{r.dibayar ? rp(r.dibayar) : "-"}</td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap ${sisa > 0.5 ? "font-semibold text-[var(--accent-red)]" : "text-[var(--text-muted)]"}`}>{s ? (sisa > 0.5 ? rp(sisa) : "-") : "-"}</td>
                      <td className="px-3 py-2">
                        {s ? (
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_BAYAR[s].cls}`}>{STATUS_BAYAR[s].label}</span>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)]">ditagih ke kantor</span>
                        )}
                      </td>
                      {filter !== "POTONG_GAJI" && <td className="px-3 py-2 text-right whitespace-nowrap">{r.instansi ? rp(r.instansi) : "-"}</td>}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {s && (
                          <span className="inline-flex gap-3">
                            <button onClick={() => cetakSlip([r])} disabled={slipBusy} title="Cetak slip bon karyawan" className="text-xs text-[var(--text-secondary)] hover:underline">
                              Slip bon
                            </button>
                            <button onClick={() => setBayar(r)} className="text-xs text-[var(--accent-blue)] hover:underline">
                              {canBayar ? (sisa > 0.5 ? "Bayar" : "Pembayaran") : "Lihat"}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-[#f8fafc] font-semibold">
                  <td colSpan={canInput ? 6 : 5} className="px-3 py-2 text-right">
                    TOTAL
                  </td>
                  <td className="px-3 py-2 text-right">{sum((r) => r.n_bon)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{rp(sum((r) => r.potong_gaji))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{rp(sum((r) => r.dibayar))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-[var(--accent-red)]">{rp(sum(sisaOf))}</td>
                  <td />
                  {filter !== "POTONG_GAJI" && <td className="px-3 py-2 text-right whitespace-nowrap">{rp(sum((r) => r.instansi))}</td>}
                  <td />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {confirmLunas && (
        <ConfirmDialog
          title="Tandai lunas?"
          message={`${pickedRows.length} orang ditandai lunas lewat potong gaji ${periodeLabel(periode)}, total ${rp(pickedRows.reduce((s, r) => s + sisaOf(r), 0))}. Yang gajinya tidak cukup jangan dicentang - pakai tombol Bayar.`}
          confirmLabel="Ya, Tandai Lunas"
          onConfirm={tandaiLunas}
          onCancel={() => setConfirmLunas(false)}
        />
      )}
      {bayar && <BayarModal kode={bayar.kode} nama={bayar.nama} periode={periode} canBayar={canBayar} onClose={() => setBayar(null)} onChanged={onChanged} />}
      {detail && (
        <Modal title={`${detail.nama || detail.kode} · ${periodeLabel(periode)}`} subtitle={`${detail.kode} · total ${rp(detail.total)}`} onClose={() => setDetail(null)} wide>
          <TxTable jenis="JUAL" periode={periode} anggota={detail.kode} reload={reload} canEdit={false} onChanged={() => {}} />
        </Modal>
      )}
    </div>
  );
}

const CARA_LABEL: Record<KopCara, string> = { POTONG_GAJI: "Potong gaji", TUNAI: "Tunai", LAINNYA: "Lainnya" };

// Payments of one karyawan's bill of one periode: the list and, with Pelunasan Koperasi (HR), a new
// payment / Hapus. Without it the bill is only shown.
function BayarModal({
  kode,
  nama,
  periode,
  canBayar,
  onClose,
  onChanged,
}: {
  kode: string;
  nama: string;
  periode: string;
  canBayar: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const canInput = canBayar;
  const canEdit = canBayar;
  const [data, setData] = useState<{ tagihan: KopTagihan; data: KopBayarRow[] } | null>(null);
  const [jumlah, setJumlah] = useState("");
  const [cara, setCara] = useState<KopCara>("POTONG_GAJI");
  const [tanggal, setTanggal] = useState(localToday());
  const [ket, setKet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hapus, setHapus] = useState<KopBayarRow | null>(null);
  const load = () =>
    api
      .kopBayarList(kode, periode)
      .then((d) => (setData(d), setJumlah(rpText(Math.max(d.tagihan.sisa, 0)))))
      .catch((e) => setError(errorText(e, "Gagal memuat tagihan")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kode, periode]);
  const t = data?.tagihan;
  const save = async () => {
    const n = parseNum(jumlah || "0");
    if (!(n > 0)) return setError("Isi jumlah yang dibayar");
    setBusy(true);
    setError("");
    try {
      await api.kopBayar({ anggota_kode: kode, periode, jumlah: n, tanggal, cara, keterangan: ket });
      setKet("");
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan pembayaran"));
    } finally {
      setBusy(false);
    }
  };
  const doHapus = async () => {
    if (!hapus) return;
    try {
      await api.kopBayarHapus(hapus.id);
      setHapus(null);
      await load();
      onChanged();
    } catch (e) {
      setHapus(null);
      setError(errorText(e, "Gagal menghapus pembayaran"));
    }
  };
  return (
    <Modal title={`Pelunasan ${nama || kode}`} subtitle={`${kode} · tagihan ${periodeLabel(periode)}${t ? ` · jatuh tempo ${isoDisplay(t.jatuh_tempo)}` : ""}`} onClose={onClose}>
      {!t ? (
        <p className="text-sm text-[var(--text-muted)]">{error || "Memuat..."}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Tagihan", t.tagihan, ""],
              ["Dibayar", t.dibayar, "text-[var(--accent-green)]"],
              ["Sisa", Math.max(t.sisa, 0), t.sisa > 0.5 ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"],
            ].map(([l, v, c]) => (
              <div key={l as string} className="rounded-md border border-[var(--border)] px-2 py-2">
                <div className="text-[11px] text-[var(--text-secondary)]">{l}</div>
                <div className={`font-semibold ${c}`}>{rp(v as number)}</div>
              </div>
            ))}
          </div>
          {data!.data.length > 0 && (
            <div className="border border-[var(--border)] rounded-md divide-y divide-[var(--border)] text-sm">
              {data!.data.map((p) => (
                <div key={p.id} className="flex items-start gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div>
                      <b>{rp(p.jumlah)}</b> · {CARA_LABEL[p.cara] ?? p.cara} · {tanggalWaktu(p.tanggal_iso, p.created_at)}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {p.keterangan || "-"}
                      {p.oleh && ` · oleh ${p.oleh}`}
                    </div>
                  </div>
                  {canEdit && (
                    <button onClick={() => setHapus(p)} title="Hapus pembayaran ini" className="p-1 rounded text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canInput && t.sisa > 0.5 && (
            <div className="space-y-2 rounded-md border border-[var(--accent-blue-border)] p-3">
              <div className="text-xs font-medium text-[var(--text-primary)]">Catat pembayaran</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Jumlah</label>
                  <RpInput value={jumlah} onChange={setJumlah} />
                </div>
                <div>
                  <label className={labelCls}>Cara</label>
                  <select value={cara} onChange={(e) => setCara(e.target.value as KopCara)} className={`${selectCls} w-full`}>
                    <option value="POTONG_GAJI">Potong gaji</option>
                    <option value="TUNAI">Tunai</option>
                    <option value="LAINNYA">Lainnya</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tanggal</label>
                  <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Keterangan</label>
                  <input value={ket} onChange={(e) => setKet(e.target.value)} className={inputCls} placeholder="mis. gaji tidak cukup" />
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">Gaji tidak cukup? Isi yang terpotong saja; sisanya tetap tagihan dan orang ini tidak bisa ngebon sampai lunas.</p>
              {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
              <div className="flex justify-end">
                <button onClick={save} disabled={busy} className={btnPrimary}>
                  {busy ? "Menyimpan..." : "Simpan pembayaran"}
                </button>
              </div>
            </div>
          )}
          {t.sisa <= 0.5 && <p className="text-sm text-[var(--accent-green)] font-medium">Tagihan periode ini sudah lunas.</p>}
          {!canBayar && t.sisa > 0.5 && <p className="text-xs text-[var(--text-muted)]">Pelunasan dicatat oleh HR (akun dengan hak Pelunasan Koperasi).</p>}
        </div>
      )}
      {hapus && (
        <ConfirmDialog
          message={`Hapus pembayaran ${rp(hapus.jumlah)} (${isoDisplay(hapus.tanggal_iso)})? Tagihannya kembali belum lunas sebesar itu.`}
          onConfirm={doHapus}
          onCancel={() => setHapus(null)}
        />
      )}
    </Modal>
  );
}

// Top of the page: karyawan with a bill still open after its due date - they can't take goods.
function TunggakanBanner({ reload, canBayar, onChanged }: { reload: number; canBayar: boolean; onChanged: () => void }) {
  const [list, setList] = useState<KopTunggakan[]>([]);
  const [open, setOpen] = useState(false);
  const [bayar, setBayar] = useState<{ kode: string; nama: string; periode: string } | null>(null);
  useEffect(() => {
    api.kopTunggakan().then(setList).catch(() => setList([]));
  }, [reload]);
  if (!list.length) return null;
  const total = list.reduce((s, t) => s + t.sisa, 0);
  return (
    <div className="rounded-lg border border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)]">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <PackageX size={18} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            {list.length} karyawan belum melunasi tagihan koperasi · total {rp(total)}
          </div>
          <div className="text-xs">
            Mereka tidak bisa ngebon sampai tagihannya lunas.{" "}
            {open ? "Klik untuk menutup." : `${list.slice(0, 4).map((t) => t.nama).join(", ")}${list.length > 4 ? ", ..." : ""} - klik untuk melihat semua.`}
          </div>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <div className="bg-white rounded-md border border-[var(--accent-red-border)] divide-y divide-[var(--border)] text-sm text-[var(--text-primary)]">
            {list.map((t) => (
              <div key={t.kode} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="flex-1 min-w-[180px]">
                  <div className="font-medium">{t.nama}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {t.kode}
                    {t.jabatan && ` · ${t.jabatan}`}
                    {t.divisi && ` · ${t.divisi}`}
                  </div>
                </div>
                <div className="font-semibold text-[var(--accent-red)] whitespace-nowrap">{rp(t.sisa)}</div>
                <div className="flex flex-wrap gap-1">
                  {t.periode.map((p) => (
                    <button
                      key={p}
                      onClick={() => setBayar({ kode: t.kode, nama: t.nama, periode: p })}
                      className="text-xs px-2 py-0.5 rounded border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
                      title={canBayar ? "Catat pembayaran tagihan bulan ini" : "Lihat tagihan bulan ini"}
                    >
                      {periodeLabel(p)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {bayar && <BayarModal {...bayar} canBayar={canBayar} onClose={() => setBayar(null)} onChanged={onChanged} />}
    </div>
  );
}

// ---- Stok Barang ----
function StokTab({ reload, canEdit, canInput, onChanged }: { reload: number; canEdit: boolean; canInput: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<KopBarang[] | null>(null);
  const [search, setSearch] = useState("");
  const [aktif, setAktif] = useState("1");
  const [only, setOnly] = useState<"" | "ada" | "kosong" | "menipis" | "exp">("");
  const [editing, setEditing] = useState<KopBarang | "new" | null>(null);
  const [riwayat, setRiwayat] = useState<KopBarang | null>(null);
  // An expired barang on hand: its row offers Catat expired (the Barang Rusak / Expired form, filled in).
  const [catatExp, setCatatExp] = useState<KopBarang | null>(null);
  const [koreksi, setKoreksi] = useState<KopBarang | null>(null);
  useEffect(() => {
    setRows(null);
    api
      .kopBarang({ aktif })
      .then(setRows)
      .catch(() => setRows([]));
  }, [aktif, reload]);
  const q = search.trim().toLowerCase();
  const menipis = (b: KopBarang) => b.lacak_stok && b.stok <= b.stok_min;
  const kosong = (b: KopBarang) => b.lacak_stok && b.stok <= 0;
  const nAda = (rows ?? []).filter((b) => b.stok > 0).length;
  const nKosong = (rows ?? []).filter(kosong).length;
  const [sort, setSort] = useState<Sort>({ key: "nama", dir: "asc" });
  const shown = sortBy(
    (rows ?? []).filter(
      (b) => (!q || b.nama.toLowerCase().includes(q) || b.kode.toLowerCase().includes(q)) && (only === "ada" ? b.stok > 0 : only === "kosong" ? kosong(b) : only === "menipis" ? menipis(b) : only === "exp" ? !!expPerlu(b) : true)
    ),
    sort,
    {
      kode: (b) => b.kode,
      nama: (b) => b.nama,
      stok: (b) => (b.lacak_stok ? b.stok : null),
      harga_beli: (b) => b.harga_beli,
      harga_jual: (b) => b.harga_jual,
      terakhir: (b) => b.terakhir,
      exp: (b) => b.exp_terdekat ?? b.exp_iso,
    }
  );
  const buildReport = async () => ({
    title: "Stok Barang Koperasi PT.AKSS",
    subtitle: [`Per ${isoDisplay(localToday())}`],
    columns: [
      { label: "Kode" },
      { label: "Nama Barang" },
      { label: "Stok", align: "right" as const },
      { label: "Satuan" },
      { label: "Harga Beli (Rp)", align: "right" as const },
      { label: "Harga Jual (Rp)", align: "right" as const },
      { label: "Nilai Stok (Rp)", align: "right" as const },
      { label: "Expired" },
      { label: "Catatan" },
    ],
    rows: shown.map((b) => [
      b.kode,
      b.nama,
      b.lacak_stok ? b.stok : "tidak dilacak",
      b.satuan,
      b.harga_beli,
      b.harga_jual,
      b.lacak_stok ? Math.max(b.stok, 0) * b.harga_beli : "",
      (b.exp_batches ?? []).map((x) => `${isoDisplay(x.exp)}${b.lacak_stok && x.qty > 0 ? ` (${fmtQty(x.qty)} ${b.satuan})` : ""}`).join("; "),
      b.catatan,
    ]),
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
          <option value="kosong">Stok kosong</option>
          <option value="menipis">Menipis / habis</option>
          <option value="exp">Expired / ≤ 30 hari lagi</option>
        </select>
        <select value={aktif} onChange={(e) => setAktif(e.target.value)} className={selectCls} aria-label="Status">
          <option value="1">Barang aktif</option>
          <option value="0">Tidak aktif</option>
          <option value="">Semua</option>
        </select>
        <span className="text-xs text-[var(--text-muted)]">
          {shown.length} barang
          {rows && (
            <>
              {" · "}
              <span className="text-[var(--accent-green)]">{nAda} ada stok</span>
              {" · "}
              <span className="text-[var(--accent-red)]">{nKosong} kosong</span>
            </>
          )}
        </span>
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
              <SortTh label="Kode" k="kode" sort={sort} setSort={setSort} />
              <SortTh label="Nama Barang" k="nama" sort={sort} setSort={setSort} />
              <SortTh label="Stok" k="stok" sort={sort} setSort={setSort} num />
              <SortTh label="Harga Beli" k="harga_beli" sort={sort} setSort={setSort} num />
              <SortTh label="Harga Jual" k="harga_jual" sort={sort} setSort={setSort} num />
              <SortTh label="Expired" k="exp" sort={sort} setSort={setSort} />
              <SortTh label="Terakhir Bergerak" k="terakhir" sort={sort} setSort={setSort} desc />
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows === null ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[var(--text-muted)]">
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
                    {b.catatan && <div className="text-[11px] font-normal text-[var(--text-secondary)]">{b.catatan}</div>}
                  </td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${!b.lacak_stok ? "text-[var(--text-muted)]" : menipis(b) ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>
                    {b.lacak_stok ? `${fmtQty(b.stok)} ${b.satuan}` : <span className="text-xs font-normal">tidak dilacak</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{rp(b.harga_beli)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{rp(b.harga_jual)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {b.exp_batches?.length ? (
                      <>
                        {b.exp_batches.map((x) => {
                          const d = hariLagi(x.exp);
                          return (
                            <div key={x.exp} className={d < 0 ? "text-[var(--accent-red)] font-semibold" : d <= EXP_HARI ? "text-[var(--accent-amber)] font-semibold" : "text-[var(--text-secondary)]"}>
                              {isoDisplay(x.exp)}
                              {b.lacak_stok && x.qty > 0 && <span className="font-normal"> · {fmtQty(x.qty)} {b.satuan}</span>}
                            </div>
                          );
                        })}
                        {expPerlu(b) && <div className={`text-[10px] ${expPerlu(b) === "lewat" ? "text-[var(--accent-red)]" : "text-[var(--accent-amber)]"}`}>terdekat: {expText(b)}</div>}
                      </>
                    ) : (
                      <span className="text-[var(--text-muted)]">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--text-secondary)]">{b.terakhir ? isoDisplay(b.terakhir) : "-"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canInput && b.lacak_stok && qtyExpired(b) > 0 && (
                      <button
                        onClick={() => setCatatExp(b)}
                        title="Tarik dari rak, foto, lalu catat: diperiksa orang kedua sebelum dimusnahkan"
                        className="text-xs mr-2 px-2 py-0.5 rounded border border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)] hover:opacity-90"
                      >
                        Tarik ke Rusak / Expired
                      </button>
                    )}
                    <button onClick={() => setRiwayat(b)} className="text-xs text-[var(--accent-blue)] hover:underline mr-2">
                      Riwayat
                    </button>
                    {canEdit && b.lacak_stok && (
                      <button onClick={() => setKoreksi(b)} className="text-xs text-[var(--accent-blue)] hover:underline mr-2">
                        Koreksi
                      </button>
                    )}
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
      {catatExp && <RusakModal alasanAwal="EXPIRED" kodeAwal={catatExp.kode} onClose={() => setCatatExp(null)} onSuccess={() => (setCatatExp(null), onChanged())} />}
      {koreksi && <KoreksiModal barang={koreksi} onClose={() => setKoreksi(null)} onSuccess={() => (setKoreksi(null), onChanged())} />}
      {editing && <BarangModal barang={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSuccess={() => (setEditing(null), onChanged())} />}
      {riwayat && (
        <Modal title={riwayat.nama} subtitle={`${riwayat.kode} · stok ${riwayat.lacak_stok ? `${fmtQty(riwayat.stok)} ${riwayat.satuan}` : "tidak dilacak"}`} onClose={() => setRiwayat(null)} wide>
          <TxTable jenis="" periode="" barang={riwayat.kode} reload={reload} canEdit={false} onChanged={() => {}} />
        </Modal>
      )}
    </div>
  );
}

// Koreksi Stok, counted blind: the form doesn't show the stok sistem (no number to write down); the selisih
// shows after saving, and the stock only changes once a second account (Approve Koperasi) has checked it.
const KOREKSI_ALASAN: Record<string, string> = {
  SALAH_HITUNG: "Salah hitung sebelumnya",
  HILANG: "Hilang",
  SELISIH_BON: "Selisih bon / salah serah",
  SALAH_INPUT: "Salah input transaksi",
  LAINNYA: "Lainnya",
};
function KoreksiModal({ barang, onClose, onSuccess }: { barang: KopBarang; onClose: () => void; onSuccess: () => void }) {
  const fotoAktif = useEvidenceEnabled();
  const [tanggal, setTanggal] = useState(localToday());
  const [fisik, setFisik] = useState("");
  const [alasan, setAlasan] = useState("");
  const [ket, setKet] = useState("");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasil, setHasil] = useState<{ selisih: number; nilai: number } | null>(null);
  const n = parseNum(fisik || "x");
  const save = async () => {
    if (!(n >= 0)) return setError("Isi stok fisik hasil hitung (angka 0 atau lebih)");
    if (!alasan) return setError("Pilih alasannya");
    if (!ket.trim()) return setError("Tulis keterangannya");
    if (fotoAktif && !evidence) return setError("Foto barang yang dihitung wajib");
    setBusy(true);
    setError("");
    try {
      const r = await api.kopKoreksi({ tanggal, barang_kode: barang.kode, stok_fisik: n, alasan, keterangan: ket.trim(), evidence_id: evidence });
      setHasil({ selisih: r.selisih, nilai: r.nilai });
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan koreksi"));
    } finally {
      setBusy(false);
    }
  };
  if (hasil)
    return (
      <Modal title={`Koreksi Stok ${barang.nama}`} subtitle={barang.kode} onClose={onSuccess}>
        <div className="space-y-3 text-sm">
          {hasil.selisih === 0 ? (
            <p className="text-[var(--accent-green)]">Cocok: stok fisik sama dengan stok sistem. Tidak ada yang dikoreksi.</p>
          ) : (
            <>
              <p className={hasil.selisih < 0 ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"}>
                Selisih{" "}
                <b>
                  {hasil.selisih > 0 ? "+" : ""}
                  {fmtQty(hasil.selisih)} {barang.satuan}
                </b>{" "}
                ({rp(hasil.nilai)}).
              </p>
              <p className="text-[var(--text-secondary)]">Tersimpan sebagai menunggu pemeriksaan. Stok baru berubah setelah disetujui orang kedua yang punya hak Approve Koperasi.</p>
            </>
          )}
          <div className="flex justify-end">
            <button onClick={onSuccess} className={btnPrimary}>
              Tutup
            </button>
          </div>
        </div>
      </Modal>
    );
  return (
    <Modal title={`Koreksi Stok ${barang.nama}`} subtitle={`${barang.kode} · hitung fisiknya dulu, stok sistem tidak ditampilkan`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Stok fisik hasil hitung ({barang.satuan})</label>
            <input value={fisik} onChange={(e) => setFisik(e.target.value)} inputMode="decimal" className={inputCls} autoFocus />
          </div>
          <div>
            <label className={labelCls}>Tanggal</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Alasan</label>
            <select value={alasan} onChange={(e) => setAlasan(e.target.value)} className={`${selectCls} w-full`}>
              <option value="">-- Pilih --</option>
              {Object.entries(KOREKSI_ALASAN).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Keterangan</label>
            <input value={ket} onChange={(e) => setKet(e.target.value)} placeholder="mis. dihitung di rak 2 dan gudang" className={inputCls} />
          </div>
        </div>
        <EvidenceInput value={evidence} onChange={setEvidence} label="Foto barang yang dihitung (wajib)" />
        <p className="text-[11px] text-[var(--text-muted)]">Selisihnya muncul setelah disimpan; stok baru berubah setelah diperiksa orang kedua. Untuk menghitung banyak barang sekaligus pakai tab Stok Opname.</p>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
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

function BarangModal({ barang, onClose, onSuccess }: { barang: KopBarang | null; onClose: () => void; onSuccess: () => void }) {
  const [f, setF] = useState({
    nama: barang?.nama ?? "",
    satuan: barang?.satuan ?? "PCS",
    harga_beli: rpText(barang?.harga_beli ?? ""),
    harga_jual: rpText(barang?.harga_jual ?? ""),
    stok_min: String(barang?.stok_min ?? 0),
    aktif: barang?.aktif ?? true,
    lacak_stok: barang?.lacak_stok ?? true,
    exp_iso: barang?.exp_iso ?? "",
    catatan: barang?.catatan ?? "",
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
        exp_iso: f.exp_iso || null,
        catatan: f.catatan,
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
            <label className={labelCls}>Harga beli</label>
            <RpInput value={f.harga_beli} onChange={(v) => setF((x) => ({ ...x, harga_beli: v }))} />
          </div>
          <div>
            <label className={labelCls}>Harga jual ke anggota</label>
            <RpInput value={f.harga_jual} onChange={(v) => setF((x) => ({ ...x, harga_jual: v }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Tanggal expired stok lama</label>
            <input type="date" value={f.exp_iso} onChange={set("exp_iso")} className={inputCls} />
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Untuk stok yang masuk sebelum ada tanggal per Stock In. Stok baru: isi tanggalnya di Stock In.</p>
          </div>
          <div>
            <label className={labelCls}>Catatan (opsional)</label>
            <input value={f.catatan} onChange={set("catatan")} placeholder="mis. simpan di rak 2, merek pengganti" className={inputCls} />
          </div>
        </div>
        {barang && <KedatanganExp barang={barang} />}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.lacak_stok} onChange={set("lacak_stok")} /> Lacak stok (matikan untuk barang yang tidak dibeli, mis. air galon depo)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.aktif} onChange={set("aktif")} /> Aktif (muncul di form Stock Out / Stock In)
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

// In the barang form: the stock on hand per tanggal expired (as in Stok Barang) and the barang's Stock In
// arrivals, whose tanggal expired can be set or changed right here (saved as soon as it is picked).
function KedatanganExp({ barang }: { barang: KopBarang }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.kopKedatangan>> | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api
      .kopKedatangan(barang.kode)
      .then(setRows)
      .catch(() => setRows([]));
  }, [barang.kode]);
  const ubah = async (id: number, exp: string) => {
    setMsg("");
    try {
      await api.kopKedatanganExp(id, exp);
      setRows((r) => (r ?? []).map((x) => (x.id === id ? { ...x, exp_iso: exp || null } : x)));
      setMsg("Tanggal expired tersimpan. Kolom Expired di tabel ikut berubah setelah klik Simpan (atau muat ulang).");
    } catch (e) {
      setMsg(errorText(e, "Gagal menyimpan tanggal expired"));
    }
  };
  return (
    <div className="rounded-md border border-[var(--border)] p-3 space-y-2">
      <div>
        <div className={labelCls}>Sisa stok per tanggal expired</div>
        {barang.exp_batches?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {barang.exp_batches.map((x) => {
              const d = hariLagi(x.exp);
              return (
                <span
                  key={x.exp}
                  className={`text-xs px-2 py-0.5 rounded border ${
                    d < 0
                      ? "border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)]"
                      : d <= EXP_HARI
                        ? "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"
                        : "border-[var(--border)] text-[var(--text-secondary)]"
                  }`}
                >
                  {isoDisplay(x.exp)}
                  {barang.lacak_stok && x.qty > 0 && ` · ${fmtQty(x.qty)} ${barang.satuan}`}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Belum ada tanggal expired.</p>
        )}
      </div>
      <div>
        <div className={labelCls}>Tanggal expired per kedatangan (Stock In)</div>
        {rows === null ? (
          <p className="text-xs text-[var(--text-muted)]">Memuat...</p>
        ) : !rows.length ? (
          <p className="text-xs text-[var(--text-muted)]">Belum ada Stock In barang ini.</p>
        ) : (
          <div className="max-h-48 overflow-auto rounded border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#f8fafc] text-left text-[var(--text-secondary)]">
                  <th className="px-2 py-1">Masuk</th>
                  <th className="px-2 py-1 text-right">Jumlah</th>
                  <th className="px-2 py-1">No PO</th>
                  <th className="px-2 py-1">Tgl expired</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1 whitespace-nowrap">{isoDisplay(r.tanggal_iso)}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      {fmtQty(r.qty)} {barang.satuan}
                    </td>
                    <td className="px-2 py-1 text-[var(--text-secondary)]">{r.no_po || "-"}</td>
                    <td className="px-2 py-1">
                      <input
                        type="date"
                        defaultValue={r.exp_iso ?? ""}
                        onBlur={(e) => e.target.value !== (r.exp_iso ?? "") && ubah(r.id, e.target.value)}
                        className="text-xs rounded border border-[var(--border)] px-1.5 py-0.5"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {msg && <p className="text-[11px] text-[var(--text-secondary)] mt-1">{msg}</p>}
      </div>
    </div>
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
  const [sort, setSort] = useState<Sort>({ key: "", dir: "asc" });
  const shown = sortBy(
    (rows ?? []).filter((a) => !q || a.kode.toLowerCase().includes(q) || a.nama.toLowerCase().includes(q) || a.jabatan.toLowerCase().includes(q)),
    sort,
    {
      kode: (a) => a.kode,
      nama: (a) => a.nama,
      jabatan: (a) => a.jabatan,
      estate: (a) => [a.estate, a.divisi].filter(Boolean).join(" / "),
      terakhir: (a) => a.terakhir,
      bulan_ini: (a) => a.total_bulan_ini || null,
    }
  );
  const keluar = (rows ?? []).filter((a) => a.jenis === "KARYAWAN" && !a.di_master).length;
  const buildReport = async () => ({
    title: "Anggota Koperasi PT.AKSS",
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
      { label: "Bulan Ini (Rp)", align: "right" as const },
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
              <SortTh label="NIK / Kode" k="kode" sort={sort} setSort={setSort} />
              <SortTh label="Nama" k="nama" sort={sort} setSort={setSort} />
              <SortTh label="Jabatan" k="jabatan" sort={sort} setSort={setSort} />
              <SortTh label="Estate / Divisi" k="estate" sort={sort} setSort={setSort} />
              <SortTh label="Terakhir Ambil" k="terakhir" sort={sort} setSort={setSort} desc />
              <SortTh label="Bulan Ini" k="bulan_ini" sort={sort} setSort={setSort} num />
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
                  <td className="px-3 py-2 text-right whitespace-nowrap">{a.total_bulan_ini ? rp(a.total_bulan_ini) : "-"}</td>
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
        <Modal title={riwayat.nama || riwayat.kode} subtitle={`${riwayat.kode} · semua stock out`} onClose={() => setRiwayat(null)} wide>
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
          {value.jenis === "KARYAWAN" && value.di_master === false && (
            <div className="mt-1 text-[11px] font-semibold text-[var(--accent-red)]">Tidak ada di master karyawan (resign / pindah?): pastikan tagihannya masih bisa dipotong dari gaji.</div>
          )}
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

// Input for a rupiah amount: "Rp" in front, dots added while typing.
// Fix one Stock Out line typed wrong: another barang (its harga jual comes along), the jumlah or the harga.
function EditTxModal({ tx, onClose, onSuccess }: { tx: KopTx; onClose: () => void; onSuccess: () => void }) {
  const barang = useBarangAktif();
  const [pick, setPick] = useState<{ kode: string; nama: string; satuan: string; stok: number | null }>({ kode: tx.barang_kode, nama: tx.barang_nama, satuan: tx.satuan, stok: null });
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState(String(tx.qty).replace(".", ","));
  const [harga, setHarga] = useState(rpText(tx.harga));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const q = search.trim().toLowerCase();
  const options = q ? byStok(barang.filter((b) => b.nama.toLowerCase().includes(q) || b.kode.toLowerCase().includes(q))).slice(0, 10) : [];
  const choose = (b: KopBarang) => {
    setPick({ kode: b.kode, nama: b.nama, satuan: b.satuan, stok: b.lacak_stok ? b.stok + (b.kode === tx.barang_kode ? tx.qty : 0) : null });
    setHarga(rpText(b.harga_jual));
    setSearch("");
  };
  const n = parseNum(qty);
  const h = parseNum(harga || "0");
  const save = async () => {
    if (!(n > 0) || !(h >= 0)) return setError("Jumlah harus lebih dari 0 dan harga diisi angka");
    setBusy(true);
    setError("");
    try {
      await api.kopEditTx(tx.id, { barang_kode: pick.kode, qty: n, harga: h });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan perubahan"));
      setBusy(false);
    }
  };
  return (
    <Modal title="Edit Stock Out" subtitle={`${tx.anggota_nama || tx.anggota_kode} · ${isoDisplay(tx.tanggal_iso)} · semula ${tx.barang_nama} ${fmtQty(tx.qty)} ${tx.satuan} (${rp(tx.total)})`} onClose={onClose}>
      <div className="space-y-3">
        <div className="relative">
          <label className={labelCls}>Barang</label>
          <div className="mb-1.5 px-3 py-2 rounded-md bg-[#f8fafc] border border-[var(--border)] text-sm">
            <span className="font-medium text-[var(--text-primary)]">{pick.nama}</span> <span className="text-[11px] text-[var(--text-muted)]">{pick.kode}</span>
            {pick.kode !== tx.barang_kode && <span className="ml-2 text-[11px] text-[var(--accent-amber)]">diganti</span>}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && options[0]) {
                e.preventDefault();
                choose(options[0]);
              }
            }}
            placeholder="Ganti barang: ketik nama / kode"
            className={inputCls}
            autoFocus
          />
          {options.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto bg-white border border-[var(--border)] rounded-md shadow-lg">
              {options.map((b) => (
                <button key={b.kode} type="button" onClick={() => choose(b)} className="w-full flex justify-between gap-3 text-left px-3 py-2 text-sm hover:bg-[#f1f5f9] border-b border-[var(--border)] last:border-0">
                  <span>
                    <span className={stokCls(b)}>{b.nama}</span> <span className="text-[11px] text-[var(--text-muted)]">{b.kode}</span>
                  </span>
                  <span className={`text-xs whitespace-nowrap ${stokCls(b)}`}>
                    {b.lacak_stok ? `stok ${fmtQty(b.stok)} ${b.satuan}` : "tanpa stok"} · {rp(b.harga_jual)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Jumlah ({pick.satuan})</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputCls} />
            {pick.stok !== null && <p className={`text-[11px] mt-0.5 ${n > pick.stok ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]"}`}>tersedia {fmtQty(pick.stok)} {pick.satuan}</p>}
          </div>
          <div>
            <label className={labelCls}>Harga (dari master barang)</label>
            <div className={`${inputCls} bg-[#f8fafc] text-right`}>{rp(h >= 0 ? h : 0)}</div>
          </div>
        </div>
        <p className="text-sm">
          Total baru <b>{rp((n > 0 ? n : 0) * (h >= 0 ? h : 0))}</b>
        </p>
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

function RpInput({ value, onChange, small = false }: { value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div className="relative">
      <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none ${small ? "text-xs" : "text-sm"}`}>Rp</span>
      <input
        value={value}
        onChange={(e) => onChange(rpText(e.target.value))}
        inputMode="numeric"
        className={small ? "w-full text-sm rounded border border-[var(--border)] pl-7 pr-2 py-1 text-right" : `${inputCls} pl-8 text-right`}
      />
    </div>
  );
}

// ---- Forms: lines of barang (pengambilan uses harga jual, pembelian harga beli) ----
type Line = { barang: KopBarang; qty: string; harga: string; exp?: string };

// Barang lists: in stock first (a barang without stock tracking counts as available), coloured by it.
const adaStok = (b: KopBarang) => !b.lacak_stok || b.stok > 0;
const byStok = (list: KopBarang[]) => [...list].sort((a, b) => Number(adaStok(b)) - Number(adaStok(a)));
const stokCls = (b: KopBarang) => (adaStok(b) ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]");

// Expiry of a barang that is still on hand (stock or not tracked): "lewat" = past, "dekat" = within 30 days.
const EXP_HARI = 30;
const hariLagi = (iso: string) => Math.round((Date.parse(iso) - Date.parse(localToday())) / 86400000);
function expPerlu(b: KopBarang): "lewat" | "dekat" | null {
  const exp = b.exp_terdekat ?? b.exp_iso;
  if (!exp || !b.aktif || (b.lacak_stok && b.stok <= 0)) return null;
  const d = hariLagi(exp);
  return d < 0 ? "lewat" : d <= EXP_HARI ? "dekat" : null;
}
const expText = (b: KopBarang) => {
  const d = hariLagi((b.exp_terdekat ?? b.exp_iso)!);
  return d < 0 ? `expired ${-d} hari lalu` : d === 0 ? "expired hari ini" : `${d} hari lagi`;
};

// Top of Stock In, Rusak & Koreksi: every barang whose stock on hand is past its tanggal expired shows up
// here by itself, to be pulled off the shelf and processed. Nothing is booked automatically: Tarik opens
// the Barang Rusak / Expired form filled in (qty, dates), the physical count and a photo are still needed,
// then the second person's check and the Berita Acara.
function ExpiredPerluDitarik({ reload, canInput, onChanged }: { reload: number; canInput: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<KopBarang[]>([]);
  const [tarik, setTarik] = useState<KopBarang | null>(null);
  useEffect(() => {
    api
      .kopBarang({ aktif: "1" })
      .then((r) => setRows(r.filter((b) => b.lacak_stok && qtyExpired(b) > 0)))
      .catch(() => setRows([]));
  }, [reload]);
  if (!rows.length) return null;
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--accent-red-border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] rounded-t-lg">
        <CalendarClock size={18} className="text-[var(--accent-red)]" />
        <h2 className="text-sm font-semibold text-[var(--accent-red)]">Expired, perlu ditarik ({rows.length} barang)</h2>
        <span className="text-xs text-[var(--accent-red)] opacity-90">Masih tercatat sebagai stok. Tarik dari rak, hitung, foto, lalu klik Tarik; setelah diperiksa orang kedua masuk Berita Acara.</span>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-secondary)]">
              <th className="px-3 py-2">Barang</th>
              <th className="px-3 py-2 text-right">Stok expired</th>
              <th className="px-3 py-2">Tanggal expired</th>
              <th className="px-3 py-2 text-right">Nilai (harga beli)</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((b) => {
              const q = qtyExpired(b);
              const tgl = (b.exp_batches ?? []).filter((e) => hariLagi(e.exp) < 0);
              return (
                <tr key={b.kode}>
                  <td className="col-grow px-3 py-2">
                    <div className="text-[var(--text-primary)]">{b.nama}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{b.kode}</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-semibold text-[var(--accent-red)]">
                    {fmtQty(q)} {b.satuan}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--accent-red)]">
                    {tgl.map((e) => `${isoDisplay(e.exp)} (${-hariLagi(e.exp)} hari lalu)`).join(", ")}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{rp(q * b.harga_beli)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canInput ? (
                      <button onClick={() => setTarik(b)} className="text-xs px-2.5 py-1 rounded-md bg-[var(--accent-red)] text-white hover:opacity-90">
                        Tarik ke Rusak / Expired
                      </button>
                    ) : (
                      <span className="text-[11px] text-[var(--text-muted)]">perlu hak Input Koperasi</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {tarik && <RusakModal alasanAwal="EXPIRED" kodeAwal={tarik.kode} onClose={() => setTarik(null)} onSuccess={() => (setTarik(null), onChanged())} />}
    </div>
  );
}

// Card of the barang on hand that are expired or expire within 30 days (like Klinik's); opens that list.
function ExpCard({ reload, onLihat }: { reload: number; onLihat: () => void }) {
  const [rows, setRows] = useState<KopBarang[]>([]);
  useEffect(() => {
    api
      .kopBarang({ aktif: "1" })
      .then(setRows)
      .catch(() => setRows([]));
  }, [reload]);
  const lewat = rows.filter((b) => expPerlu(b) === "lewat");
  const dekat = rows.filter((b) => expPerlu(b) === "dekat");
  const n = lewat.length + dekat.length;
  return (
    <StatCard
      label={`Expired / ≤ ${EXP_HARI} Hari`}
      value={n.toLocaleString("id-ID")}
      icon={CalendarClock}
      tone={lewat.length ? "red" : dekat.length ? "amber" : "green"}
      onClick={onLihat}
      title="Lihat barang expired / segera expired"
      footer={
        <span className={`text-[11px] line-clamp-1 ${lewat.length ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]"}`}>
          {n ? `${lewat.length} sudah expired · ${dekat.length} segera` : "tidak ada yang expired"}
        </span>
      }
    />
  );
}

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
  const options = q ? byStok(barang.filter((b) => (b.nama.toLowerCase().includes(q) || b.kode.toLowerCase().includes(q)) && !lines.some((l) => l.barang.kode === b.kode))).slice(0, 12) : [];
  const add = (b: KopBarang) => {
    setLines((l) => [...l, { barang: b, qty: "1", harga: rpText(harga === "jual" ? b.harga_jual : b.harga_beli) }]);
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
                  <span className={stokCls(b)}>{b.nama}</span> <span className="text-[11px] text-[var(--text-muted)]">{b.kode}</span>
                </span>
                <span className={`text-xs whitespace-nowrap ${stokCls(b)}`}>
                  {b.lacak_stok ? `stok ${fmtQty(b.stok)} ${b.satuan}` : "tanpa stok"} · {rp(harga === "jual" ? b.harga_jual : b.harga_beli)}
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
                <th className="px-2 py-1.5 w-36">{harga === "jual" ? "Harga" : "Harga beli"}</th>
                {harga === "beli" && <th className="px-2 py-1.5 w-36">Tgl expired</th>}
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
                      {harga === "jual" ? <div className="text-right py-1 px-2 whitespace-nowrap">{rp(parseNum(l.harga) || 0)}</div> : <RpInput small value={l.harga} onChange={(v) => update(i, "harga", v)} />}
                    </td>
                    {harga === "beli" && (
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={l.exp ?? ""}
                          onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, exp: e.target.value } : y)))}
                          title="Tanggal expired barang yang datang ini (opsional)"
                          className="w-full text-sm rounded border border-[var(--border)] px-1.5 py-1"
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{rp(qty * (parseNum(l.harga) || 0))}</td>
                    <td className="px-1 py-1.5">
                      <button onClick={() => setLines((x) => x.filter((_, j) => j !== i))} title="Hapus baris" className="p-1 rounded text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-[var(--border)] font-semibold">
                <td colSpan={harga === "beli" ? 4 : 3} className="px-2 py-1.5 text-right">
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

const linesBody = (lines: Line[]) => lines.map((l) => ({ barang_kode: l.barang.kode, qty: parseNum(l.qty), harga: parseNum(l.harga || "0"), ...(l.exp ? { exp_iso: l.exp } : {}) }));
const linesError = (lines: Line[]) =>
  !lines.length ? "Tambahkan minimal satu barang" : lines.some((l) => !(parseNum(l.qty) > 0) || !(parseNum(l.harga || "0") >= 0)) ? "Jumlah harus lebih dari 0 dan harga diisi angka" : "";

function JualModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [tanggal, setTanggal] = useState(localToday());
  const [anggota, setAnggota] = useState<KopAnggota | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [limit, setLimit] = useState<{ limit: number; terpakai: number; sisa: number; tunggakan: { sisa: number; periode: string[]; pesan: string } | null } | null>(null);
  const periode = tanggal.slice(0, 7);
  useEffect(() => {
    setLimit(null);
    if (!anggota || anggota.jenis === "INSTANSI") return;
    api.kopLimit(anggota.kode, periode).then(setLimit).catch(() => setLimit(null));
  }, [anggota, periode]);
  const total = lines.reduce((s, l) => s + (parseNum(l.qty) || 0) * (parseNum(l.harga) || 0), 0);
  const lewat = !!limit && total > limit.sisa + 0.005;
  const nunggak = limit?.tunggakan ?? null;
  const [keterangan, setKeterangan] = useState("");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!anggota) return setError("Pilih anggota / karyawan");
    const le = linesError(lines);
    if (le) return setError(le);
    if (nunggak) return setError(nunggak.pesan);
    if (lewat) return setError(`Melebihi limit: sisa ${rp(limit!.sisa)} di ${periodeLabel(periode)}`);
    setBusy(true);
    setError("");
    try {
      await api.kopJual({ tanggal, anggota_kode: anggota.kode, bayar: anggota.jenis === "INSTANSI" ? "INSTANSI" : "POTONG_GAJI", keterangan, evidence_id: evidence, items: linesBody(lines) });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan stock out"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Input Stock Out" subtitle={`Masuk potong gaji periode ${periodeLabel(tanggal.slice(0, 7))}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3">
          <AnggotaPicker value={anggota} onChange={setAnggota} />
          <div>
            <label className={labelCls}>Tanggal</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
          </div>
        </div>
        {nunggak && (
          <div className="rounded-md border border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] px-3 py-2 text-sm text-[var(--accent-red)] font-medium">
            Tidak bisa ngebon: {nunggak.pesan}
          </div>
        )}
        {limit && !nunggak && (
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
          <button onClick={save} disabled={busy || lewat || !!nunggak} className={btnPrimary}>
            <Banknote size={16} /> {busy ? "Menyimpan..." : "Simpan Stock Out"}
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
      setError(errorText(e, "Gagal menyimpan stock in"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Input Stock In" subtitle="Barang masuk ke stok koperasi" onClose={onClose} wide>
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
            {busy ? "Menyimpan..." : "Simpan Stock In"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Barang Rusak / Expired: entered with a photo, checked by a second account (Approve Koperasi) who
// matches the barang on hand; what is approved goes on the Berita Acara Pemusnahan. ----
const ALASAN_LABEL: Record<string, string> = { EXPIRED: "Expired", RUSAK: "Rusak", ...KOREKSI_ALASAN };
const STATUS_RUSAK: Record<"MENUNGGU" | "DISETUJUI" | "DITOLAK", { label: string; cls: string }> = {
  MENUNGGU: { label: "Menunggu pemeriksaan", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  DISETUJUI: { label: "Disetujui", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  DITOLAK: { label: "Ditolak, stok kembali", cls: "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]" },
};
const periksaText = (t: KopTx) =>
  t.opname_id ? `Stok Opname #${t.opname_id}` : `${STATUS_RUSAK[t.status ?? "DISETUJUI"].label}${t.status && t.status !== "MENUNGGU" ? ` oleh ${t.diperiksa_nama || "-"}${t.diperiksa_catatan ? ` (${t.diperiksa_catatan})` : ""}` : ""}`;
// Stock on hand of a barang that is already past its tanggal expired (from its FEFO batches).
const qtyExpired = (b: KopBarang) => (b.exp_batches ?? []).filter((x) => hariLagi(x.exp) < 0).reduce((s, x) => s + x.qty, 0);

async function fetchAllTx(params: Record<string, string>) {
  const first = await api.kopTx({ ...params, page: 1, pageSize: 500 });
  let rows = first.data;
  for (let p = 2; rows.length < first.total && p <= 40; p++) rows = rows.concat((await api.kopTx({ ...params, page: p, pageSize: 500 })).data);
  return rows;
}

// Berita Acara of the approved Barang Rusak / Expired (pemusnahan) or Koreksi Stok (selisih) of a periode,
// with signature boxes. Koreksi also sums the minus / plus per petugas, to see who corrects often.
async function cetakBeritaAcara(jenis: "RUSAK" | "KOREKSI", periode: string) {
  const kor = jenis === "KOREKSI";
  const all = await fetchAllTx({ jenis, status: "DISETUJUI", periode });
  if (!all.length) throw new Error(`Belum ada ${kor ? "koreksi stok" : "barang rusak / expired"} yang disetujui di ${periodeLabel(periode)}`);
  const uniq = (v: (string | null)[]) => [...new Set(v.filter(Boolean))].join(", ");
  const minus = all.filter((t) => t.total < 0).reduce((s, t) => s + t.total, 0);
  const plus = all.filter((t) => t.total > 0).reduce((s, t) => s + t.total, 0);
  const perPetugas = new Map<string, { n: number; minus: number; plus: number }>();
  for (const t of all) {
    const k = t.opname_id ? `Stok Opname #${t.opname_id}` : t.oleh || "-";
    const r = perPetugas.get(k) ?? { n: 0, minus: 0, plus: 0 };
    r.n++;
    if (t.total < 0) r.minus += t.total;
    else r.plus += t.total;
    perPetugas.set(k, r);
  }
  printTable({
    title: kor ? "Berita Acara Selisih Stok (Koreksi)" : "Berita Acara Pemusnahan Barang Rusak / Expired",
    subtitle: kor
      ? [
          `Koperasi PT.AKSS · Periode ${periodeLabel(periode)} · kurang ${rp(minus)} · lebih ${rp(plus)} · bersih ${rp(minus + plus)} (harga beli)`,
          `Per petugas: ${[...perPetugas].map(([k, r]) => `${k} ${r.n}x (kurang ${rp(r.minus)}, lebih ${rp(r.plus)})`).join(" · ")}`,
        ]
      : [
          `Koperasi PT.AKSS · Periode ${periodeLabel(periode)} · nilai (harga beli) ${rp(all.reduce((s, t) => s + t.total, 0))}`,
          "Barang di bawah ini sudah diperiksa dan dicocokkan fisiknya, lalu dimusnahkan (kemasan dirusak / dihancurkan) di hadapan para saksi pada tanggal ..............................",
        ],
    columns: [
      { label: "No", align: "right" },
      { label: "Tanggal" },
      { label: "Kode" },
      { label: "Nama Barang" },
      { label: kor ? "Selisih" : "Jumlah", align: "right" },
      { label: "Alasan" },
      { label: "Keterangan" },
      { label: "Nilai (Rp)", align: "right" },
      { label: "Input / Diperiksa" },
    ],
    rows: all.map((t, i) => [
      i + 1,
      isoDisplay(t.tanggal_iso),
      t.barang_kode,
      t.barang_nama,
      `${kor && t.qty > 0 ? "+" : ""}${fmtQty(t.qty)} ${t.satuan}`,
      t.alasan ? (ALASAN_LABEL[t.alasan] ?? t.alasan) : kor ? (t.opname_id ? "Stok opname" : "-") : "Rusak",
      t.keterangan,
      t.total,
      t.opname_id ? `Stok Opname #${t.opname_id}` : `${t.oleh || "-"} / ${t.diperiksa_nama || "-"}`,
    ]),
    landscape: true,
    signatures: kor
      ? [
          { label: "Petugas Koperasi", nama: uniq(all.map((t) => (t.opname_id ? null : t.oleh))) },
          { label: "Pemeriksa", nama: uniq(all.map((t) => t.diperiksa_nama)) },
          { label: "Mengetahui", nama: "" },
        ]
      : [
          { label: "Petugas Koperasi", nama: uniq(all.map((t) => t.oleh)) },
          { label: "Pemeriksa", nama: uniq(all.map((t) => t.diperiksa_nama)) },
          { label: "Saksi 1", nama: "" },
          { label: "Saksi 2", nama: "" },
          { label: "Mengetahui", nama: "" },
        ],
  });
}

// Reminder at the top of the Koperasi page: Barang Rusak / Expired still waiting for their pemeriksaan.
function RusakMenungguBanner({ reload, canApprove, onLihat }: { reload: number; canApprove: boolean; onLihat: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    api
      .kopTx({ jenis: "", status: "MENUNGGU", page: 1, pageSize: 1 })
      .then((r) => setN(r.total))
      .catch(() => setN(0));
  }, [reload]);
  if (!n) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 w-full min-w-0 rounded-lg border border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] px-4 py-3 text-sm text-[var(--accent-amber)]">
      <ClipboardCheck size={20} className="shrink-0" />
      <p className="flex-1 min-w-[220px]">
        <b>{n} barang rusak / expired / koreksi stok menunggu pemeriksaan</b>
        <span className="block text-xs opacity-90">
          {canApprove ? "Cocokkan barang fisik dan fotonya, lalu Setujui atau Tolak." : "Perlu diperiksa orang yang punya hak Approve Koperasi."} Barang rusak / expired sudah ditahan; koreksi baru mengubah stok setelah disetujui.
        </span>
      </p>
      <button onClick={onLihat} className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[var(--accent-amber)] hover:opacity-90">
        Lihat
      </button>
    </div>
  );
}

const jamKop = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

// The four steps of a Barang Rusak / Expired above its list, with how many wait for the check and how
// many were approved this periode.
function KopAlurRusak({ periode, reload }: { periode: string; reload: number }) {
  const [n, setN] = useState<{ menunggu: number; disetujui: number; ditolak: number } | null>(null);
  const petugas = usePetugas("KOPERASI", "NILAM");
  useEffect(() => {
    const hitung = (status: string, p = "") => api.kopTx({ jenis: "RUSAK", status, periode: p, page: 1, pageSize: 1 }).then((r) => r.total);
    Promise.all([hitung("MENUNGGU"), hitung("DISETUJUI", periode), hitung("DITOLAK", periode)])
      .then(([menunggu, disetujui, ditolak]) => setN({ menunggu, disetujui, ditolak }))
      .catch(() => setN(null));
  }, [periode, reload]);
  const langkah = [
    { icon: PackageX, judul: "1. Tarik & simpan", isi: "Petugas: tarik dari rak, hitung, foto, catat Rusak / Expired (stok langsung ditahan)", angka: "", siapa: petugas && { judul: "Petugas", nama: petugas.input, kosong: "belum ada akun dengan hak Input Koperasi" } },
    { icon: ClipboardCheck, judul: "2. Periksa", isi: "Orang kedua (hak Approve Koperasi) cocokkan fisik & foto", angka: n?.menunggu ? `${n.menunggu} menunggu` : "", siapa: petugas && { judul: "Pemeriksa (bukan yang menginput)", nama: petugas.approve, kosong: "belum ada akun dengan hak Approve Koperasi" } },
    { icon: ShieldCheck, judul: "3. Disetujui", isi: "Stok resmi keluar; ditolak = stok kembali", angka: n ? `${n.disetujui} disetujui${n.ditolak ? ` · ${n.ditolak} ditolak` : ""} (${periodeLabel(periode)})` : "", siapa: petugas && { judul: "Diputuskan oleh pemeriksa", nama: petugas.approve, kosong: "belum ada akun dengan hak Approve Koperasi" } },
    { icon: FileText, judul: "4. Berita Acara", isi: "Musnahkan disaksikan 2 orang, cetak & tanda tangani BA", angka: "", siapa: petugas && { judul: "Menyetujui BA", nama: petugas.ba, kosong: "belum ada akun dengan hak Setujui Berita Acara" } },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 -mt-1">
      {langkah.map((l, i) => (
        <div key={l.judul} className={`rounded-lg border px-3 py-2.5 ${i === 1 && n?.menunggu ? "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)]" : "border-[var(--border)] bg-[var(--bg-card)]"}`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <l.icon size={16} className="text-[var(--accent-blue)]" /> {l.judul}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{l.isi}</div>
          {l.angka && <div className={`mt-1 text-xs font-medium ${i === 1 ? "text-[var(--accent-amber)]" : "text-[var(--accent-green)]"}`}>{l.angka}</div>}
          {l.siapa && <PetugasBaris judul={l.siapa.judul} nama={l.siapa.nama} kosong={l.siapa.kosong} pengganti={petugas?.pengganti ?? []} />}
        </div>
      ))}
    </div>
  );
}

// One Barang Rusak / Expired or Koreksi Stok: each step with who, when, foto and catatan, and what is left.
function KopDetailProses({ t, bisaPeriksa, onPeriksa, onBa, onClose }: { t: KopTx; bisaPeriksa: boolean; onPeriksa: () => void; onBa?: () => void; onClose: () => void }) {
  const kor = t.jenis === "KOREKSI";
  const st = t.status ?? "DISETUJUI";
  const lama = !t.status;
  const langkah: { judul: string; selesai: boolean; aktif?: boolean; merah?: boolean; isi: ReactNode }[] = [
    {
      judul: kor ? "Dihitung & dicatat" : "Ditarik & dicatat",
      selesai: true,
      isi: (
        <>
          <div>
            {jamKop(t.created_at)} · oleh <b>{t.oleh || "-"}</b>
          </div>
          <div>
            {kor && t.qty > 0 ? "+" : ""}
            {fmtQty(t.qty)} {t.satuan} · {t.alasan ? (ALASAN_LABEL[t.alasan] ?? t.alasan) : kor ? "Koreksi" : "Rusak"}
            {t.total ? ` · ${rp(t.total)}` : ""}
          </div>
          <div className="text-[var(--text-secondary)]">
            {t.keterangan || "-"} <EvidenceLink id={t.evidence_id} label="lihat foto" />
          </div>
        </>
      ),
    },
    {
      judul: st === "MENUNGGU" ? "Menunggu pemeriksaan" : st === "DITOLAK" ? "Ditolak pemeriksa" : lama ? "Pemeriksaan" : "Diperiksa & disetujui",
      selesai: st !== "MENUNGGU",
      aktif: st === "MENUNGGU",
      merah: st === "DITOLAK",
      isi: lama ? (
        <div className="text-[var(--text-muted)]">Dicatat sebelum ada tahap pemeriksaan; dianggap disetujui.</div>
      ) : st === "MENUNGGU" ? (
        <div className="text-[var(--accent-amber)]">
          {kor ? "Stok belum berubah sampai disetujui." : "Stok sudah ditahan (tidak bisa dijual)."} Perlu diperiksa orang lain yang punya hak Approve Koperasi.
        </div>
      ) : (
        <>
          <div>
            {t.diperiksa_at ? jamKop(t.diperiksa_at) : "-"} · oleh <b>{t.diperiksa_nama || "-"}</b>
          </div>
          {t.diperiksa_catatan && <div className="text-[var(--text-secondary)]">Catatan: {t.diperiksa_catatan}</div>}
          {st === "DITOLAK" && <div className="text-[var(--accent-red)]">{kor ? "Stok tidak diubah." : "Stok dikembalikan."}</div>}
        </>
      ),
    },
    ...(st === "DITOLAK"
      ? []
      : [
          {
            judul: kor ? "Berita Acara Selisih Stok" : "Pemusnahan & Berita Acara",
            selesai: false,
            aktif: st === "DISETUJUI",
            isi: (
              <div className="text-[var(--text-secondary)]">
                {st !== "DISETUJUI" ? "Setelah disetujui." : kor ? "Masuk Berita Acara Selisih Stok periode ini." : "Siap dimusnahkan (disaksikan 2 orang) lalu cetak Berita Acara-nya."}
              </div>
            ),
          },
        ]),
  ];
  return (
    <Modal title={t.barang_nama} subtitle={`${t.barang_kode} · proses ${kor ? "koreksi stok" : "barang rusak / expired"}`} onClose={onClose}>
      <ol className="space-y-4">
        {langkah.map((l, i) => (
          <li key={l.judul} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border ${
                  l.merah
                    ? "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]"
                    : l.selesai
                      ? "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]"
                      : l.aktif
                        ? "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]"
                        : "bg-white border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                {l.merah ? <X size={14} /> : l.selesai ? <Check size={14} /> : i + 1}
              </span>
              {i < langkah.length - 1 && <span className="flex-1 w-px bg-[var(--border)] mt-1" />}
            </div>
            <div className="flex-1 pb-1 text-sm">
              <div className="font-semibold text-[var(--text-primary)]">{l.judul}</div>
              <div className="mt-0.5 space-y-0.5 text-xs">{l.isi}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end gap-2">
        {bisaPeriksa && (
          <button onClick={onPeriksa} className={btnPrimary}>
            <ClipboardCheck size={15} /> Periksa sekarang
          </button>
        )}
        {st === "DISETUJUI" && onBa && (
          <button onClick={onBa} className={btnOutline}>
            <FileText size={15} /> Berita Acara
          </button>
        )}
        <button onClick={onClose} className={btnOutline}>
          Tutup
        </button>
      </div>
    </Modal>
  );
}

function PeriksaRusakModal({ tx, onClose, onSuccess }: { tx: KopTx; onClose: () => void; onSuccess: () => void }) {
  const kor = tx.jenis === "KOREKSI";
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kirim = async (setuju: boolean) => {
    if (!setuju && !catatan.trim()) return setError("Tulis alasan penolakannya");
    setBusy(true);
    setError("");
    try {
      await api.kopPeriksa(kor ? "KOREKSI" : "RUSAK", tx.id, { setuju, catatan: catatan.trim() });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={kor ? "Periksa Koreksi Stok" : "Periksa Barang Rusak / Expired"}
      subtitle={kor ? "Hitung ulang barangnya sendiri sebelum menyetujui" : "Cocokkan dengan barang fisiknya dan fotonya"}
      onClose={onClose}
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-md border border-[var(--border)] p-3 space-y-1">
          <div className="font-medium text-[var(--text-primary)]">
            {tx.barang_nama} <span className="text-xs text-[var(--text-muted)]">{tx.barang_kode}</span>
          </div>
          <div>
            <b className={kor ? (tx.qty < 0 ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]") : ""}>
              {kor && tx.qty > 0 ? "+" : ""}
              {fmtQty(tx.qty)} {tx.satuan}
            </b>{" "}
            · {tx.alasan ? (ALASAN_LABEL[tx.alasan] ?? tx.alasan) : "Rusak"} · {isoDisplay(tx.tanggal_iso)}
            {tx.total > 0 && <span className="text-[var(--text-muted)]"> · nilai {rp(tx.total)}</span>}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {tx.keterangan} <EvidenceLink id={tx.evidence_id} label="lihat foto" />
          </div>
          <div className="text-xs text-[var(--text-muted)]">diinput oleh {tx.oleh || "-"}</div>
        </div>
        {kor ? (
          <ul className="text-xs text-[var(--text-secondary)] list-disc pl-4 space-y-0.5">
            <li>Hitung ulang sendiri: hasilnya sama dengan stok fisik yang diinput?</li>
            <li>Alasannya masuk akal? Cek Riwayat barang ini (Stock Out / Stock In terakhir, bon).</li>
            <li>Bila hilang: sudah jelas siapa yang bertanggung jawab / dilaporkan?</li>
          </ul>
        ) : (
          <ul className="text-xs text-[var(--text-secondary)] list-disc pl-4 space-y-0.5">
            <li>Jumlah fisiknya sama dengan yang diinput?</li>
            <li>Tanggal expired di kemasan / kerusakannya sesuai foto?</li>
            <li>Barangnya masih ada di tempat barang rusak (belum dibuang)?</li>
          </ul>
        )}
        <div>
          <label className={labelCls}>Catatan (wajib bila ditolak)</label>
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. fisik hanya 10, bukan 16" className={inputCls} />
        </div>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => kirim(false)}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)] disabled:opacity-50"
          >
            {kor ? "Tolak (stok tidak berubah)" : "Tolak (stok kembali)"}
          </button>
          <button onClick={() => kirim(true)} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Setujui"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RusakModal({ alasanAwal, kodeAwal, onClose, onSuccess }: { alasanAwal: "EXPIRED" | "RUSAK"; kodeAwal?: string; onClose: () => void; onSuccess: () => void }) {
  const barang = useBarangAktif();
  const fotoAktif = useEvidenceEnabled();
  const [alasan, setAlasan] = useState(alasanAwal);
  const [tanggal, setTanggal] = useState(localToday());
  const [kode, setKode] = useState("");
  const [qty, setQty] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const b = barang.find((x) => x.kode === kode);
  // Expired: the barang with expired stock come first; picking one fills in that qty and its dates.
  const pilihan = barang
    .filter((x) => x.lacak_stok && x.stok > 0)
    .sort((x, y) => (alasan === "EXPIRED" ? Number(qtyExpired(y) > 0) - Number(qtyExpired(x) > 0) : 0));
  const pilih = (k: string) => {
    setKode(k);
    const x = barang.find((y) => y.kode === k);
    if (alasan !== "EXPIRED" || !x) return;
    const q = qtyExpired(x);
    const tgl = (x.exp_batches ?? []).filter((e) => hariLagi(e.exp) < 0).map((e) => isoDisplay(e.exp));
    if (q > 0) setQty(String(q));
    if (tgl.length) setKeterangan(`Expired ${tgl.join(", ")}`);
  };
  // Opened from a barang's row: that barang, with its expired qty and dates filled in.
  const [awal, setAwal] = useState(kodeAwal ?? "");
  useEffect(() => {
    if (awal && barang.some((x) => x.kode === awal)) {
      pilih(awal);
      setAwal("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barang, awal]);
  const save = async () => {
    if (!kode) return setError("Pilih barang");
    if (!(parseNum(qty) > 0)) return setError("Jumlah harus lebih dari 0");
    if (!keterangan.trim()) return setError("Isi keterangannya");
    if (fotoAktif && !evidence) return setError("Foto barangnya wajib (tanggal expired / kerusakan dan jumlahnya terlihat)");
    setBusy(true);
    setError("");
    try {
      await api.kopRusak({ tanggal, barang_kode: kode, qty: parseNum(qty), alasan, keterangan: keterangan.trim(), evidence_id: evidence });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Barang Rusak / Expired" subtitle="Stoknya langsung ditahan (tidak bisa dijual), lalu diperiksa orang kedua sebelum dimusnahkan" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {(["EXPIRED", "RUSAK"] as const).map((a) => (
            <button
              key={a}
              onClick={() => (setAlasan(a), setKode(""), setQty(""), setKeterangan(""))}
              className={`flex-1 px-3 py-2 text-sm rounded-md border ${
                alasan === a ? "border-[var(--accent-blue)] bg-[#eef4ff] text-[var(--accent-blue)] font-medium" : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              {a === "EXPIRED" ? "Expired" : "Rusak (pecah, bocor, tikus, ...)"}
            </button>
          ))}
        </div>
        <div>
          <label className={labelCls}>Barang</label>
          <select value={kode} onChange={(e) => pilih(e.target.value)} className={`${selectCls} w-full`}>
            <option value="">-- Pilih barang --</option>
            {pilihan.map((x) => (
              <option key={x.kode} value={x.kode}>
                {x.nama} (stok {fmtQty(x.stok)} {x.satuan}
                {alasan === "EXPIRED" && qtyExpired(x) > 0 ? ` · expired ${fmtQty(qtyExpired(x))}` : ""})
              </option>
            ))}
          </select>
          {alasan === "EXPIRED" && b && !qtyExpired(b) && (
            <p className="mt-1 text-[11px] text-[var(--accent-amber)]">
              Menurut sistem stok barang ini belum ada yang expired. Pastikan tanggal di kemasan, dan perbarui tanggal expired-nya di Stok Barang bila salah.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Jumlah fisik {b && `(${b.satuan})`}</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tanggal</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>{alasan === "EXPIRED" ? "Keterangan (tanggal expired di kemasan)" : "Keterangan (mis. pecah, bocor, digigit tikus)"}</label>
          <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className={inputCls} />
        </div>
        <EvidenceInput value={evidence} onChange={setEvidence} label="Foto barang (wajib: tanggal expired / kerusakan dan jumlahnya terlihat)" />
        <p className="text-[11px] text-[var(--text-muted)]">Simpan barangnya di tempat barang rusak, jangan dibuang dulu: pemeriksa akan mencocokkan fisiknya.</p>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
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
