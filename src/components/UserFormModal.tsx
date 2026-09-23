import { useState } from "react";
import { X } from "lucide-react";
import { api, type UserAccount } from "../lib/api";

export function UserFormModal({
  user,
  onClose,
  onSuccess,
}: {
  user: UserAccount | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username ?? "");
  const [nama, setNama] = useState(user?.nama ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!username.trim() || !nama.trim() || (!isEdit && !password)) {
      setError("Username, nama, dan password wajib diisi");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (isEdit) {
        await api.updateUser(user.id, { username: username.trim(), nama: nama.trim(), password: password || undefined });
      } else {
        await api.createUser({ username: username.trim(), nama: nama.trim(), password });
      }
      onSuccess();
    } catch (e: any) {
      setError(e?.message?.includes("409") ? "Username sudah digunakan" : "Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {isEdit ? "Edit Akun Pengguna" : "Tambah Akun Pengguna"}
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Nama Lengkap</label>
            <input
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">
              Password{isEdit ? " (kosongkan kalau tidak ganti)" : ""}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
