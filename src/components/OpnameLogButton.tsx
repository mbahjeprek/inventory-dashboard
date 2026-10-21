import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, History, Search, X } from "lucide-react";
import { api, errorText } from "../lib/api";
import { waktu } from "../lib/datetime";

type Row = Awaited<ReturnType<typeof api.opnameLog>>["data"][number];
const MODUL: Record<string, string> = { BARANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk", KLINIK: "Klinik", OLI: "Oli" };
const PAGE = 50;

// "Log" on the Stok Opname pages: every step of the opnames (buat, tim, selesai hitung, ajukan, kembalikan,
// setujui, batal, hapus) and the koreksi stok they booked - the whole list, or one opname (opnameId).
export function OpnameLogButton({ module, estate, opnameId }: { module?: string; estate?: string; opnameId?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[#f1f5f9]"
      >
        <History size={16} /> Log
      </button>
      {open && <OpnameLogDialog module={module} estate={estate} opnameId={opnameId} onClose={() => setOpen(false)} />}
    </>
  );
}

function OpnameLogDialog({ module, estate, opnameId, onClose }: { module?: string; estate?: string; opnameId?: number; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const req = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  useEffect(() => {
    const t = setTimeout(() => (setQ(search.trim()), setPage(1)), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const n = ++req.current;
    setRows(null);
    api
      .opnameLog({ module, estate, opname: opnameId, search: q, page })
      .then((r) => n === req.current && (setRows(r.data), setTotal(r.total), setError("")))
      .catch((e) => n === req.current && (setRows([]), setError(errorText(e, "Gagal memuat log"))));
  }, [module, estate, opnameId, q, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const tone = (aksi: string) =>
    /setuju/i.test(aksi) ? "text-[var(--accent-green)]" : /batal|hapus|kembali/i.test(aksi) ? "text-[var(--accent-red)]" : /koreksi/i.test(aksi) ? "text-[var(--accent-amber)]" : "text-[var(--accent-blue)]";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-6xl max-h-full overflow-y-auto rounded-lg bg-[var(--bg-page)] shadow-2xl p-4 sm:p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{opnameId ? `Log Stok Opname #${opnameId}` : "Log Stok Opname"}</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Buat, ubah tim, selesai hitung, ajukan, kembalikan, setujui, batal, hapus, dan koreksi stok hasil opname{estate ? ` · ${estate}` : ""}.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[#e2e8f0]" title="Tutup">
            <X size={18} />
          </button>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nomor opname, nama barang, aksi atau nama pengguna..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="table-scroll">
            <table className="data-table text-sm">
              <thead>
                <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
                  <th className="px-3 py-2.5 whitespace-nowrap">Waktu</th>
                  <th className="px-3 py-2.5">Lokasi</th>
                  <th className="px-3 py-2.5">Aksi</th>
                  <th className="px-3 py-2.5">Objek</th>
                  <th className="px-3 py-2.5">Detail</th>
                  <th className="px-3 py-2.5">Oleh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows === null ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      Memuat...
                    </td>
                  </tr>
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      Belum ada aktivitas stok opname.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--text-secondary)]">{waktu(r.created_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {MODUL[r.module] ?? r.module} {r.estate}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap font-medium ${tone(r.aksi)}`}>{r.aksi}</td>
                      <td className="px-3 py-2">{r.objek}</td>
                      <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">{r.detail || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{r.nama || r.username || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
              <span>{total.toLocaleString("id-ID")} aktivitas</span>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1 rounded border border-[var(--border)] disabled:opacity-40">
                  <ChevronLeft size={14} />
                </button>
                {page} / {pages}
                <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1 rounded border border-[var(--border)] disabled:opacity-40">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
