import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Fuel, Droplet, PackagePlus, Pencil, Trash2, ListPlus } from "lucide-react";
import { api, errorText, type BbmRecord, type BbmSummary } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { BbmTransactionModal } from "../components/BbmTransactionModal";
import { BbmBatchModal } from "../components/BbmBatchModal";
import { EditBbmModal } from "../components/EditBbmModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { useDragScroll } from "../hooks/useDragScroll";
import { EvidenceLink } from "../components/EvidenceInput";
import { tanggalWaktu } from "../lib/datetime";
import { loanTag } from "../lib/opname";

const JENIS_OPTIONS = ["SOLAR", "BENSIN"];

export function InventoryBbmPage({ lokasiLock }: { lokasiLock?: string } = {}) {
  const [summary, setSummary] = useState<BbmSummary | null>(null);
  const [lokasiOptions, setLokasiOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<BbmRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [pemakaianSum, setPemakaianSum] = useState(0);
  const [diterimaSum, setDiterimaSum] = useState(0);
  const [search, setSearch] = useState("");
  const [jenisBbm, setJenisBbm] = useState("");
  const [lokasi, setLokasi] = useState(lokasiLock ?? "");
  const [alat, setAlat] = useState("");
  const [alatOptions, setAlatOptions] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showTransaksi, setShowTransaksi] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [notice, setNotice] = useState("");
  const { user } = useAuth();
  // Edit / delete buttons follow the account's ticked permissions (Pengguna); the Aksi column shows
  // when it may do either.
  const canEdit = can(user, "bbm.edit");
  const canDelete = can(user, "bbm.delete");
  const showActions = canEdit || canDelete;
  // "Transaksi" opens the Stok Masuk / Keluar / Koreksi form: shown when any of those is allowed.
  const canInput = can(user, "bbm.input");
  const canTx = canInput || can(user, "bbm.koreksi");
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const [editing, setEditing] = useState<BbmRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BbmRecord | null>(null);
  const pageSize = 25;

  // Stok masuk/keluar under each card follow the page's date filter; with no filter they cover the
  // current month (an all-time total since 2023 isn't a useful number).
  const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const flowRange =
    dateFrom || dateTo
      ? { dateFrom, dateTo }
      : { dateFrom: localIso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), dateTo: localIso(new Date()) };
  const flowLabel = (() => {
    const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    if (!dateFrom && !dateTo) return new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    return `${flowRange.dateFrom ? fmt(flowRange.dateFrom) : "Awal"} – ${flowRange.dateTo ? fmt(flowRange.dateTo) : "Sekarang"}`;
  })();
  const loadSummary = () => api.bbmSummary(lokasiLock, { ...flowRange, asOf: dateTo }).then(setSummary);

  const load = () => {
    setLoading(true);
    api.bbm({ search, jenis_bbm: jenisBbm, lokasi, kode_kendaraan: alat, dateFrom, dateTo, page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setPemakaianSum(res.pemakaianSum);
      setDiterimaSum(res.diterimaSum);
      setLoading(false);
    });
  };

  useEffect(() => {
    api.bbmLokasiOptions().then(setLokasiOptions);
  }, []);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  useEffect(() => {
    api.bbmAlatOptions(lokasiLock ?? lokasi).then(setAlatOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lokasiLock, lokasi]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, jenisBbm, lokasi, alat, dateFrom, dateTo]);

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
    const all = await fetchAllRows((p, ps) =>
      api.bbm({ search, jenis_bbm: jenisBbm, lokasi, kode_kendaraan: alat, dateFrom, dateTo, page: p, pageSize: ps })
    );
    const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
    const filters = [
      search && `Cari: "${search}"`,
      jenisBbm && `Jenis BBM: ${jenisBbm}`,
      `Lokasi: ${lokasiLock || lokasi || "Semua"}`,
      alat && `Alat: ${alat}`,
      (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`,
    ].filter(Boolean);
    return {
      title: `Inventory BBM${lokasiLock ? ` - ${lokasiLock}` : ""}`,
      subtitle: [
        `Filter: ${filters.join(" · ")}`,
        `${total.toLocaleString("id-ID")} transaksi · total stock out ${pemakaianSum.toLocaleString("id-ID")} LTR · total stock in ${diterimaSum.toLocaleString("id-ID")} LTR`,
      ],
      landscape: true,
      columns: [
        { label: "Periode", nowrap: true },
        { label: "Tanggal", nowrap: true },
        { label: "No. SPB" },
        { label: "Stock In", align: "right" },
        { label: "Stock Out", align: "right" },
        { label: "Saldo Stock", align: "right" },
        { label: "Keterangan" },
        { label: "Status Kepemilikan" },
        { label: "Kode Kendaraan" },
        { label: "HM Terakhir Sebelum Permintaan Solar" },
        { label: "Total HM Sebelum Pengisian", align: "right" },
      ],
      // Same rules as the table cells: 0/empty Stok Masuk & Keluar show "-", Saldo shows 0.
      rows: all.map((r) => [
        r.periode,
        tanggalWaktu(r.tanggal_iso, r.created_at, r.tanggal),
        r.no_spb,
        r.diterima || ((r.pinjam ?? 0) > 0 ? r.pinjam : null),
        r.pemakaian || ((r.pinjam ?? 0) < 0 ? -r.pinjam! : null),
        r.saldo_stock,
        r.keterangan,
        r.status_kepemilikan,
        r.kode_kendaraan,
        r.hm_terakhir,
        r.total_hm,
      ]),
    };
  };

  const handleDelete = async (r: BbmRecord) => {
    try {
      await api.deleteBbm(r.id);
    } catch (e) {
      window.alert(errorText(e, "Gagal menghapus transaksi", true));
      return;
    }
    loadSummary();
    load();
  };

  const flowFor = (jenis: string, lok: string) => summary?.perLokasi.find((s) => s.jenis_bbm === jenis && s.lokasi === lok);

  // The cards show the closing balance as of the date filter's end (or today's balance when there
  // is no end date); 0 when that jenis/lokasi had no transactions yet by then.
  const saldoFor = (jenis: string, lok: string) =>
    summary?.saldoPerTanggal.find((s) => s.jenis_bbm === jenis && s.lokasi === lok)?.saldo_stock ?? 0;

  // A locked lokasi always gets its Solar and Bensin cards, even before its first transaction
  // (Zamrud/Firus start empty); the all-lokasi view shows whichever lokasi have data.
  const saldoCards = JENIS_OPTIONS.flatMap((jenis) =>
    (lokasiLock ? [lokasiLock] : summary ? summary.saldoTerakhir.filter((s) => s.jenis_bbm === jenis).map((s) => s.lokasi) : [])
      .sort()
      .map((lok) => ({ jenis, lok, saldo: saldoFor(jenis, lok) }))
  ).filter((c) => c.saldo !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Inventory BBM{lokasiLock ? ` - ${lokasiLock}` : ""}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">Monitoring stok & histori pemakaian Solar dan Bensin per lokasi</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(lokasiLock || lokasi) && <ActivityLogButton key={lokasiLock || lokasi} module="BBM" estate={lokasiLock || lokasi} />}
          <ExportButtons
            total={total}
            buildReport={buildReport}
            fileName={`inventory-bbm${lokasiLock ? `-${lokasiLock.toLowerCase()}` : ""}`}
          />
          {canInput && (
            <button
              onClick={() => setShowBatch(true)}
              title="Banyak transaksi satu tanggal sekaligus"
              className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
            >
              <ListPlus size={16} /> Input Banyak
            </button>
          )}
          {canTx && (<button
            onClick={() => setShowTransaksi(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
          >
            <PackagePlus size={16} /> Transaksi
          </button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {saldoCards.map(({ jenis, lok, saldo }) => {
          const active = jenisBbm === jenis && (!!lokasiLock || lokasi === lok);
          return (
            <StatCard
              key={`${jenis}-${lok}`}
              label={`Stok ${jenis === "SOLAR" ? "Solar" : "Bensin"} - ${lok}${dateTo ? ` (per ${new Date(`${dateTo}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })})` : ""}`}
              value={(saldo ?? 0).toLocaleString("id-ID")}
              suffix="LTR"
              icon={jenis === "SOLAR" ? Fuel : Droplet}
              tone={jenis === "SOLAR" ? "blue" : "amber"}
              active={active}
              footer={
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] mb-1.5">{flowLabel}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Stock In</div>
                      <div className="text-sm font-semibold text-[var(--accent-green)]">
                        {(flowFor(jenis, lok)?.diterima ?? 0).toLocaleString("id-ID")} LTR
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Stock Out</div>
                      <div className="text-sm font-semibold text-[var(--accent-red)]">
                        {(flowFor(jenis, lok)?.pemakaian ?? 0).toLocaleString("id-ID")} LTR
                      </div>
                    </div>
                  </div>
                </div>
              }
              onClick={() => {
                setJenisBbm(active ? "" : jenis);
                if (!lokasiLock) setLokasi(active ? "" : lok);
                setPage(1);
              }}
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
            placeholder="Cari jenis BBM, estate, no. SPB, kendaraan, atau keterangan..."
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

        {lokasiLock ? (
          <span className="text-sm rounded-md border border-[var(--border)] px-3 py-2 text-[var(--text-secondary)]">
            Lokasi: {lokasiLock}
          </span>
        ) : (
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
        )}

        <select
          value={alat}
          onChange={(e) => {
            setAlat(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        >
          <option value="">Semua Alat</option>
          {alatOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {/* Tanggal dari - sampai: side by side, half the width each on a phone */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="text-sm rounded-md border border-[var(--border)] px-3 py-2 flex-1 min-w-0 sm:flex-none"
          />
          <span className="text-[var(--text-muted)] text-sm">-</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="text-sm rounded-md border border-[var(--border)] px-3 py-2 flex-1 min-w-0 sm:flex-none"
          />
        </div>
      </div>

      <div className="text-sm text-[var(--text-secondary)]">
        {total.toLocaleString("id-ID")} transaksi · total stock out{" "}
        <span className="font-medium text-[var(--text-primary)]">{pemakaianSum.toLocaleString("id-ID")} LTR</span> · total
        stock in <span className="font-medium text-[var(--text-primary)]">{diterimaSum.toLocaleString("id-ID")} LTR</span>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="grid-table data-table text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Periode</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Tanggal</th>
                <th className="px-4 py-2.5 whitespace-nowrap">No. SPB</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Stock In</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Stock Out</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Saldo Stock</th>
                <th className="px-4 py-2.5">Keterangan</th>
                <th className="px-4 py-2.5 text-center">Bukti</th>
                <th className="px-4 py-2.5">Status Kepemilikan</th>
                <th className="px-4 py-2.5">Kode Kendaraan</th>
                <th className="px-4 py-2.5 min-w-[150px]">HM Terakhir Sebelum Permintaan Solar</th>
                <th className="px-4 py-2.5 text-right min-w-[130px]">Total HM Sebelum Pengisian</th>
                {showActions && <th className="px-4 py-2.5 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={showActions ? 13 : 12} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={showActions ? 13 : 12} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)] text-xs">{r.periode || "-"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{tanggalWaktu(r.tanggal_iso, r.created_at, r.tanggal)}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{r.no_spb || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-green)]">
                      {r.diterima ? r.diterima.toLocaleString("id-ID") : (r.pinjam ?? 0) > 0 ? <>{r.pinjam!.toLocaleString("id-ID")}<span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">{r.pinjaman_jenis === "TRANSFER" ? "transfer" : "pinjam"}</span></> : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-red)]">
                      {r.pemakaian ? r.pemakaian.toLocaleString("id-ID") : (r.pinjam ?? 0) < 0 ? <>{(-r.pinjam!).toLocaleString("id-ID")}<span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">{r.pinjaman_jenis === "TRANSFER" ? "transfer" : "pinjam"}</span></> : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--text-primary)]">
                      {r.saldo_stock !== null ? r.saldo_stock.toLocaleString("id-ID") : "-"}
                    </td>
                    <td className="col-grow px-4 py-2.5 text-[var(--text-secondary)] text-xs whitespace-normal break-words" title={r.keterangan}>
                      {r.keterangan || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {r.evidence_id ? <EvidenceLink id={r.evidence_id} label="Lihat" /> : <span className="text-[var(--text-muted)]">-</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{r.status_kepemilikan || "-"}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{r.kode_kendaraan || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] whitespace-nowrap">{r.hm_terakhir || "-"}</td>
                    <td className="px-4 py-2.5 text-right text-xs">
                      {r.total_hm != null ? r.total_hm.toLocaleString("id-ID", { maximumFractionDigits: 1 }) : "-"}
                    </td>
                    {showActions && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          {r.pinjaman_id != null && (
                            // Booked by a Pinjaman: changed / removed only on the Pinjaman page.
                            <Link to="/pinjaman?status=" title="Kelola lewat menu Pinjaman & Transfer" className="text-xs text-[var(--accent-blue)] hover:underline whitespace-nowrap">
                              {loanTag(r.pinjaman_id, r.keterangan)}
                            </Link>
                          )}
                          {!r.pinjaman_id && canEdit && (<button
                            onClick={() => setEditing(r)}
                            title="Edit"
                            className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                          >
                            <Pencil size={14} />
                          </button>)}
                          {!r.pinjaman_id && canDelete && (<button
                            onClick={() => setConfirmDelete(r)}
                            title="Hapus"
                            className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                          >
                            <Trash2 size={14} />
                          </button>)}
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

      {notice && (
        <div className="fixed bottom-4 right-4 z-50 text-sm rounded-md px-4 py-2.5 shadow-lg bg-[var(--accent-green)] text-white">{notice}</div>
      )}

      {showBatch && (
        <BbmBatchModal
          summary={summary}
          lokasiLock={lokasiLock}
          jenisAwal={jenisBbm === "BENSIN" ? "BENSIN" : "SOLAR"}
          onClose={() => setShowBatch(false)}
          onSuccess={(count) => {
            setShowBatch(false);
            setNotice(`${count} transaksi BBM tersimpan`);
            setTimeout(() => setNotice(""), 3000);
            loadSummary();
            load();
          }}
        />
      )}

      {showTransaksi && (
        <BbmTransactionModal
          summary={summary}
          lokasiLock={lokasiLock}
          jenisAwal={jenisBbm === "BENSIN" ? "BENSIN" : "SOLAR"}
          onClose={() => setShowTransaksi(false)}
          onSuccess={() => {
            setShowTransaksi(false);
            loadSummary();
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
            loadSummary();
            load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus transaksi ${confirmDelete.jenis_bbm} - ${confirmDelete.lokasi} tanggal ${confirmDelete.tanggal}? Tindakan ini tidak bisa dibatalkan.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            handleDelete(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}
