import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FilePlus2, Printer, Save, Search, Send, Trash2, Wand2, X } from "lucide-react";
import {
  api,
  errorText,
  type Permintaan,
  type PermintaanLine,
  type PermintaanLineStatus,
  type PermintaanRekapRow,
  type PermintaanRingkas,
  type PermintaanSaran,
  type PermintaanTtd,
  type PermintaanUrgensi,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { localToday } from "../lib/opname";
import { printDocument, type TableReport } from "../lib/printTable";
import { ExportButtons } from "./ExportButtons";
import { TTD_DEFAULT, TTD_LABEL, URGENSI_LABEL, estateLabel, permintaanHtml } from "../lib/permintaanSurat";

// Klinik > Permintaan Obat: the "Form Permintaan Obat, BMHP dan Alat Medis" of the klinik, drafted from its
// stock (saran = enough for N months of use, at least the buffer, in kemasan), edited, printed with the
// kop and signatures, sent (DIAJUKAN), then its fulfilment recorded per item; and the Rekap of every
// requested item like the request spreadsheet.

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "-" : n.toLocaleString("id-ID", { maximumFractionDigits: d }));
const tgl = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : "-");
const inputCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const cellIn = "w-full rounded border border-[var(--border)] px-1.5 py-1 text-xs bg-white";
const btn = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[#f1f5f9] disabled:opacity-50";
const btnBlue = "inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50";
const URG_CLS: Record<PermintaanUrgensi, string> = {
  HIGH: "text-[var(--accent-red)] font-semibold",
  MEDIUM: "text-[var(--accent-amber)] font-medium",
  LOW: "text-[var(--text-secondary)]",
};
const STATUS_LABEL: Record<PermintaanLineStatus, string> = { MENUNGGU: "Menunggu", APPROVED: "Approved", SEBAGIAN: "Sebagian", DITOLAK: "Ditolak" };

const cetak = async (id: number) => printDocument(permintaanHtml(await api.permintaanGet(id)));

type View = { kind: "list" } | { kind: "edit"; id: number | null } | { kind: "detail"; id: number } | { kind: "rekap" };

export function KlinikPermintaanTab({ klinik }: { klinik: string }) {
  const [view, setView] = useState<View>({ kind: "list" });
  if (view.kind === "edit") return <Editor klinik={klinik} id={view.id} onDone={(id) => setView(id ? { kind: "detail", id } : { kind: "list" })} onBack={() => setView({ kind: "list" })} />;
  if (view.kind === "detail") return <Detail id={view.id} onBack={() => setView({ kind: "list" })} onEdit={(id) => setView({ kind: "edit", id })} />;
  return <Daftar klinik={klinik} rekap={view.kind === "rekap"} setView={setView} />;
}

function Daftar({ klinik, rekap, setView }: { klinik: string; rekap: boolean; setView: (v: View) => void }) {
  const { user } = useAuth();
  const canInput = can(user, "klinik.input");
  const [rows, setRows] = useState<PermintaanRingkas[] | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api
      .permintaanList(klinik)
      .then((r) => setRows(r.rows))
      .catch((e) => setError(errorText(e, "Gagal memuat permintaan")));
  useEffect(() => {
    if (!rekap) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik, rekap]);
  const hapus = async (p: PermintaanRingkas) => {
    if (!window.confirm(`Hapus permintaan ${p.nomor}?`)) return;
    try {
      await api.permintaanDelete(p.id);
      load();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus"));
    }
  };
  const tabBtn = (on: boolean, label: string, onClick: () => void) => (
    <button onClick={onClick} className={`px-3 py-1.5 text-sm rounded-md border ${on ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)] font-medium" : "border-[var(--border)]"}`}>
      {label}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tabBtn(!rekap, "Daftar Surat", () => setView({ kind: "list" }))}
        {tabBtn(rekap, "Rekap Permintaan", () => setView({ kind: "rekap" }))}
        {canInput && (
          <button onClick={() => setView({ kind: "edit", id: null })} className={`${btnBlue} ml-auto`}>
            <FilePlus2 size={16} /> Buat Permintaan
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      {rekap ? (
        <Rekap klinik={klinik} />
      ) : (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[var(--text-secondary)]">
              <tr className="text-left">
                <th className="px-3 py-2">Nomor</th>
                <th className="px-3 py-2">Tanggal</th>
                <th className="px-3 py-2">Periode</th>
                <th className="px-3 py-2 text-right">Item</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Pemenuhan</th>
                <th className="px-3 py-2">Dibuat oleh</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {!rows ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)]">
                    Belum ada permintaan obat. {canInput && "Klik Buat Permintaan: daftar obat yang perlu diminta disusun otomatis dari stok."}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-3 py-2 font-medium">
                      <button onClick={() => setView(p.status === "DRAFT" ? { kind: "edit", id: p.id } : { kind: "detail", id: p.id })} className="text-[var(--accent-blue)] hover:underline">
                        {p.nomor}
                      </button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{tgl(p.tanggal)}</td>
                    <td className="px-3 py-2">{p.periode}</td>
                    <td className="px-3 py-2 text-right">
                      {p.items}
                      {p.high > 0 && <span className="ml-1 text-[11px] text-[var(--accent-red)]">({p.high} high)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          p.status === "DRAFT" ? "border-[var(--border)] text-[var(--text-secondary)]" : "border-[var(--accent-blue-border)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]"
                        }`}
                      >
                        {p.status === "DRAFT" ? "Draft" : "Diajukan"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                      {p.status === "DRAFT" ? "-" : `${p.terpenuhi}/${p.items} terpenuhi${p.ditolak ? ` · ${p.ditolak} ditolak` : ""}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{p.created_by}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button onClick={() => cetak(p.id).catch((e) => setError(errorText(e, "Gagal mencetak")))} title="Cetak" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-blue)]">
                        <Printer size={15} />
                      </button>
                      {(p.status === "DRAFT" || user?.role === "superuser") && can(user, "klinik.delete") && (
                        <button onClick={() => hapus(p)} title="Hapus" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Buat / ubah (draft) ----
type Pilih = { jumlah: string; satuan: string; urgensi: PermintaanUrgensi; keterangan: string; stok_text: string; stok: number | null; nama: string };
type Manual = { nama: string; satuan: string; jumlah: string; urgensi: PermintaanUrgensi; keterangan: string };
type Filter = "saran" | "kosong" | "dipilih" | "semua";

function Editor({ klinik, id, onDone, onBack }: { klinik: string; id: number | null; onDone: (id: number | null) => void; onBack: () => void }) {
  const [bulan, setBulan] = useState(2);
  const [saran, setSaran] = useState<PermintaanSaran[] | null>(null);
  const [head, setHead] = useState({ tanggal: localToday(), periode: localToday().slice(0, 4), departemen: `Klinik ${estateLabel(klinik)}`, catatan: "" });
  const [ttd, setTtd] = useState<PermintaanTtd>(TTD_DEFAULT(klinik));
  const [pilih, setPilih] = useState<Record<string, Pilih>>({});
  const [manual, setManual] = useState<Manual[]>([]);
  const [nomor, setNomor] = useState("");
  const [filter, setFilter] = useState<Filter>("saran");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // An existing draft: its data; a new one: the klinik's last signatories, and the saran ticked.
  useEffect(() => {
    (async () => {
      try {
        const s = await api.permintaanSaran(klinik, bulan);
        setSaran(s.rows);
        if (id) {
          const p = await api.permintaanGet(id);
          setNomor(p.nomor);
          setHead({ tanggal: p.tanggal, periode: p.periode, departemen: p.departemen, catatan: p.catatan });
          setTtd({ ...TTD_DEFAULT(klinik), ...p.ttd });
          const pl: Record<string, Pilih> = {};
          const man: Manual[] = [];
          for (const l of p.lines) {
            if (l.obat_kode)
              pl[l.obat_kode] = { jumlah: String(l.jumlah), satuan: l.satuan, urgensi: l.urgensi, keterangan: l.keterangan, stok_text: l.stok_text, stok: l.stok, nama: l.nama };
            else man.push({ nama: l.nama, satuan: l.satuan, jumlah: String(l.jumlah), urgensi: l.urgensi, keterangan: l.keterangan });
          }
          setPilih(pl);
          setManual(man);
          setFilter("dipilih");
        } else {
          const list = await api.permintaanList(klinik);
          if (list.ttd) setTtd({ ...TTD_DEFAULT(klinik), ...list.ttd });
          setPilih(Object.fromEntries(s.rows.filter((r) => r.saran > 0).map((r) => [r.kode, pilihDari(r)])));
        }
      } catch (e) {
        setError(errorText(e, "Gagal memuat data"));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik, id]);

  const pilihDari = (r: PermintaanSaran): Pilih => ({
    jumlah: r.saran ? String(r.saran) : "",
    satuan: r.satuan_minta,
    urgensi: r.urgensi,
    keterangan: "",
    stok_text: r.stok_text,
    stok: r.stok,
    nama: r.nama,
  });
  // Cakupan stok changed: the saran again (the ticked rows keep what was typed).
  const hitungUlang = async (n: number) => {
    setBulan(n);
    try {
      const s = await api.permintaanSaran(klinik, n);
      setSaran(s.rows);
    } catch (e) {
      setError(errorText(e, "Gagal menghitung saran"));
    }
  };
  const isiSaran = () => {
    if (!saran) return;
    setPilih((p) => {
      const n = { ...p };
      for (const r of saran) if (r.saran > 0) n[r.kode] = { ...pilihDari(r), keterangan: n[r.kode]?.keterangan ?? "" };
      return n;
    });
  };

  const q = search.trim().toLowerCase();
  const tampil = (saran ?? []).filter((r) => {
    if (q && !r.nama.toLowerCase().includes(q) && !r.kode.toLowerCase().includes(q)) return false;
    if (filter === "saran") return r.saran > 0 || !!pilih[r.kode];
    if (filter === "kosong") return r.terdaftar && r.stok <= 0;
    if (filter === "dipilih") return !!pilih[r.kode];
    return true;
  });
  const count = useMemo(
    () => ({
      saran: (saran ?? []).filter((r) => r.saran > 0).length,
      kosong: (saran ?? []).filter((r) => r.terdaftar && r.stok <= 0).length,
      dipilih: Object.keys(pilih).length,
    }),
    [saran, pilih]
  );
  const toggle = (r: PermintaanSaran) =>
    setPilih((p) => {
      const n = { ...p };
      if (n[r.kode]) delete n[r.kode];
      else n[r.kode] = pilihDari(r);
      return n;
    });
  const setP = (kode: string, patch: Partial<Pilih>) => setPilih((p) => ({ ...p, [kode]: { ...p[kode], ...patch } }));

  const lines = (): PermintaanLine[] => [
    ...(saran ?? [])
      .filter((r) => pilih[r.kode])
      .map((r) => {
        const x = pilih[r.kode];
        return { obat_kode: r.kode, nama: r.nama, satuan: x.satuan, jumlah: Number(x.jumlah), urgensi: x.urgensi, stok: r.stok, stok_text: r.stok_text, keterangan: x.keterangan };
      }),
    // A ticked obat no longer in the list (renamed) keeps its own data.
    ...Object.entries(pilih)
      .filter(([k]) => !(saran ?? []).some((r) => r.kode === k))
      .map(([k, x]) => ({ obat_kode: k, nama: x.nama, satuan: x.satuan, jumlah: Number(x.jumlah), urgensi: x.urgensi, stok: x.stok, stok_text: x.stok_text, keterangan: x.keterangan })),
    ...manual.filter((m) => m.nama.trim()).map((m) => ({ obat_kode: null, nama: m.nama.trim(), satuan: m.satuan.trim(), jumlah: Number(m.jumlah), urgensi: m.urgensi, stok: null, stok_text: "", keterangan: m.keterangan })),
  ];

  const simpan = async (ajukan: boolean) => {
    setError("");
    const ls = lines();
    if (!ls.length) return setError("Pilih minimal satu obat");
    const bad = ls.find((l) => !(l.jumlah > 0));
    if (bad) return setError(`${bad.nama}: isi jumlah permintaan`);
    if (ajukan && !window.confirm(`Ajukan permintaan ${ls.length} item? Setelah diajukan isinya tidak bisa diubah lagi (hanya pemenuhannya).`)) return;
    setSaving(true);
    try {
      const payload = { klinik, ...head, ttd, lines: ls, ajukan };
      if (id) {
        await api.permintaanUpdate(id, payload);
        onDone(ajukan ? id : null);
      } else {
        const r = await api.permintaanCreate(payload);
        onDone(ajukan ? r.id : null);
      }
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  // Pratinjau: the letter as it will print (the number is given when it is saved).
  const pratinjau = () =>
    printDocument(
      permintaanHtml({
        id: id ?? 0,
        klinik,
        nomor: nomor || "(nomor diberikan saat disimpan)",
        ...head,
        status: "DRAFT",
        ttd,
        created_by: "",
        created_at: "",
        diajukan_at: null,
        lines: lines(),
      })
    );

  if (!loaded) return <p className="p-4 text-sm text-[var(--text-muted)]">Menyusun daftar obat dari stok...</p>;
  const nItem = lines().length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className={btn}>
          <ArrowLeft size={15} /> Kembali
        </button>
        <h2 className="font-semibold text-[var(--text-primary)]">{id ? `Ubah draft ${nomor}` : "Permintaan obat baru"}</h2>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-[var(--text-secondary)] space-y-1">
          <span className="block">Tanggal</span>
          <input type="date" value={head.tanggal} onChange={(e) => setHead({ ...head, tanggal: e.target.value })} className={`${inputCls} w-full`} />
        </label>
        <label className="text-xs text-[var(--text-secondary)] space-y-1">
          <span className="block">Periode</span>
          <input value={head.periode} onChange={(e) => setHead({ ...head, periode: e.target.value })} className={`${inputCls} w-full`} placeholder="cth. 2026 / Oktober 2026" />
        </label>
        <label className="text-xs text-[var(--text-secondary)] space-y-1">
          <span className="block">Departemen</span>
          <input value={head.departemen} onChange={(e) => setHead({ ...head, departemen: e.target.value })} className={`${inputCls} w-full`} />
        </label>
        <label className="text-xs text-[var(--text-secondary)] space-y-1">
          <span className="block">Stok untuk berapa bulan (saran otomatis)</span>
          <select value={bulan} onChange={(e) => hitungUlang(Number(e.target.value))} className={`${inputCls} w-full`}>
            {[1, 2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n} bulan pemakaian
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
          {(
            [
              ["saran", `Disarankan ${count.saran}`],
              ["kosong", `Stok kosong ${count.kosong}`],
              ["dipilih", `Dipilih ${count.dipilih}`],
              ["semua", "Semua obat"],
            ] as [Filter, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-2.5 py-1 text-xs rounded border ${filter === k ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]" : "border-[var(--border)]"}`}
            >
              {l}
            </button>
          ))}
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari obat" className="text-xs rounded-md border border-[var(--border)] pl-7 pr-2 py-1.5 w-44" />
          </div>
          <button onClick={isiSaran} className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]" title="Centang semua yang disarankan dengan jumlah saran">
            <Wand2 size={13} /> Isi sesuai saran
          </button>
        </div>
        <div className="overflow-auto max-h-[55vh]">
          <table className="w-full text-xs">
            <thead className="bg-[#f8fafc] text-[var(--text-secondary)] sticky top-0 z-10">
              <tr className="text-left">
                <th className="px-2 py-2 w-8" />
                <th className="px-2 py-2">Obat</th>
                <th className="px-2 py-2 text-right">Stok</th>
                <th className="px-2 py-2 text-right" title="Rata-rata Stock Out per bulan, 3 bulan terakhir">Pakai/bln</th>
                <th className="px-2 py-2 text-right">Cukup</th>
                <th className="px-2 py-2 text-right">Saran</th>
                <th className="px-2 py-2 w-20">Jumlah</th>
                <th className="px-2 py-2 w-24">Satuan</th>
                <th className="px-2 py-2 w-24">Urgensi</th>
                <th className="px-2 py-2">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {tampil.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-[var(--text-muted)]">
                    {filter === "saran" ? "Tidak ada obat yang perlu diminta menurut stok & pemakaian. Lihat Semua obat untuk memilih sendiri." : "Tidak ada obat."}
                  </td>
                </tr>
              ) : (
                tampil.map((r) => {
                  const x = pilih[r.kode];
                  return (
                    <tr key={r.kode} className={`border-t border-[var(--border)] ${x ? "bg-[#f0f9eb]" : ""}`}>
                      <td className="px-2 py-1">
                        <input type="checkbox" checked={!!x} onChange={() => toggle(r)} />
                      </td>
                      <td className="px-2 py-1">
                        <div className="font-medium text-[var(--text-primary)]">{r.nama}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {r.kode}
                          {r.jenis && ` · ${r.jenis}`}
                          {r.isi_kemasan && r.kemasan ? ` · 1 ${r.kemasan} = ${r.isi_kemasan} ${r.satuan}` : ""}
                          {r.buffer > 0 && ` · buffer ${fmt(r.buffer)}`}
                        </div>
                      </td>
                      <td className={`px-2 py-1 text-right whitespace-nowrap ${r.stok <= 0 ? "text-[var(--accent-red)] font-semibold" : ""}`}>{r.stok_text}</td>
                      <td className="px-2 py-1 text-right">{r.rata_bulan ? fmt(r.rata_bulan, 1) : "-"}</td>
                      <td className="px-2 py-1 text-right">{r.cukup_bulan === null ? "-" : `${fmt(r.cukup_bulan, 1)} bln`}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">{r.saran ? `${fmt(r.saran)} ${r.satuan_minta}` : "-"}</td>
                      <td className="px-2 py-1">{x && <input type="number" min={0} value={x.jumlah} onChange={(e) => setP(r.kode, { jumlah: e.target.value })} className={cellIn} />}</td>
                      <td className="px-2 py-1">
                        {x && (
                          <input
                            list={`satuan-${r.kode}`}
                            value={x.satuan}
                            onChange={(e) => setP(r.kode, { satuan: e.target.value })}
                            className={cellIn}
                          />
                        )}
                        {x && (
                          <datalist id={`satuan-${r.kode}`}>
                            {[...new Set([r.satuan_minta, r.satuan, r.kemasan ?? "", "BOX", "BOTOL", "STRIP", "PCS"].filter(Boolean))].map((s) => (
                              <option key={s} value={s} />
                            ))}
                          </datalist>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {x ? (
                          <select value={x.urgensi} onChange={(e) => setP(r.kode, { urgensi: e.target.value as PermintaanUrgensi })} className={`${cellIn} ${URG_CLS[x.urgensi]}`}>
                            {(["HIGH", "MEDIUM", "LOW"] as const).map((u) => (
                              <option key={u} value={u}>
                                {URGENSI_LABEL[u]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={URG_CLS[r.urgensi]}>{r.saran ? URGENSI_LABEL[r.urgensi] : ""}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">{x && <input value={x.keterangan} onChange={(e) => setP(r.kode, { keterangan: e.target.value })} className={cellIn} placeholder={r.stok_text} />}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 space-y-2">
        <div className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Item di luar master obat (alat medis, BMHP, lainnya)</div>
        {manual.map((m, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <input value={m.nama} onChange={(e) => setManual((x) => x.map((y, j) => (j === i ? { ...y, nama: e.target.value } : y)))} placeholder="Nama barang" className={`${cellIn} col-span-4`} />
            <input value={m.satuan} onChange={(e) => setManual((x) => x.map((y, j) => (j === i ? { ...y, satuan: e.target.value } : y)))} placeholder="Satuan" className={`${cellIn} col-span-2`} />
            <input type="number" value={m.jumlah} onChange={(e) => setManual((x) => x.map((y, j) => (j === i ? { ...y, jumlah: e.target.value } : y)))} placeholder="Jumlah" className={`${cellIn} col-span-1`} />
            <select value={m.urgensi} onChange={(e) => setManual((x) => x.map((y, j) => (j === i ? { ...y, urgensi: e.target.value as PermintaanUrgensi } : y)))} className={`${cellIn} col-span-1`}>
              {(["HIGH", "MEDIUM", "LOW"] as const).map((u) => (
                <option key={u} value={u}>
                  {URGENSI_LABEL[u]}
                </option>
              ))}
            </select>
            <input value={m.keterangan} onChange={(e) => setManual((x) => x.map((y, j) => (j === i ? { ...y, keterangan: e.target.value } : y)))} placeholder="Keterangan / stok" className={`${cellIn} col-span-3`} />
            <button onClick={() => setManual((x) => x.filter((_, j) => j !== i))} className="col-span-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]" title="Hapus">
              <X size={14} />
            </button>
          </div>
        ))}
        <button onClick={() => setManual((x) => [...x, { nama: "", satuan: "", jumlah: "", urgensi: "MEDIUM", keterangan: "" }])} className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
          + Tambah item
        </button>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 space-y-2">
        <div className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Tanda tangan & catatan</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TTD_LABEL.map(([k, judul]) => (
            <div key={k} className="space-y-1">
              <div className="text-xs text-[var(--text-secondary)]">{judul.replace(",", "")}</div>
              <input value={ttd[k].nama} onChange={(e) => setTtd({ ...ttd, [k]: { ...ttd[k], nama: e.target.value } })} placeholder="Nama" className={`${inputCls} w-full`} />
              <input value={ttd[k].jabatan} onChange={(e) => setTtd({ ...ttd, [k]: { ...ttd[k], jabatan: e.target.value } })} placeholder="Jabatan" className={`${inputCls} w-full`} />
            </div>
          ))}
        </div>
        <textarea value={head.catatan} onChange={(e) => setHead({ ...head, catatan: e.target.value })} placeholder="Catatan (opsional, ikut tercetak)" rows={2} className={`${inputCls} w-full`} />
      </div>

      <div className="flex flex-wrap items-center gap-2 sticky bottom-0 bg-[var(--bg-page)] py-2">
        {error && <span className="text-sm text-[var(--accent-red)]">{error}</span>}
        <span className="ml-auto text-sm text-[var(--text-secondary)]">{nItem} item di surat</span>
        <button onClick={pratinjau} disabled={!nItem} className={btn}>
          <Printer size={15} /> Pratinjau / Cetak
        </button>
        <button onClick={() => simpan(false)} disabled={saving} className={btn}>
          <Save size={15} /> Simpan Draft
        </button>
        <button onClick={() => simpan(true)} disabled={saving} className={btnBlue}>
          <Send size={15} /> {saving ? "Menyimpan..." : "Ajukan"}
        </button>
      </div>
    </div>
  );
}

// ---- A sent request: print it and record the fulfilment per item ----
// The status approval (and its alasan, needed for Sebagian / Ditolak) is set with Approve Permintaan Obat;
// dipenuhi / tanggal pemenuhan with Input Klinik.
const perluAlasan = (s: PermintaanLineStatus) => s === "SEBAGIAN" || s === "DITOLAK";
function Detail({ id, onBack }: { id: number; onBack: () => void; onEdit: (id: number) => void }) {
  const { user } = useAuth();
  const canInput = can(user, "klinik.input");
  const canApprove = can(user, "klinik.permintaan_approve");
  const [p, setP] = useState<Permintaan | null>(null);
  const [edit, setEdit] = useState<Record<number, { status: PermintaanLineStatus; alasan: string; dipenuhi: string; tanggal_pemenuhan: string }>>({});
  const [cekAlasan, setCekAlasan] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () =>
    api
      .permintaanGet(id)
      .then((x) => {
        setP(x);
        setCekAlasan(false);
        setEdit(Object.fromEntries(x.lines.map((l) => [l.id!, { status: l.status ?? "MENUNGGU", alasan: l.alasan ?? "", dipenuhi: l.dipenuhi === null || l.dipenuhi === undefined ? "" : String(l.dipenuhi), tanggal_pemenuhan: l.tanggal_pemenuhan ?? "" }])));
      })
      .catch((e) => setError(errorText(e, "Gagal memuat permintaan")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!p) return <p className="p-4 text-sm text-[var(--text-muted)]">{error || "Memuat..."}</p>;
  const set = (lid: number, patch: Partial<(typeof edit)[number]>) => setEdit((e) => ({ ...e, [lid]: { ...e[lid], ...patch } }));
  const semuaApproved = () => {
    const today = localToday();
    setEdit((e) =>
      Object.fromEntries(p.lines.map((l) => [l.id!, { status: "APPROVED" as const, alasan: "", dipenuhi: e[l.id!]?.dipenuhi || String(l.jumlah), tanggal_pemenuhan: e[l.id!]?.tanggal_pemenuhan || today }]))
    );
  };
  const simpan = async () => {
    setError("");
    setMsg("");
    // Only an approval being set now needs its alasan (an older one saved without it isn't blocked).
    const berubah = (l: (typeof p.lines)[number]) => edit[l.id!].status !== (l.status ?? "MENUNGGU") || edit[l.id!].alasan.trim() !== (l.alasan ?? "");
    const kurang = p.lines.filter((l) => berubah(l) && perluAlasan(edit[l.id!].status) && edit[l.id!].alasan.trim().length < 3);
    if (kurang.length) {
      setCekAlasan(true);
      return setError(`Isi alasan untuk item Sebagian / Ditolak: ${kurang.map((l) => l.nama).join(", ")}`);
    }
    setSaving(true);
    try {
      const r = await api.permintaanPemenuhan(
        p.id,
        p.lines.map((l) => ({ id: l.id!, status: edit[l.id!].status, alasan: edit[l.id!].alasan.trim(), dipenuhi: edit[l.id!].dipenuhi === "" ? null : Number(edit[l.id!].dipenuhi), tanggal_pemenuhan: edit[l.id!].tanggal_pemenuhan || null }))
      );
      setMsg(`Tersimpan (${r.saved} item berubah)`);
      load();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className={btn}>
          <ArrowLeft size={15} /> Kembali
        </button>
        <div>
          <h2 className="font-semibold text-[var(--text-primary)]">{p.nomor}</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {tgl(p.tanggal)} · Periode {p.periode} · {p.departemen} · dibuat {p.created_by}
            {p.diajukan_at && ` · diajukan ${new Date(p.diajukan_at).toLocaleDateString("id-ID")}`}
          </p>
        </div>
        <button onClick={() => printDocument(permintaanHtml(p))} className={`${btn} ml-auto`}>
          <Printer size={15} /> Cetak
        </button>
      </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc] text-xs text-[var(--text-secondary)]">
            <tr className="text-left">
              <th className="px-2 py-2">No</th>
              <th className="px-2 py-2">Uraian</th>
              <th className="px-2 py-2">Satuan</th>
              <th className="px-2 py-2 text-right">Jumlah</th>
              <th className="px-2 py-2">Urgensi</th>
              <th className="px-2 py-2">Keterangan/Stok</th>
              <th className="px-2 py-2 w-56">Status Approval</th>
              <th className="px-2 py-2 w-24">Dipenuhi</th>
              <th className="px-2 py-2 w-36">Tgl Pemenuhan</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => {
              const e = edit[l.id!];
              return (
                <tr key={l.id} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5 text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium">{l.nama}</td>
                  <td className="px-2 py-1.5">{l.satuan}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(l.jumlah, 2)}</td>
                  <td className={`px-2 py-1.5 ${URG_CLS[l.urgensi]}`}>{URGENSI_LABEL[l.urgensi]}</td>
                  <td className="px-2 py-1.5 text-xs text-[var(--text-secondary)]">{[l.stok_text, l.keterangan].filter(Boolean).join(" · ")}</td>
                  <td className="px-2 py-1">
                    <select
                      disabled={!canApprove}
                      title={canApprove ? undefined : "Status approval hanya bisa diubah akun dengan hak Approve Permintaan Obat"}
                      value={e?.status}
                      onChange={(ev) => {
                        const status = ev.target.value as PermintaanLineStatus;
                        // Approved: dipenuhi = the requested amount and today, where they are still empty.
                        set(
                          l.id!,
                          status === "APPROVED" && canInput
                            ? { status, dipenuhi: e?.dipenuhi || String(l.jumlah), tanggal_pemenuhan: e?.tanggal_pemenuhan || localToday() }
                            : { status }
                        );
                      }}
                      className={cellIn}
                    >
                      {(Object.keys(STATUS_LABEL) as PermintaanLineStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    {e && perluAlasan(e.status) && (
                      <input
                        disabled={!canApprove}
                        value={e.alasan}
                        onChange={(ev) => set(l.id!, { alasan: ev.target.value })}
                        placeholder={e.status === "DITOLAK" ? "Alasan ditolak (wajib)" : "Alasan disetujui sebagian (wajib)"}
                        maxLength={300}
                        className={`${cellIn} mt-1 text-xs ${
                          cekAlasan && e.alasan.trim().length < 3 ? "!border-[var(--accent-red)] bg-[var(--accent-red-bg)]" : ""
                        }`}
                      />
                    )}
                    {l.approval_oleh && (
                      <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                        oleh {l.approval_oleh}
                        {l.approval_at && ` · ${new Date(l.approval_at).toLocaleDateString("id-ID")}`}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <input disabled={!canInput} type="number" min={0} value={e?.dipenuhi} onChange={(ev) => set(l.id!, { dipenuhi: ev.target.value })} className={cellIn} />
                  </td>
                  <td className="px-2 py-1">
                    <input disabled={!canInput} type="date" value={e?.tanggal_pemenuhan} onChange={(ev) => set(l.id!, { tanggal_pemenuhan: ev.target.value })} className={cellIn} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(canInput || canApprove) && (
        <div className="flex flex-wrap items-center gap-2">
          {error && <span className="text-sm text-[var(--accent-red)]">{error}</span>}
          {msg && <span className="text-sm text-[var(--accent-green)]">{msg}</span>}
          <span className="ml-auto" />
          {canApprove && canInput && (
            <button onClick={semuaApproved} className={btn}>
              Semua approved & dipenuhi hari ini
            </button>
          )}
          <button onClick={simpan} disabled={saving} className={btnBlue}>
            <Save size={15} /> {saving ? "Menyimpan..." : "Simpan pemenuhan"}
          </button>
        </div>
      )}
      <p className="text-[11px] text-[var(--text-muted)]">
        Pemenuhan hanya mencatat status permintaan. Obat yang datang tetap dicatat lewat Stock In supaya stok bertambah. Status approval diubah oleh pemegang
        hak Approve Permintaan Obat; Sebagian dan Ditolak wajib disertai alasan.
      </p>
    </div>
  );
}

// ---- Rekap Permintaan: every requested item, as the request spreadsheet ----
function Rekap({ klinik }: { klinik: string }) {
  const [periode, setPeriode] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<PermintaanRekapRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    api
      .permintaanRekap({ klinik, periode, status })
      .then((r) => setRows(r.rows))
      .catch((e) => setError(errorText(e, "Gagal memuat rekap")));
  }, [klinik, periode, status]);
  const report = async (): Promise<TableReport> => ({
    title: "PERMINTAAN (REQUEST) OBAT",
    subtitle: [`Klinik Estate ${estateLabel(klinik)}`, periode && `Periode ${periode}`, status && `Status ${STATUS_LABEL[status as PermintaanLineStatus]}`].filter(Boolean) as string[],
    landscape: true,
    columns: [
      { label: "Tanggal Request" },
      { label: "Estate" },
      { label: "Nama Obat" },
      { label: "Satuan" },
      { label: "Jumlah Permintaan", align: "right" },
      { label: "Tingkat Urgent" },
      { label: "Status Approval" },
      { label: "Tanggal Pemenuhan" },
      { label: "Keterangan" },
    ],
    rows: (rows ?? []).map((r) => [
      tgl(r.tanggal),
      estateLabel(r.klinik),
      r.nama,
      r.satuan,
      r.jumlah,
      URGENSI_LABEL[r.urgensi],
      STATUS_LABEL[r.status],
      tgl(r.tanggal_pemenuhan),
      [r.nomor, r.dipenuhi !== null ? `dipenuhi ${fmt(r.dipenuhi, 2)} ${r.satuan}` : "", r.alasan && `alasan: ${r.alasan}`, r.keterangan].filter(Boolean).join(" · "),
    ]),
  });
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} className={inputCls} aria-label="Bulan" />
        {periode && (
          <button onClick={() => setPeriode("")} className="text-xs text-[var(--accent-blue)] hover:underline">
            semua bulan
          </button>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} aria-label="Status">
          <option value="">Semua status</option>
          {(Object.keys(STATUS_LABEL) as PermintaanLineStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <ExportButtons total={rows?.length ?? 0} buildReport={report} fileName={`permintaan-obat-${klinik.toLowerCase()}`} />
        </div>
      </div>
      {error && <p className="px-3 pt-2 text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#4472c4] text-white text-xs">
            <tr>
              {["Tanggal Request", "Estate", "Nama Obat", "Satuan", "Jumlah Permintaan", "Tingkat Urgent", "Status Approval", "Tanggal Pemenuhan", "Keterangan"].map((h) => (
                <th key={h} className="px-3 py-2 text-center font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Belum ada permintaan yang diajukan.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id} className={i % 2 ? "bg-[#dce3f3]/40" : ""}>
                  <td className="px-3 py-1.5 text-center">{tgl(r.tanggal)}</td>
                  <td className="px-3 py-1.5 text-center">{estateLabel(r.klinik)}</td>
                  <td className="px-3 py-1.5">{r.nama}</td>
                  <td className="px-3 py-1.5 text-center">{r.satuan}</td>
                  <td className="px-3 py-1.5 text-center">{fmt(r.jumlah, 2)}</td>
                  <td className={`px-3 py-1.5 text-center ${URG_CLS[r.urgensi]}`}>{URGENSI_LABEL[r.urgensi]}</td>
                  <td className="px-3 py-1.5 text-center">{STATUS_LABEL[r.status]}</td>
                  <td className="px-3 py-1.5 text-center">{tgl(r.tanggal_pemenuhan)}</td>
                  <td className="px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                    {r.nomor}
                    {r.dipenuhi !== null && ` · dipenuhi ${fmt(r.dipenuhi, 2)} ${r.satuan}`}
                    {r.alasan && ` · alasan: ${r.alasan}`}
                    {r.keterangan && ` · ${r.keterangan}`}
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
