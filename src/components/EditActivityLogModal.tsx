import { useState } from "react";
import { X } from "lucide-react";
import { api, type ActivityLog } from "../lib/api";

// Superuser-only correction of a log entry's text. The stock data it describes is not changed.
export function EditActivityLogModal({
  log,
  objekLabel,
  onClose,
  onSuccess,
}: {
  log: ActivityLog;
  objekLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [aksi, setAksi] = useState(log.aksi);
  const [objek, setObjek] = useState(log.objek ?? "");
  const [detail, setDetail] = useState(log.detail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!aksi.trim()) {
      setError("Aksi tidak boleh kosong");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.updateActivityLog(log.id, { aksi, objek, detail });
      onSuccess();
    } catch {
      setError("Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Log Activity</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {new Date(log.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {log.nama || log.username || "-"}
              {log.estate ? ` · ${log.estate}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Aksi</label>
            <input
              value={aksi}
              onChange={(e) => setAksi(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">{objekLabel}</label>
            <input
              value={objek}
              onChange={(e) => setObjek(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Detail</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={4}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <p className="text-xs text-[var(--text-muted)]">Hanya mengubah catatan log, data stok tidak ikut berubah.</p>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}
