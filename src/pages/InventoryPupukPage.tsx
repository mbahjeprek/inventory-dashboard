import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Sprout, PackagePlus, Pencil, Trash2 } from "lucide-react";
import { api, errorText, type PupukRecord, type PupukSummary } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PupukTransactionModal } from "../components/PupukTransactionModal";
import { EditPupukModal } from "../components/EditPupukModal";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { useDragScroll } from "../hooks/useDragScroll";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const kg = (n: number | null | undefined) => (n ? n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "-");

// Inventory Pupuk for one estate: a ledger laid out like the source Google Sheet's STOCK PUPUK tab,
// with one running Stok (KG) per jenis pupuk for this estate.
export function InventoryPupukPage({ estate }: { estate: string }) {
  const [summary, setSummary] = useState<PupukSummary | null>(null);
  const [options, setOptions] = useState<{ jenis: string[]; divisi: string[] }>({ jenis: [], divisi: [] });
  const [rows, setRows] = useState<PupukRecord[]>([]);
  const [total, setTotal] = useState(0);
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const [keluarSum, setKeluarSum] = useState(0);
  const [diterimaSum, setDiterimaSum] = useState(0);
  const [search, setSearch] = useState("");
  const [jenis, setJenis] = useState("");
  const [divisi, setDivisi] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showTransaksi, setShowTransaksi] = useState(false);
  const { user } = useAuth();
  // Edit / delete buttons follow the account's ticked permissions (Pengguna); the Aksi column shows
  // when it may do either.
  const canEdit = can(user, "pupuk.edit");
  const canDelete = can(user, "pupuk.delete");
  const showActions = canEdit || canDelete;
  // "Transaksi" opens the Stok Masuk / Keluar / Koreksi form: shown when any of those is allowed.
  const canInput = can(user, "pupuk.input");
  const canTx = canInput || can(user, "pupuk.koreksi");
  const [editing, setEditing] = useState<PupukRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PupukRecord | null>(null);
  const pageSize = 25;

  const filters = () => ({ estate, search, jenis_pupuk: jenis, divisi, dateFrom, dateTo });

  // Masuk/keluar under each card follow the date filter, or the current month without one; the
  // stock value is the balance as of the filter's end date (today's balance without one).
  const flowRange =
    dateFrom || dateTo
      ? { dateFrom, dateTo }
      : { dateFrom: localIso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), dateTo: localIso(new Date()) };
  const flowLabel =
    dateFrom || dateTo
      ? `${dateFrom ? fmtDate(dateFrom) : "Awal"} – ${dateTo ? fmtDate(dateTo) : "Sekarang"}`
      : new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const loadSummary = () => api.pupukSummary(estate, { ...flowRange, asOf: dateTo }).then(setSummary);

  const load = () => {
    setLoading(true);
    api.pupuk({ ...filters(), page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setKeluarSum(res.keluarSum);
      setDiterimaSum(res.diterimaSum);
      setLoading(false);
    });
  };

  useEffect(() => {
    api.pupukOptions(estate).then(setOptions);
  }, [estate]);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate, dateFrom, dateTo]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate, page, jenis, divisi, dateFrom, dateTo]);

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

  const jenisList = Array.from(new Set([...(summary?.saldoTerakhir.map((s) => s.jenis_pupuk) ?? []), ...options.jenis])).sort();
  const cardJenis = jenisList.length ? jenisList : ["PUPUK NPK"];
  const saldoFor = (j: string) => summary?.saldoPerTanggal.find((s) => s.jenis_pupuk === j)?.saldo_stock ?? 0;
  const flowFor = (j: string) => summary?.perJenis.find((s) => s.jenis_pupuk === j);

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.pupuk({ ...filters(), page: p, pageSize: ps }));
    const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
    const active = [
      search && `Cari: "${search}"`,
      jenis && `Nama Barang: ${jenis}`,
      divisi && `Divisi: ${divisi}`,
      (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`,
    ].filter(Boolean);
    return {
      title: `Inventory Pupuk NPK - ${estate}`,
      subtitle: [
        ...(active.length ? [`Filter: ${active.join(" · ")}`] : []),
        `${total.toLocaleString("id-ID")} transaksi · total stok masuk ${diterimaSum.toLocaleString("id-ID")} KG · total stok keluar ${keluarSum.toLocaleString("id-ID")} KG`,
      ],
      landscape: true,
      columns: [
        { label: "Periode", nowrap: true },
        { label: "Tanggal", nowrap: true },
        { label: "Nama Barang" },
        { label: "Divisi" },
        { label: "No. Embrace" },
        { label: "Kode Barang" },
        { label: "Stok Masuk (KG)", align: "right" },
        { label: "Stok Keluar (KG)", align: "right" },
        { label: "Saldo Stok (KG)", align: "right" },
        { label: "Keterangan" },
        { label: "Blok" },
        { label: "HA", align: "right" },
        { label: "Pokok", align: "right" },
      ],
      rows: all.map((r) => [
        r.periode,
        r.tanggal,
        r.jenis_pupuk,
        r.divisi,
        r.no_embrace,
        r.kode_barang,
        r.diterima || null,
        r.keluar || null,
        r.saldo_stock,
        r.keterangan,
        r.blok,
        r.ha,
        r.pokok,
      ]),
    };
  };

  const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Inventory Pupuk NPK - {estate}</h1>
          <p className="text-sm text-[var(--text-secondary)]">Monitoring stok, penerimaan & pemakaian pupuk per blok</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityLogButton module="PUPUK" estate={estate} />
          <ExportButtons total={total} buildReport={buildReport} fileName={`inventory-pupuk-${estate.toLowerCase()}`} />
          {canTx && (<button
            onClick={() => setShowTransaksi(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
          >
            <PackagePlus size={16} /> Transaksi
          </button>)}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {cardJenis.map((j) => {
          const active = jenis === j;
          const saldo = saldoFor(j);
          return (
            <StatCard
              key={j}
              label={`Stok ${j} - ${estate}${dateTo ? ` (per ${fmtDate(dateTo)})` : ""}`}
              value={saldo.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
              suffix="KG"
              icon={Sprout}
              tone={saldo < 0 ? "red" : "green"}
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
                      <div className="text-sm font-semibold text-[var(--accent-green)]">{(flowFor(j)?.diterima ?? 0).toLocaleString("id-ID")} KG</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Stok Keluar</div>
                      <div className="text-sm font-semibold text-[var(--accent-red)]">{(flowFor(j)?.keluar ?? 0).toLocaleString("id-ID")} KG</div>
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
            placeholder="Cari jenis pupuk, divisi, blok, no. embrace, atau keterangan..."
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
          <option value="">Semua Pupuk</option>
          {jenisList.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        <select
          value={divisi}
          onChange={(e) => {
            setDivisi(e.target.value);
            setPage(1);
          }}
          className={selectCls}
        >
          <option value="">Semua Divisi</option>
          {options.divisi.map((d) => (
            <option key={d} value={d}>
              {d}
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
        {total.toLocaleString("id-ID")} transaksi · total stok masuk{" "}
        <span className="font-medium text-[var(--text-primary)]">{diterimaSum.toLocaleString("id-ID")} KG</span> · total stok keluar{" "}
        <span className="font-medium text-[var(--text-primary)]">{keluarSum.toLocaleString("id-ID")} KG</span>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="grid-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Periode</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Tanggal</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Nama Barang</th>
                <th className="px-4 py-2.5">Divisi</th>
                <th className="px-4 py-2.5 whitespace-nowrap">No. Embrace</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Kode Barang</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Stok Masuk (KG)</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Stok Keluar (KG)</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Saldo Stok (KG)</th>
                <th className="px-4 py-2.5">Keterangan</th>
                <th className="px-4 py-2.5">Blok</th>
                <th className="px-4 py-2.5 text-right">HA</th>
                <th className="px-4 py-2.5 text-right">Pokok</th>
                {showActions && <th className="px-4 py-2.5 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={showActions ? 14 : 13} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={showActions ? 14 : 13} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)] text-xs">{r.periode || "-"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{r.tanggal || "-"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs">{r.jenis_pupuk}</td>
                    <td className="px-4 py-2.5 text-xs">{r.divisi || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{r.no_embrace || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{r.kode_barang || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-green)]">{kg(r.diterima)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-red)]">{kg(r.keluar)}</td>
                    <td className={`px-4 py-2.5 text-right ${(r.saldo_stock ?? 0) < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>
                      {r.saldo_stock !== null ? r.saldo_stock.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs max-w-[260px] truncate" title={r.keterangan}>
                      {r.keterangan || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{r.blok || "-"}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{r.ha != null ? r.ha.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "-"}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{r.pokok != null ? r.pokok.toLocaleString("id-ID", { maximumFractionDigits: 0 }) : "-"}</td>
                    {showActions && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          {canEdit && (<button
                            onClick={() => setEditing(r)}
                            title="Edit"
                            className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                          >
                            <Pencil size={14} />
                          </button>)}
                          {canDelete && (<button
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

      {showTransaksi && (
        <PupukTransactionModal
          estate={estate}
          summary={summary}
          jenisOptions={cardJenis}
          divisiOptions={options.divisi}
          onClose={() => setShowTransaksi(false)}
          onSuccess={() => {
            setShowTransaksi(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <EditPupukModal
          record={editing}
          divisiOptions={options.divisi}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus transaksi ${confirmDelete.jenis_pupuk} tanggal ${confirmDelete.tanggal}${confirmDelete.blok ? ` blok ${confirmDelete.blok}` : ""}? Tindakan ini tidak bisa dibatalkan.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            setConfirmDelete(null);
            try {
              await api.deletePupuk(confirmDelete.id);
            } catch (e) {
              window.alert(errorText(e, "Gagal menghapus transaksi"));
              return;
            }
            refresh();
          }}
        />
      )}
    </div>
  );
}
