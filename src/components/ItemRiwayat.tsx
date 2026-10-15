import { useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, History, X } from "lucide-react";
import { api, errorText, type LedgerTx, type StockScope } from "../lib/api";
import { ExportButtons } from "./ExportButtons";
import { EvidenceLink } from "./EvidenceInput";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { loanTag } from "../lib/opname";

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });
const formatWaktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

type Item = { kode: string; nama: string; satuan: string; stok?: number | null };

// What a movement was: Stock In / Out, Koreksi (opname), Pinjaman / Transfer, obat dibuang, transfer from Nilam.
function jenisOf(r: LedgerTx) {
  if (r.pinjaman_id) return loanTag(r.pinjaman_id, r.note);
  if (r.is_correction) return r.type === "IN" ? "Koreksi +" : "Koreksi −";
  if (r.tujuan === "DIBUANG") return "Dibuang (expired)";
  if (r.is_transfer) return "Kiriman Gudang Nilam";
  return r.type === "IN" ? "Stock In" : "Stock Out";
}
const catatanOf = (r: LedgerTx, klinik: boolean) =>
  [r.note ?? "", klinik && r.alloc?.length ? `Batch exp: ${r.alloc.map((a) => `${tgl(a.exp) || "tanpa tanggal"} (${a.qty})`).join(", ")}` : ""].filter(Boolean).join(" · ");

