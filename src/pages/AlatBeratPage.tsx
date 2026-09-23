import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Filter, Pencil } from "lucide-react";
import { api, type AlatBerat } from "../lib/api";
import { EditAlatBeratModal } from "../components/EditAlatBeratModal";

type SortKey = "kode" | "jenis_unit" | "nama";

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  const Icon = active ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="px-4 py-2.5 text-left">
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${
          active ? "text-[var(--accent-blue)]" : ""
        }`}
      >
        {label}
        <Icon size={12} />
      </button>
    </th>
  );
}

function FilterHeader({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <th className="px-4 py-2.5 text-left">
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <div className="relative inline-flex">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`appearance-none bg-transparent text-xs pl-1 pr-4 py-0.5 rounded border cursor-pointer ${
              value
                ? "border-[var(--accent-blue-border)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]"
                : "border-transparent text-[var(--text-muted)] hover:border-[var(--border)]"
            }`}
          >
            <option value="">Semua</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <Filter size={10} className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>
    </th>
  );
}

export function AlatBeratPage() {
  const [rows, setRows] = useState<AlatBerat[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [jenisUnit, setJenisUnit] = useState("");
  const [jenisOptions, setJenisOptions] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("kode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editingAlat, setEditingAlat] = useState<AlatBerat | null>(null);
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api
      .alatBerat({ search, jenis_unit: jenisUnit, sortBy, sortDir, page, pageSize })
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
        setLoading(false);
      });
  };

  useEffect(() => {
    api.alatBeratJenisOptions().then(setJenisOptions);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, jenisUnit, sortBy, sortDir]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Master Data Alat Berat</h1>
        <p className="text-sm text-[var(--text-secondary)]">{total.toLocaleString("id-ID")} kendaraan/alat pengguna BBM</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kode atau nama/model..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <SortableHeader label="Kode" sortKey="kode" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <FilterHeader label="Jenis Unit" value={jenisUnit} options={jenisOptions} onChange={(v) => { setJenisUnit(v); setPage(1); }} />
                <SortableHeader label="Nama / Model" sortKey="nama" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs">{a.kode}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{a.jenis_unit || "-"}</td>
                    <td className="px-4 py-2.5">{a.nama}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setEditingAlat(a)}
                        title="Edit data alat"
                        className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                      >
                        <Pencil size={14} />
                      </button>
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

      {editingAlat && (
        <EditAlatBeratModal
          alatBerat={editingAlat}
          onClose={() => setEditingAlat(null)}
          onSuccess={() => {
            setEditingAlat(null);
            load();
          }}
        />
      )}
    </div>
  );
}
