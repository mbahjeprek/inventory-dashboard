import { useEffect, useState } from "react";
import { X, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { api, type PickerItem, type StockScope } from "../lib/api";

const PAGE_SIZE = 50;

// Lists every barang (or every obat for a klinik), a page at a time; typing narrows the list
// (each word must match). The stock shown is the scope's own - a gudang or klinik - or Nilam's.
export function ItemPickerModal({
  scope,
  onClose,
  onSelect,
}: {
  scope?: StockScope;
  onClose: () => void;
  onSelect: (item: PickerItem) => void;
}) {
  const noun = scope?.kind === "klinik" ? "obat" : "barang";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<PickerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    const t = setTimeout(() => {
      const params = { search, sortBy: "kode", sortDir: "asc", page, pageSize: PAGE_SIZE };
      const request =
        scope?.kind === "klinik"
          ? api.klinikPickItems({ ...params, klinik: scope.name })
          : scope?.kind === "gudang"
            ? api.gudangPickItems({ ...params, gudang: scope.name })
            : api.items(params);
      request.then((res) => {
        if (stale) return;
        setResults(res.data);
        setTotal(res.total);
        setLoading(false);
      });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [search, page, scope?.kind, scope?.name]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Pilih {scope?.kind === "klinik" ? "Obat" : "Barang"}</h3>
            <p className="text-xs text-[var(--text-secondary)]">Cari {noun} untuk diinput transaksi</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 flex flex-col min-h-0">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={noun === "obat" ? "Cari kode, nama, jenis atau kegunaan obat..." : "Cari kode, nama, atau satuan barang..."}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
            />
          </div>

          <div className="mt-2 text-xs text-[var(--text-muted)]">
            {loading ? "Memuat..." : `${total.toLocaleString("id-ID")} ${noun}${total > 0 ? ` · menampilkan ${from}–${to}` : ""}`}
          </div>

          <div className="mt-2 flex-1 min-h-0 overflow-y-auto divide-y divide-[var(--border)]">
            {loading && results.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6 text-center">Memuat...</p>
            ) : results.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6 text-center">Tidak ada {noun} ditemukan</p>
            ) : (
              results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className={`w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-[#f8fafc] px-1 rounded-md ${loading ? "opacity-50" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{item.nama}</div>
                    <div className="text-xs text-[var(--text-muted)] font-mono">{item.kode}</div>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] shrink-0">
                    {item.stock_tersedia.toLocaleString("id-ID")} {item.satuan}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between pt-3 mt-2 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
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
    </div>
  );
}