// Clock button on a stock row: opens that barang / obat's Riwayat - every Stock In and Out of it at
// this gudang / klinik, newest first, with the stock after each one.
export function ItemRiwayatButton({ scope, item }: { scope: StockScope; item: Item }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Riwayat keluar masuk"
        className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
      >
        <History size={14} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 text-left" onClick={() => setOpen(false)}>
          <div className="w-full max-w-6xl max-h-full overflow-y-auto rounded-lg bg-[var(--bg-page)] shadow-2xl p-4 sm:p-6 whitespace-normal" onClick={(e) => e.stopPropagation()}>
            <ItemRiwayat scope={scope} item={item} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

function ItemRiwayat({ scope, item, onClose }: { scope: StockScope; item: Item; onClose: () => void }) {
  const klinik = scope.kind === "klinik";
  const [type, setType] = useState<"" | "IN" | "OUT">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.ledgerHistory>> | null>(null);
  const [error, setError] = useState("");
  const pageSize = 50;
  const query = () => ({ kode: item.kode, type, dateFrom, dateTo });

  useEffect(() => {
    let stale = false;
    setError("");
    api
      .ledgerHistory(scope, { ...query(), page, pageSize })
      .then((r) => !stale && setRes(r))
      .catch((e) => !stale && setError(errorText(e, "Gagal memuat riwayat")));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind, scope.name, item.kode, type, dateFrom, dateTo, page]);

  const total = res?.total ?? 0;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const personLabel = klinik ? "Pasien / Penerima" : "Referensi";

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.ledgerHistory(scope, { ...query(), page: p, pageSize: ps }));
    const active = [type && (type === "IN" ? "Masuk saja" : "Keluar saja"), (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`].filter(Boolean);
    return {
      title: `Riwayat ${item.nama} - ${klinik ? "Klinik" : "Gudang"} ${scope.name}`,
      subtitle: [`${item.kode} · satuan ${item.satuan}${item.stok != null ? ` · stok sekarang ${fmt(item.stok)}` : ""}`, ...(active.length ? [`Filter: ${active.join(" · ")}`] : [])],
      landscape: true,
      columns: [
        { label: "Tanggal", nowrap: true },
        { label: "Tipe" },
        { label: "Sumber" },
        ...(klinik ? [] : [{ label: "Tujuan" }]),
        { label: "Qty", align: "right" },
        { label: "Saldo", align: "right" },
        { label: personLabel },
        { label: "Keterangan" },
        { label: "Diinput Oleh" },
      ],
      rows: all.map((r) => [
        formatWaktu(r.created_at),
        r.type === "IN" ? "Masuk" : "Keluar",
        jenisOf(r),
        ...(klinik ? [] : [r.tujuan]),
        r.type === "IN" ? r.qty : -r.qty,
        r.saldo ?? null,
        r.penerima,
        catatanOf(r, klinik),
        r.input_oleh,
      ]),
    };
  };

  const inputCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Riwayat {item.nama}</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {klinik ? "Klinik" : "Gudang"} {scope.name} · {item.kode} · {item.satuan}
            {item.stok != null && (
              <>
                {" "}
                · stok sekarang <b className="text-[var(--text-primary)]">{fmt(item.stok)}</b>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {res && <ExportButtons total={total} buildReport={buildReport} fileName={`riwayat-${item.kode.toLowerCase()}-${scope.name.toLowerCase()}`} />}
          <button onClick={onClose} title="Tutup" className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Stok Tersedia</div>
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            {item.stok == null ? "-" : fmt(item.stok)} <span className="text-sm font-normal">{item.satuan}</span>
          </div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Total Masuk{dateFrom || dateTo ? " (periode)" : ""}</div>
          <div className="text-lg font-semibold text-[var(--accent-green)]">{res ? `+${fmt(res.inSum)}` : "…"}</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Total Keluar{dateFrom || dateTo ? " (periode)" : ""}</div>
          <div className="text-lg font-semibold text-[var(--accent-red)]">{res ? `-${fmt(res.outSum)}` : "…"}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as "" | "IN" | "OUT");
            setPage(1);
          }}
          className={inputCls}
          aria-label="Jenis"
        >
          <option value="">Masuk & keluar</option>
          <option value="IN">Masuk saja</option>
          <option value="OUT">Keluar saja</option>
        </select>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className={`${inputCls} flex-1 min-w-0 sm:flex-none`}
            aria-label="Dari tanggal"
          />
          <span className="text-[var(--text-muted)] text-sm">-</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className={`${inputCls} flex-1 min-w-0 sm:flex-none`}
            aria-label="Sampai tanggal"
          />
        </div>
        {res && <span className="text-xs text-[var(--text-secondary)]">{fmt(total)} transaksi</span>}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        {error ? (
          <p className="p-4 text-sm text-[var(--accent-red)]">{error}</p>
        ) : !res ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
        ) : (
          <div className="table-scroll">
            <table className="grid-table data-table text-sm">
              <thead>
                <tr className="text-[var(--text-secondary)] text-xs uppercase">
                  <th className="px-3 py-2.5 text-left">Tanggal</th>
                  <th className="px-3 py-2.5 text-left">Tipe</th>
                  <th className="px-3 py-2.5 text-left">Sumber</th>
                  {!klinik && <th className="px-3 py-2.5 text-left">Tujuan</th>}
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right" title="Stok setelah transaksi ini">
                    Saldo
                  </th>
                  <th className="px-3 py-2.5 text-left">{klinik ? "Pasien / Penerima" : "Referensi"}</th>
                  <th className="px-3 py-2.5 text-left">Keterangan</th>
                  <th className="px-3 py-2.5 text-left">Bukti</th>
                  <th className="px-3 py-2.5 text-left">Diinput Oleh</th>
                </tr>
              </thead>
              <tbody>
                {res.data.length === 0 ? (
                  <tr>
                    <td colSpan={klinik ? 9 : 10} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      Belum ada transaksi
                    </td>
                  </tr>
                ) : (
                  res.data.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{formatWaktu(r.created_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 text-xs ${r.type === "IN" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}>
                          {r.type === "IN" ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                          {r.type === "IN" ? "Masuk" : "Keluar"}
                        </span>
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap text-xs ${r.is_correction || r.pinjaman_id ? "text-[var(--accent-amber)]" : "text-[var(--text-secondary)]"}`}>{jenisOf(r)}</td>
                      {!klinik && <td className="px-3 py-2">{r.tujuan || "-"}</td>}
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${r.type === "IN" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}>
                        {r.type === "IN" ? "+" : "-"}
                        {fmt(r.qty)} <span className="text-[11px] font-normal">{item.satuan}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.saldo == null ? "-" : fmt(r.saldo)}</td>
                      <td className="px-3 py-2">{r.penerima || "-"}</td>
                      <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">{catatanOf(r, klinik) || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.evidence_id ? <EvidenceLink id={r.evidence_id} label="Lihat" /> : <span className="text-[var(--text-muted)]">-</span>}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{r.input_oleh || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] text-sm">
            <span className="text-[var(--text-muted)]">
              Halaman {page} dari {totalPages}
            </span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40" title="Sebelumnya">
                <ChevronLeft size={16} />
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40" title="Berikutnya">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">Terbaru di atas. Saldo = stok setelah transaksi itu, dihitung dari semua transaksi barang ini di {scope.name}. Ubah / hapus transaksi tetap lewat tab Stock In / Stock Out.</p>
    </div>
  );
}
