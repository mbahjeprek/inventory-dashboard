import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Fuel, Droplet, PackagePlus, Pencil, Trash2 } from "lucide-react";
import { api, type BbmRecord, type BbmSummary } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { BbmTransactionModal } from "../components/BbmTransactionModal";
import { EditBbmModal } from "../components/EditBbmModal";

const JENIS_OPTIONS = ["SOLAR", "BENSIN"];

export function InventoryBbmPage() {
  const [summary, setSummary] = useState<BbmSummary | null>(null);
  const [lokasiOptions, setLokasiOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<BbmRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [pemakaianSum, setPemakaianSum] = useState(0);
  const [diterimaSum, setDiterimaSum] = useState(0);
  const [search, setSearch] = useState("");
  const [jenisBbm, setJenisBbm] = useState("");
  const [lokasi, setLokasi] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showTransaksi, setShowTransaksi] = useState(false);
  const [editing, setEditing] = useState<BbmRecord | null>(null);
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api.bbm({ search, jenis_bbm: jenisBbm, lokasi, dateFrom, dateTo, page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setPemakaianSum(res.pemakaianSum);
      setDiterimaSum(res.diterimaSum);
      setLoading(false);
    });
  };

  useEffect(() => {
    api.bbmSummary().then(setSummary);
    api.bbmLokasiOptions().then(setLokasiOptions);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, jenisBbm, lokasi, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const handleDelete = async (r: BbmRecord) => {
    if (!confirm(`Hapus transaksi ${r.jenis_bbm} - ${r.lokasi} tanggal ${r.tanggal}?`)) return;
    await api.deleteBbm(r.id);
    api.bbmSummary().then(setSummary);
    load();
  };

  const saldoFor = (jenis: string, lok: string) =>
    summary?.saldoTerakhir.find((s) => s.jenis_bbm === jenis && s.lokasi === lok)?.saldo_stock;

  const saldoCards = JENIS_OPTIONS.flatMap((jenis) =>
    (summary?.saldoTerakhir.filter((s) => s.jenis_bbm === jenis).map((s) => s.lokasi) || [])
      .sort()
      .map((lok) => ({ jenis, lok, saldo: saldoFor(jenis, lok) }))
  ).filter((c) => c.saldo !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Inventory BBM</h1>
          <p className="text-sm text-[var(--text-secondary)]">Monitoring stok & histori pemakaian Solar dan Bensin per lokasi</p>
        </div>
        <button
          onClick={() => setShowTransaksi(true)}
          className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
        >
          <PackagePlus size={16} /> Transaksi
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {saldoCards.map(({ jenis, lok, saldo }) => (
          <StatCard
            key={`${jenis}-${lok}`}
            label={`Stok ${jenis === "SOLAR" ? "Solar" : "Bensin"} - ${lok}`}
            value={(saldo ?? 0).toLocaleString("id-ID")}
            suffix="LTR"
            icon={jenis === "SOLAR" ? Fuel : Droplet}
            tone={jenis === "SOLAR" ? "blue" : "amber"}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari keterangan, no. SPB, atau estate..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>

        <select
          value={jenisBbm}
          onChange={(e) => {
            setJenisBbm(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        >
          <option value="">Semua Jenis BBM</option>
          {JENIS_OPTIONS.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>

        <select
          value={lokasi}
          onChange={(e) => {
            setLokasi(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        >
          <option value="">Semua Lokasi</option>
          {lokasiOptions.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        />
        <span className="text-[var(--text-muted)] text-sm">-</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        />
      </div>

      <div className="text-sm text-[var(--text-secondary)]">
        {total.toLocaleString("id-ID")} transaksi · total stok keluar{" "}
        <span className="font-medium text-[var(--text-primary)]">{pemakaianSum.toLocaleString("id-ID")} LTR</span> · total
        stok masuk <span className="font-medium text-[var(--text-primary)]">{diterimaSum.toLocaleString("id-ID")} LTR</span>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Periode</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Tanggal</th>
                <th className="px-4 py-2.5">No. SPB</th>
                <th className="px-4 py-2.5 text-right">Stok Masuk</th>
                <th className="px-4 py-2.5 text-right">Stok Keluar</th>
                <th className="px-4 py-2.5 text-right">Sisa</th>
                <th className="px-4 py-2.5">Keterangan</th>
                <th className="px-4 py-2.5">Estate</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Km/Hm Terakhir</th>
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)] text-xs">{r.periode || "-"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{r.tanggal || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{r.no_spb || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-green)]">
                      {r.diterima ? r.diterima.toLocaleString("id-ID") : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-red)]">
                      {r.pemakaian ? r.pemakaian.toLocaleString("id-ID") : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--text-primary)]">
                      {r.saldo_stock !== null ? r.saldo_stock.toLocaleString("id-ID") : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs max-w-[260px] truncate" title={r.keterangan}>
                      {r.keterangan || "-"}
                    </td>
                    <td className="px-4 py-2.5">{r.estate || <span className="text-[var(--text-muted)]">-</span>}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                      {r.hm_terakhir || r.kode_kendaraan || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => setEditing(r)}
                          title="Edit"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          title="Hapus"
                          className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {showTransaksi && (
        <BbmTransactionModal
          summary={summary}
          onClose={() => setShowTransaksi(false)}
          onSuccess={() => {
            setShowTransaksi(false);
            api.bbmSummary().then(setSummary);
            load();
          }}
        />
      )}

      {editing && (
        <EditBbmModal
          record={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            api.bbmSummary().then(setSummary);
            load();
          }}
        />
      )}
    </div>
  );
}
