import { useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Pencil, Trash2 } from "lucide-react";
import { api, type Transaction } from "../lib/api";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { ConfirmDialog } from "../components/ConfirmDialog";

export function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Transaction | null>(null);

  const load = () => {
    setLoading(true);
    api.transactions(200).then((t) => {
      setTransactions(t);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (t: Transaction) => {
    await api.deleteTransaction(t.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Riwayat Transaksi</h1>
        <p className="text-sm text-[var(--text-secondary)]">Stock in / stock out yang diinput manual lewat dashboard</p>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5">Waktu</th>
                <th className="px-4 py-2.5">Kode</th>
                <th className="px-4 py-2.5">Nama Barang</th>
                <th className="px-4 py-2.5">Tujuan</th>
                <th className="px-4 py-2.5">Tipe</th>
                <th className="px-4 py-2.5 text-right">Jumlah</th>
                <th className="px-4 py-2.5">Penerima</th>
                <th className="px-4 py-2.5">Catatan</th>
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Belum ada transaksi
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                      {new Date(t.created_at).toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{t.kode}</td>
                    <td className="px-4 py-2.5">{t.nama}</td>
                    <td className="px-4 py-2.5">{t.tujuan || <span className="text-[var(--text-muted)]">-</span>}</td>
                    <td className="px-4 py-2.5">
                      {t.type === "IN" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-green)]">
                          <ArrowDownCircle size={14} /> Masuk
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-red)]">
                          <ArrowUpCircle size={14} /> Keluar
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">{t.qty}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{t.penerima || "-"}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{t.note || "-"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => setEditing(t)}
                          title="Edit"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(t)}
                          title="Hapus"
                          className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
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
      </div>

      {editing && (
        <EditTransactionModal
          transaction={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus transaksi ${confirmDelete.kode} - ${confirmDelete.nama} (${confirmDelete.qty})? Tindakan ini tidak bisa dibatalkan.`}
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
