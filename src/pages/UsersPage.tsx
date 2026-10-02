import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Pencil, Trash2, Plus } from "lucide-react";
import { api, type UserAccount } from "../lib/api";
import { UserFormModal } from "../components/UserFormModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { ExportButtons } from "../components/ExportButtons";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { accessSummary } from "../lib/access";
import { waktu } from "../lib/datetime";

type SortKey = "username" | "nama" | "created_at";

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

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [rows, setRows] = useState<UserAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("nama");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<UserAccount | null>(null);
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api.users({ search, sortBy, sortDir, page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortBy, sortDir]);

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

  const remove = async (u: UserAccount) => {
    setDeleteError("");
    try {
      await api.deleteUser(u.id);
      load();
    } catch (e: any) {
      setDeleteError(
        e?.message?.includes("400") ? "Tidak bisa menghapus satu-satunya akun yang tersisa" : "Gagal menghapus akun"
      );
    }
  };

  // Download follows the current search and sort. Passwords are never included.
  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.users({ search, sortBy, sortDir, page: p, pageSize: ps }));
    return {
      title: "Master Data Pengguna",
      subtitle: search ? [`Filter: Cari: "${search}"`] : [],
      columns: [{ label: "Username", nowrap: true }, { label: "Nama" }, { label: "Akses" }, { label: "Dibuat", nowrap: true }],
      rows: all.map((u) => [
        u.username,
        u.nama,
        accessSummary(u),
        waktu(u.created_at),
      ]),
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Master Data Pengguna</h1>
          <p className="text-sm text-[var(--text-secondary)]">{total.toLocaleString("id-ID")} akun login</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons total={total} buildReport={buildReport} fileName="master-pengguna" />
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90"
          >
            <Plus size={16} />
            Tambah Akun
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari username atau nama..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
      </div>

      {deleteError && <p className="text-xs text-[var(--accent-red)]">{deleteError}</p>}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <SortableHeader label="Username" sortKey="username" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Nama" sortKey="nama" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-2.5 text-left">Akses</th>
                <SortableHeader label="Dibuat" sortKey="created_at" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {u.username}
                      {currentUser?.id === u.id && (
                        <span className="ml-2 text-[10px] text-[var(--accent-blue)] font-sans">(kamu)</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{u.nama}</td>
                    <td className="col-grow px-4 py-2.5">
                      {u.role === "superuser" ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue-border)]">
                          Super User
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">{accessSummary(u)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {waktu(u.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditingUser(u)}
                          title="Edit akun"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(u)}
                          title="Hapus akun"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--accent-red)] hover:bg-[#fef2f2]"
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

      {editingUser && (
        <UserFormModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            setEditingUser(null);
            load();
          }}
        />
      )}

      {creating && (
        <UserFormModal
          user={null}
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus akun "${confirmDelete.username}"? Tindakan ini tidak bisa dibatalkan.`}
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
