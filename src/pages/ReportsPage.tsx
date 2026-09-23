import { useState } from "react";
import { FileDown } from "lucide-react";
import * as XLSX from "xlsx";
import { api } from "../lib/api";

export function ReportsPage() {
  const [exporting, setExporting] = useState(false);

  const exportInventory = async () => {
    setExporting(true);
    try {
      const res = await api.items({ page: 1, pageSize: 5000 });
      const rows = res.data.map((item) => ({
        "Kode Barang": item.kode,
        "Nama Barang": item.nama,
        Satuan: item.satuan,
        "Buffer Stock": item.buffer_stock,
        Keterangan: item.keterangan,
        "Stock Tersedia": item.stock_tersedia,
        "Total Stock In": item.stock_in,
        "Total Stock Out": item.stock_out,
        "Stock Fisik (Opname Terakhir)": item.stock_fisik,
        "Selisih (Opname Terakhir)": item.selisih_stock,
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inventory");
      XLSX.writeFile(wb, `inventory-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const exportTransactions = async () => {
    setExporting(true);
    try {
      const rows = await api.transactions(1000);
      const data = rows.map((t) => ({
        Waktu: t.created_at,
        Kode: t.kode,
        "Nama Barang": t.nama,
        Tujuan: t.tujuan,
        Tipe: t.type,
        Jumlah: t.qty,
        Catatan: t.note || "",
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transaksi");
      XLSX.writeFile(wb, `transaksi-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const exportStockIn = async () => {
    setExporting(true);
    try {
      const res = await api.stockIn({ page: 1, pageSize: 5000 });
      const data = res.data.map((r) => ({
        "Tgl Terima": r.tanggal_terima,
        Kode: r.kode,
        "Nama Barang": r.nama,
        Vendor: r.nama_vendor,
        "PO/PR": r.po_in_akss || r.no_pr,
        Qty: r.qty,
        Satuan: r.satuan,
        Tujuan: r.tujuan || "",
        Keterangan: r.keterangan,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock In");
      XLSX.writeFile(wb, `stock-in-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const exportStockOut = async () => {
    setExporting(true);
    try {
      const res = await api.stockOut({ page: 1, pageSize: 5000 });
      const data = res.data.map((r) => ({
        "Tgl Keluar": r.tanggal_keluar,
        Kode: r.kode,
        "Nama Barang": r.nama,
        Penerima: r.penerima,
        Qty: r.qty,
        Satuan: r.satuan,
        Tujuan: r.tujuan || "",
        Keterangan: r.keterangan,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock Out");
      XLSX.writeFile(wb, `stock-out-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Laporan</h1>
        <p className="text-sm text-[var(--text-secondary)]">Export data inventory & transaksi ke Excel</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
          <h2 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Laporan Inventory</h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Seluruh data barang beserta total stock in/out dan hasil opname terakhir.
          </p>
          <button
            onClick={exportInventory}
            disabled={exporting}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50"
          >
            <FileDown size={16} /> Export Excel
          </button>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
          <h2 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Laporan Transaksi Manual</h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">Transaksi yang diinput lewat dashboard (1000 terakhir).</p>
          <button
            onClick={exportTransactions}
            disabled={exporting}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50"
          >
            <FileDown size={16} /> Export Excel
          </button>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
          <h2 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Laporan Stock In</h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">Riwayat penerimaan barang dari vendor (histori lengkap).</p>
          <button
            onClick={exportStockIn}
            disabled={exporting}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50"
          >
            <FileDown size={16} /> Export Excel
          </button>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5">
          <h2 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Laporan Stock Out</h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">Riwayat pengeluaran barang ke karyawan/estate (histori lengkap).</p>
          <button
            onClick={exportStockOut}
            disabled={exporting}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50"
          >
            <FileDown size={16} /> Export Excel
          </button>
        </div>
      </div>
    </div>
  );
}
