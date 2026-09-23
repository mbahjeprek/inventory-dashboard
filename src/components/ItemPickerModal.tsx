import { useEffect, useState } from "react";
import { X, Search } from "lucide-react";
import { api, type Item } from "../lib/api";

export function ItemPickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (item: Item) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.items({ search, sortBy: "kode", sortDir: "asc", page: 1, pageSize: 20 }).then((res) => {
        setResults(res.data);
        setLoading(false);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Pilih Barang</h3>
            <p className="text-xs text-[var(--text-secondary)]">Cari barang untuk diinput transaksi</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode atau nama barang..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
            />
          </div>

          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
            {loading ? (
              <p className="text-sm text-[var(--text-muted)] py-6 text-center">Memuat...</p>
            ) : results.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6 text-center">Tidak ada barang ditemukan</p>
            ) : (
              results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-[#f8fafc] px-1 rounded-md"
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
        </div>
      </div>
    </div>
  );
}
