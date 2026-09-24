import { useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { PasswordInput } from "./PasswordInput";

// Any logged-in user changes their own password (needs the current one).
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError("");
    if (!current || !next) return setError("Password lama dan baru wajib diisi");
    if (next.length < 6) return setError("Password baru minimal 6 karakter");
    if (next !== confirm) return setError("Konfirmasi password baru tidak sama");
    setSubmitting(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (e: any) {
      setError(e?.message?.includes("400") ? "Password lama salah" : "Gagal mengganti password");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">Ganti Password</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="p-5 space-y-4">
            <p className="text-sm text-[var(--accent-green)]">Password berhasil diganti. Pakai password baru saat login berikutnya.</p>
            <button onClick={onClose} className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90">
              Tutup
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Password Lama</label>
              <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Password Baru</label>
              <PasswordInput value={next} onChange={setNext} autoComplete="new-password" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Ulangi Password Baru</label>
              <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" className={inputCls} />
            </div>

            {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Menyimpan..." : "Simpan Password"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
