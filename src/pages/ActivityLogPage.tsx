import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { api, type ActivityLog } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ExportButtons } from "../components/ExportButtons";
import { fetchAllRows, type TableReport } from "../lib/printTable";

const ESTATES_BY_MODULE = {
  BARANG: ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"],
  BBM: ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"],
};

const formatWaktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function aksiTone(aksi: string) {
  if (aksi.startsWith("Hapus")) return "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]";
  if (aksi.startsWith("Tambah") || aksi === "Stok Masuk")
    return "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]";
  if (aksi === "Stok Keluar") return "bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue-border)]";
  return "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]";
}

// Separate audit logs for Inventory Barang and Inventory BBM: who changed what, when, and how.
export function ActivityLogPage({ module }: { module: "BARANG" | "BBM" }) {
  const { user } = useAuth();
  const isSuperuser = user?.role === "superuser";
  const estateLabel = module === "BBM" ? "Lokasi" : "Gudang";
  const title = module === "BBM" ? "Log Activity BBM" : "Log Activity Barang";

  const [rows, setRows] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [aksiOptions, setAksiOptions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [estate, setEstate] = useState("");
  const [aksi, setAksi] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 25;

  const filters = () => ({ module, estate, aksi, search, dateFrom, dateTo });

  const load = () => {
    setLoading(true);
    api.activityLog({ ...filters(), page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setAksiOptions(res.aksiOptions);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, page, estate, aksi, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.activityLog({ ...filters(), page: p, pageSize: ps }));
    const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
    const active = [
      search && `Cari: "${search}"`,
      `${estateLabel}: ${(isSuperuser ? estate : user?.estate) || "Semua"}`,
      aksi && `Aksi: ${aksi}`,
      (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`,
    ].filter(Boolean);
    return {
      title,
      subtitle: [`Filter: ${active.join(" · ")}`],
      landscape: true,
      columns: [
        { label: "Waktu", nowrap: true },
        { label: "User" },
        { label: estateLabel },
        { label: "Aksi", nowrap: true },
        { label: module === "BBM" ? "Transaksi" : "Barang" },
        { label: "Detail" },
      ],
      rows: all.map((r) => [formatWaktu(r.created_at), r.nama || r.username, r.estate, r.aksi, r.objek, r.detail]),
    };
  };

  const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{title}</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Riwayat perubahan data Inventory {module === "BBM" ? "BBM" : "Gudang"} (tambah, edit, hapus, transaksi) beserta
            siapa yang melakukannya
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons total={total} buildReport={buildReport} fileName={module === "BBM" ? "log-activity-bbm" : "log-activity-barang"} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Cari ${module === "BBM" ? "transaksi" : "barang"}, detail, atau user...`}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>

        {isSuperuser ? (
          <select
            value={estate}
            onChange={(e) => {
              setEstate(e.target.value);
              setPage(1);
            }}
            className={selectCls}
          >
            <option value="">Semua {estateLabel}</option>
            {ESTATES_BY_MODULE[module].map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        ) : (
          <span className={`${selectCls} text-[var(--text-secondary)]`}>
            {estateLabel}: {user?.estate}
          </span>
        )}

        <select
          value={aksi}
          onChange={(e) => {
            setAksi(e.target.value);
            setPage(1);
          }}
          className={selectCls}
        >
          <option value="">Semua Aksi</option>
          {aksiOptions.map((a) => (
            <option key={a} value={a}>
              {a}
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
          className={selectCls}
        />
        <span className="text-[var(--text-muted)] text-sm">-</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className={selectCls}
        />
      </div>

      <div className="text-sm text-[var(--text-secondary)]">{total.toLocaleString("id-ID")} aktivitas</div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="grid-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Waktu</th>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">{estateLabel}</th>
                <th className="px-4 py-2.5">Aksi</th>
                <th className="px-4 py-2.5">{module === "BBM" ? "Transaksi" : "Barang"}</th>
                <th className="px-4 py-2.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Belum ada aktivitas
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{formatWaktu(r.created_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.nama || r.username || "-"}</td>
                    <td className="px-4 py-2.5">{r.estate || "-"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${aksiTone(r.aksi)}`}>{r.aksi}</span>
                    </td>
                    <td className="px-4 py-2.5">{r.objek || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] max-w-[420px]">{r.detail || "-"}</td>
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
    </div>
  );
}
