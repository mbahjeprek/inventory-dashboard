import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Filter, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Obat } from "../lib/api";
import { isiOf, kemasanName } from "../lib/kemasan";
import { EditObatModal } from "../components/EditObatModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { useDragScroll } from "../hooks/useDragScroll";

// "STRIP isi 10" - or "-" for an obat without a pack.
const kemasanLabel = (o: Obat) => (isiOf(o) ? `${kemasanName(o)} isi ${o.isi_kemasan}` : "-");

type SortKey = "kode" | "nama" | "kategori" | "jenis";

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
    <th className="px-4 py-2.5 text-left whitespace-nowrap">
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${active ? "text-[var(--accent-blue)]" : ""}`}
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
            className={`appearance-none bg-transparent text-xs pl-1 pr-4 py-0.5 max-w-[8rem] truncate [field-sizing:content] rounded border cursor-pointer ${
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

// Master list of medicines and medical supplies used by every estate clinic.
export function MasterObatPage() {
  const [rows, setRows] = useState<Obat[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [kategori, setKategori] = useState("");
  const [satuan, setSatuan] = useState("");
  const [options, setOptions] = useState<{ kategori: string[]; satuan: string[]; jenis: { kategori: string; jenis: string }[] }>({
    kategori: [],
    satuan: [],
    jenis: [],
  });
  const [sortBy, setSortBy] = useState<SortKey>("kode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Obat | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Obat | null>(null);
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const pageSize = 25;

  const query = () => ({ search, kategori, satuan, sortBy, sortDir });

  const load = () => {
    setLoading(true);
    api.obat({ ...query(), page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setLoading(false);
    });
  };

  const loadOptions = () => api.obatOptions().then(setOptions);

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, kategori, satuan, sortBy, sortDir]);

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
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const remove = async (o: Obat) => {
    setDeleteError("");
    try {
      await api.deleteObat(o.id);
      load();
      loadOptions();
    } catch (e: any) {
      setDeleteError(
        e?.message?.includes("409") ? `"${o.nama}" masih ada di stok atau riwayat klinik, tidak bisa dihapus` : "Gagal menghapus obat"
      );
    }
  };

  // Download follows the current search, filters and sort, like the table on screen.
  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.obat({ ...query(), page: p, pageSize: ps }));
    const active = [search && `Cari: "${search}"`, kategori && `Kategori: ${kategori}`, satuan && `Satuan: ${satuan}`].filter(Boolean);
    return {
      title: "Master Data Obat",
      subtitle: active.length ? [`Filter: ${active.join(" · ")}`] : [],
      landscape: true,
      columns: [
        { label: "No", align: "right" },
        { label: "Kode Barang", nowrap: true },
        { label: "Nama Obat/Barang" },
        { label: "Kategori" },
        { label: "Jenis/Kelompok" },
        { label: "Deskripsi / Kegunaan" },
        { label: "Satuan" },
        { label: "Kemasan" },
      ],
      rows: all.map((o, n) => [n + 1, o.kode, o.nama, o.kategori, o.jenis, o.deskripsi, o.satuan, kemasanLabel(o)]),
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Master Data Obat</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {total.toLocaleString("id-ID")} obat & alat medis · dipakai oleh semua Inventory Klinik
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityLogButton module="KLINIK" estate="" />
          <ExportButtons total={total} buildReport={buildReport} fileName="master-obat" />
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90"
          >
            <Plus size={16} />
            Tambah Obat
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kode, nama, jenis atau kegunaan obat..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
      </div>

      {deleteError && <p className="text-xs text-[var(--accent-red)]">{deleteError}</p>}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="grid-table data-table text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 text-right">No</th>
                <SortableHeader label="Kode Barang" sortKey="kode" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Nama Obat/Barang" sortKey="nama" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <FilterHeader
                  label="Kategori"
                  value={kategori}
                  options={options.kategori}
                  onChange={(v) => {
                    setKategori(v);
                    setPage(1);
                  }}
                />
                <SortableHeader label="Jenis/Kelompok" sortKey="jenis" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-2.5 text-left">Deskripsi / Kegunaan</th>
                <FilterHeader
                  label="Satuan"
                  value={satuan}
                  options={options.satuan}
                  onChange={(v) => {
                    setSatuan(v);
                    setPage(1);
                  }}
                />
                <th className="px-4 py-2.5 text-left">Kemasan</th>
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada obat
                  </td>
                </tr>
              ) : (
                rows.map((o, idx) => (
                  <tr key={o.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{(page - 1) * pageSize + idx + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{o.kode}</td>
                    <td className="col-grow px-4 py-2.5">{o.nama}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.kategori || "-"}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.jenis || "-"}</td>
                    <td className="col-grow px-4 py-2.5 text-xs text-[var(--text-secondary)]">{o.deskripsi || "-"}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.satuan}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{kemasanLabel(o)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => setEditing(o)}
                          title="Edit data obat"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(o)}
                          title="Hapus obat"
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

      {(editing || creating) && (
        <EditObatModal
          obat={editing}
          kategoriOptions={options.kategori}
          jenisOptions={options.jenis}
          satuanOptions={options.satuan}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSuccess={() => {
            setEditing(null);
            setCreating(false);
            load();
            loadOptions();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus obat "${confirmDelete.nama}" (${confirmDelete.kode})? Tindakan ini tidak bisa dibatalkan.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            remove(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}
