import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { api, type LedgerTx, type StockScope } from "../lib/api";
import { ExportButtons } from "./ExportButtons";
import { ConfirmDialog } from "./ConfirmDialog";
import { EditLedgerTxModal } from "./EditLedgerTxModal";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { useDragScroll } from "../hooks/useDragScroll";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";

const formatWaktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Stock In or Stock Out tab of a gudang (KNS/WJA/Zamrud/Firus) or klinik page: every movement of
// that location across all items. `refreshKey` changes after a new transaction so the list reloads.
export function LedgerHistory({ scope, type, refreshKey }: { scope: StockScope; type: "IN" | "OUT"; refreshKey: number }) {
  const { user } = useAuth();
  // Edit / delete follow the account's permissions for this module (Pengguna).
  const canEdit = can(user, `${scope.kind}.edit`);
  const canDelete = can(user, `${scope.kind}.delete`);
  const showActions = canEdit || canDelete;
  const isOut = type === "OUT";
  const isKlinik = scope.kind === "klinik";
  const noun = isKlinik ? "obat" : "barang";
  const showTujuan = isOut && !isKlinik;
  const personLabel = isOut ? (isKlinik ? "Pasien / Penerima" : "Penerima") : "Diterima Oleh";

  const [rows, setRows] = useState<LedgerTx[]>([]);
  const [total, setTotal] = useState(0);
  const [qtySum, setQtySum] = useState(0);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LedgerTx | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LedgerTx | null>(null);
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const pageSize = 25;
  const colCount = 7 + (showTujuan ? 1 : 0) + (showActions ? 1 : 0);

  const query = () => ({ type, search, dateFrom, dateTo });

  const load = () => {
    setLoading(true);
    api.ledgerHistory(scope, { ...query(), page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setQtySum(res.qtySum);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind, scope.name, type, page, dateFrom, dateTo, refreshKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const title = `${isOut ? "Stock Out" : "Stock In"} ${isKlinik ? "Klinik" : "Gudang"} - ${scope.name}`;

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.ledgerHistory(scope, { ...query(), page: p, pageSize: ps }));
    const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
    const active = [search && `Cari: "${search}"`, (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`].filter(Boolean);
    return {
      title,
      subtitle: active.length ? [`Filter: ${active.join(" · ")}`] : [],
      landscape: true,
      columns: [
        { label: "Waktu", nowrap: true },
        { label: "Kode", nowrap: true },
        { label: isKlinik ? "Nama Obat/Barang" : "Nama Barang" },
        { label: "Qty", align: "right" },
        { label: "Satuan" },
        ...(showTujuan ? [{ label: "Tujuan" }] : []),
        { label: personLabel },
        { label: "Catatan" },
        { label: "Diinput Oleh" },
      ],
      rows: all.map((r) => [
        formatWaktu(r.created_at),
        r.kode,
        r.nama,
        r.qty,
        r.satuan,
        ...(showTujuan ? [r.tujuan] : []),
        r.penerima,
        [
          r.is_correction ? "Koreksi" : "",
          r.tujuan === "DIBUANG" ? "Dibuang (expired)" : "",
          r.note ?? "",
          isKlinik && r.alloc?.length ? `Batch exp: ${r.alloc.map((a) => `${a.exp || "tanpa tanggal"} (${a.qty})`).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        r.input_oleh,
      ]),
    };
  };

  const remove = async (r: LedgerTx) => {
    await api.deleteLedgerTx(scope, r.id);
    if (rows.length === 1 && page > 1) setPage((p) => p - 1);
    else load();
  };

  const inputCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">
          {total.toLocaleString("id-ID")} transaksi · total {qtySum.toLocaleString("id-ID")} unit {isOut ? "keluar" : "masuk"}
        </p>
        <div className="flex items-center gap-2">
          <ExportButtons total={total} buildReport={buildReport} fileName={`${isOut ? "stock-out" : "stock-in"}-${scope.kind}-${scope.name.toLowerCase()}`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Cari ${noun === "obat" ? "obat, jenis, kegunaan" : "barang"}, ${personLabel.toLowerCase()}, atau catatan...`}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className={inputCls}
        />
        <span className="text-[var(--text-muted)] text-sm">-</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className={inputCls}
        />
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="grid-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Waktu</th>
                <th className="px-4 py-2.5">Kode</th>
                <th className="px-4 py-2.5">{isKlinik ? "Nama Obat/Barang" : "Nama Barang"}</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                {showTujuan && <th className="px-4 py-2.5">Tujuan</th>}
                <th className="px-4 py-2.5">{personLabel}</th>
                <th className="px-4 py-2.5">Catatan</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Diinput Oleh</th>
                {showActions && <th className="px-4 py-2.5 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {search || dateFrom || dateTo
                      ? "Tidak ada transaksi yang cocok dengan filter"
                      : `Belum ada ${isOut ? "Stock Out" : "Stock In"}. Input lewat tombol "Transaksi".`}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{formatWaktu(r.created_at)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-[var(--text-secondary)]">{r.kode}</td>
                    <td className="px-4 py-2.5">{r.nama}</td>
                    <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${isOut ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"}`}>
                      {isOut ? "-" : "+"}
                      {r.qty.toLocaleString("id-ID")} {r.satuan}
                    </td>
                    {showTujuan && <td className="px-4 py-2.5">{r.tujuan || <span className="text-[var(--text-muted)]">-</span>}</td>}
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.penerima || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] max-w-[260px]">
                      {r.is_correction ? (
                        <span className="mr-1.5 text-[10px] px-1.5 py-0.5 rounded-full border bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]">
                          Koreksi
                        </span>
                      ) : null}
                      {r.tujuan === "DIBUANG" && (
                        <span className="mr-1.5 text-[10px] px-1.5 py-0.5 rounded-full border bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]">
                          Dibuang (expired)
                        </span>
                      )}
                      {r.note || (r.is_correction || r.tujuan === "DIBUANG" ? "" : "-")}
                      {isKlinik && r.alloc && r.alloc.length > 0 && (
                        <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                          Batch exp:{" "}
                          {r.alloc.map((a) => `${a.exp ? a.exp.split("-").reverse().join("/") : "tanpa tanggal"} (${a.qty.toLocaleString("id-ID")})`).join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{r.input_oleh || "-"}</td>
                    {showActions && (
                      <td className="px-4 py-2.5 text-right">
                        {r.is_transfer ? (
                          // Booked by a Stok Keluar from another gudang; it follows that one.
                          <span className="text-[11px] text-[var(--text-muted)]" title="Ubah atau hapus lewat stok keluar di gudang asalnya">
                            Otomatis
                          </span>
                        ) : (
                          <div className="inline-flex gap-1.5">
                            {canEdit && (<button
                              onClick={() => setEditing(r)}
                              title="Edit transaksi"
                              className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                            >
                              <Pencil size={14} />
                            </button>)}
                            {canDelete && (<button
                              onClick={() => setConfirmDelete(r)}
                              title="Hapus transaksi"
                              className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                            >
                              <Trash2 size={14} />
                            </button>)}
                          </div>
                        )}
                      </td>
                    )}
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
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40">
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

      {editing && (
        <EditLedgerTxModal
          scope={scope}
          tx={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus ${isOut ? "Stock Out" : "Stock In"} ${confirmDelete.qty} ${confirmDelete.satuan} "${confirmDelete.nama}"? Stok akan ${
            isOut ? "dikembalikan (bertambah)" : "dikurangi"
          } ${confirmDelete.qty}.`}
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
