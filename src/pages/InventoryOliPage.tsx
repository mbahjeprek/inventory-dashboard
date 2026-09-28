import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Droplet, PackagePlus, ListPlus, Pencil, Trash2 } from "lucide-react";
import { api, errorText, type OliRecord, type OliSummary } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { OliTransactionModal } from "../components/OliTransactionModal";
import { EditOliModal } from "../components/EditOliModal";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { useDragScroll } from "../hooks/useDragScroll";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { EvidenceLink } from "../components/EvidenceInput";
import { tanggalWaktu } from "../lib/datetime";
import { OliBatchModal } from "../components/SaldoBatchModal";

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const ltr = (n: number | null | undefined) => (n ? n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "-");
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

// Inventory Oli for one estate: a ledger laid out like the source "STOK OLI" sheet, with one running
// Stok (LTR) per jenis oli for this estate. Same shape as Inventory Pupuk.
export function InventoryOliPage({ estate }: { estate: string }) {
  const [summary, setSummary] = useState<OliSummary | null>(null);
  const [jenisOptions, setJenisOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<OliRecord[]>([]);
  const [total, setTotal] = useState(0);
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const [pemakaianSum, setPemakaianSum] = useState(0);
  const [diterimaSum, setDiterimaSum] = useState(0);
  const [search, setSearch] = useState("");
  const [jenis, setJenis] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showTransaksi, setShowTransaksi] = useState(false);
  // Input Banyak (many Stok Masuk / Keluar in one go) and its "saved" notice.
  const [showBatch, setShowBatch] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const { user } = useAuth();
  const canEdit = can(user, "oli.edit");
  const canDelete = can(user, "oli.delete");
  const showActions = canEdit || canDelete;
  const canInput = can(user, "oli.input");
  const [editing, setEditing] = useState<OliRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OliRecord | null>(null);
  const pageSize = 25;
  const colCount = showActions ? 10 : 9;

  const filters = () => ({ estate, search, jenis_oli: jenis, dateFrom, dateTo });

  // Masuk/pemakaian under each card follow the date filter, or the current month without one.
  const flowRange =
    dateFrom || dateTo
      ? { dateFrom, dateTo }
      : { dateFrom: localIso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), dateTo: localIso(new Date()) };
  const flowLabel =
    dateFrom || dateTo
      ? `${dateFrom ? fmtDate(dateFrom) : "Awal"} – ${dateTo ? fmtDate(dateTo) : "Sekarang"}`
      : new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const loadSummary = () => api.oliSummary(estate, { ...flowRange, asOf: dateTo }).then(setSummary);

  const load = () => {
    setLoading(true);
    api.oli({ ...filters(), page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setPemakaianSum(res.pemakaianSum);
      setDiterimaSum(res.diterimaSum);
      setLoading(false);
    });
  };

  useEffect(() => {
    api.oliOptions(estate).then((r) => setJenisOptions(r.jenis));
  }, [estate]);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate, dateFrom, dateTo]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate, page, jenis, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const refresh = () => {
    loadSummary();
    load();
  };

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const jenisList = Array.from(new Set([...(summary?.saldoTerakhir.map((s) => s.jenis_oli) ?? []), ...jenisOptions])).sort();
  const saldoFor = (j: string) => summary?.saldoPerTanggal.find((s) => s.jenis_oli === j)?.saldo_stock ?? 0;
  const flowFor = (j: string) => summary?.perJenis.find((s) => s.jenis_oli === j);

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.oli({ ...filters(), page: p, pageSize: ps }));
    const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
    const active = [
      search && `Cari: "${search}"`,
      jenis && `Jenis Oli: ${jenis}`,
      (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`,
    ].filter(Boolean);
    return {
      title: `Inventory Oli - ${estate}`,
      subtitle: [
        ...(active.length ? [`Filter: ${active.join(" · ")}`] : []),
        `${total.toLocaleString("id-ID")} transaksi · total stok masuk ${fmt(diterimaSum)} LTR · total pemakaian ${fmt(pemakaianSum)} LTR`,
      ],
      landscape: true,
      columns: [
        { label: "Periode", nowrap: true },
        { label: "Tanggal", nowrap: true },
        { label: "Jenis Oli", nowrap: true },
        { label: "No. BPB" },
        { label: "Diterima (LTR)", align: "right" },
        { label: "Pemakaian (LTR)", align: "right" },
        { label: "Stock (LTR)", align: "right" },
        { label: "Keterangan" },
      ],
      rows: all.map((r) => [r.periode, tanggalWaktu(r.tanggal_iso, r.created_at, r.tanggal), r.jenis_oli, r.no_embrace, r.diterima || ((r.pinjam ?? 0) > 0 ? r.pinjam : null), r.pemakaian || ((r.pinjam ?? 0) < 0 ? -r.pinjam! : null), r.saldo_stock, r.keterangan]),
    };
  };

  const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Inventory Oli - {estate}</h1>
          <p className="text-sm text-[var(--text-secondary)]">Monitoring stok, penerimaan & pemakaian oli per unit</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityLogButton module="OLI" estate={estate} />
          <ExportButtons total={total} buildReport={buildReport} fileName={`inventory-oli-${estate.toLowerCase()}`} />
          {canInput && (
            <button
              onClick={() => setShowBatch(true)}
              title="Banyak transaksi sekaligus"
              className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
            >
              <ListPlus size={16} /> Input Banyak
            </button>
          )}
          {canInput && (
            <button
              onClick={() => setShowTransaksi(true)}
              className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
            >
              <PackagePlus size={16} /> Transaksi
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {jenisList.map((j) => {
          const active = jenis === j;
          const saldo = saldoFor(j);
          return (
            <StatCard
              key={j}
              label={`Stok ${j} - ${estate}${dateTo ? ` (per ${fmtDate(dateTo)})` : ""}`}
              value={fmt(saldo)}
              suffix="LTR"
              icon={Droplet}
              tone={saldo < 0 ? "red" : "amber"}
              active={active}
              onClick={() => {
                setJenis(active ? "" : j);
                setPage(1);
              }}
              footer={
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] mb-1.5">{flowLabel}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Stok Masuk</div>
                      <div className="text-sm font-semibold text-[var(--accent-green)]">{fmt(flowFor(j)?.diterima ?? 0)} LTR</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Pemakaian</div>
                      <div className="text-sm font-semibold text-[var(--accent-red)]">{fmt(flowFor(j)?.pemakaian ?? 0)} LTR</div>
                    </div>
                  </div>
                </div>
              }
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari jenis oli, no. BPB, atau keterangan (unit)..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        <select
          value={jenis}
          onChange={(e) => {
            setJenis(e.target.value);
            setPage(1);
          }}
          className={selectCls}
        >
          <option value="">Semua Jenis Oli</option>
          {jenisList.map((j) => (
            <option key={j} value={j}>
              {j}
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

      <div className="text-sm text-[var(--text-secondary)]">
        {total.toLocaleString("id-ID")} transaksi · total stok masuk <span className="font-medium text-[var(--text-primary)]">{fmt(diterimaSum)} LTR</span> ·
        total pemakaian <span className="font-medium text-[var(--text-primary)]">{fmt(pemakaianSum)} LTR</span>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="grid-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Periode</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Tanggal</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Jenis Oli</th>
                <th className="px-4 py-2.5 whitespace-nowrap">No. BPB</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Diterima (LTR)</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Pemakaian (LTR)</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Stock (LTR)</th>
                <th className="px-4 py-2.5">Keterangan</th>
                <th className="px-4 py-2.5 text-center">Bukti</th>
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
                    {search || jenis || dateFrom || dateTo ? "Tidak ada data yang cocok dengan filter" : `Belum ada data oli di ${estate}. Klik "Transaksi" untuk mencatat oli masuk.`}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)] text-xs">{r.periode || "-"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{tanggalWaktu(r.tanggal_iso, r.created_at, r.tanggal)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs">{r.jenis_oli}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{r.no_embrace || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-green)]">{r.diterima ? ltr(r.diterima) : (r.pinjam ?? 0) > 0 ? <>{ltr(r.pinjam)}<span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">pinjam</span></> : "-"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-red)]">{r.pemakaian ? ltr(r.pemakaian) : (r.pinjam ?? 0) < 0 ? <>{ltr(-r.pinjam!)}<span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">pinjam</span></> : "-"}</td>
                    <td className={`px-4 py-2.5 text-right ${(r.saldo_stock ?? 0) < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>
                      {r.saldo_stock !== null ? fmt(r.saldo_stock) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs max-w-[320px] truncate" title={r.keterangan}>
                      {r.keterangan || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {r.evidence_id ? <EvidenceLink id={r.evidence_id} label="Lihat" /> : <span className="text-[var(--text-muted)]">-</span>}
                    </td>
                    {showActions && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          {r.pinjaman_id != null && (
                            // Booked by a Pinjaman: changed / removed only on the Pinjaman page.
                            <Link to="/pinjaman?status=" title="Kelola lewat menu Pinjaman" className="text-xs text-[var(--accent-blue)] hover:underline whitespace-nowrap">
                              Pinjaman #{r.pinjaman_id}
                            </Link>
                          )}
                          {!r.pinjaman_id && canEdit && (
                            <button
                              onClick={() => setEditing(r)}
                              title="Edit"
                              className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          {!r.pinjaman_id && canDelete && (
                            <button
                              onClick={() => setConfirmDelete(r)}
                              title="Hapus"
                              className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
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

      {batchNotice && (
        <div className="fixed bottom-4 right-4 z-50 text-sm rounded-md px-4 py-2.5 shadow-lg bg-[var(--accent-green)] text-white">{batchNotice}</div>
      )}
      {showBatch && (
        <OliBatchModal
          estate={estate}
          summary={summary}
          jenisOptions={jenisList}
          onClose={() => setShowBatch(false)}
          onSuccess={(count) => {
            setShowBatch(false);
            setBatchNotice(`${count} transaksi tersimpan`);
            setTimeout(() => setBatchNotice(""), 3000);
            refresh();
          }}
        />
      )}
      {showTransaksi && (
        <OliTransactionModal
          estate={estate}
          summary={summary}
          jenisOptions={jenisList}
          onClose={() => setShowTransaksi(false)}
          onSuccess={() => {
            setShowTransaksi(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <EditOliModal
          record={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus transaksi ${confirmDelete.jenis_oli} tanggal ${confirmDelete.tanggal}? Tindakan ini tidak bisa dibatalkan.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            setConfirmDelete(null);
            try {
              await api.deleteOli(confirmDelete.id);
            } catch (e) {
              window.alert(errorText(e, "Gagal menghapus transaksi", true));
              return;
            }
            refresh();
          }}
        />
      )}
    </div>
  );
}
