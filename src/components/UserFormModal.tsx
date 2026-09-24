import { useState } from "react";
import { X } from "lucide-react";
import { api, ESTATES, type UserAccount, type Role, type Estate } from "../lib/api";
import { MODULES, MODULE_LABELS, type Module } from "../lib/access";
import { PasswordInput } from "./PasswordInput";

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
  const [role, setRole] = useState<Role>(user?.role ?? "superuser");
  const [estate, setEstate] = useState<Estate>(user?.estate ?? ESTATES[0]);
  // Modules an estate account may open; all ticked = no limit (stored as null).
  const [modules, setModules] = useState<Module[]>(() => {
    const saved = (user?.modules ?? "").split(",").filter((m): m is Module => (MODULES as readonly string[]).includes(m));
    return saved.length ? saved : [...MODULES];
  });
  const toggleModule = (m: Module) => setModules((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!username.trim() || !nama.trim() || (!isEdit && !password)) {
      setError("Username, nama, dan password wajib diisi");
      return;
    }
    if (role === "estate" && modules.length === 0) {
      setError("Pilih minimal satu modul");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        username: username.trim(),
        nama: nama.trim(),
        role,
        estate: role === "estate" ? estate : null,
        modules: role === "estate" ? modules : undefined,
      };
      if (isEdit) {
        await api.updateUser(user.id, { ...payload, password: password || undefined });
      } else {
        await api.createUser({ ...payload, password });
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
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Akses</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              >
                <option value="superuser">Super User (semua akses)</option>
                <option value="estate">Estate (satu gudang saja)</option>
              </select>
            </div>
            {role === "estate" && (
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Estate</label>
                <select
                  value={estate}
                  onChange={(e) => setEstate(e.target.value as Estate)}
                  className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
                >
                  {ESTATES.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {role === "estate" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Modul yang bisa diakses</label>
              <div className="flex flex-wrap gap-2">
                {MODULES.map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md border border-[var(--border)] cursor-pointer">
                    <input type="checkbox" checked={modules.includes(m)} onChange={() => toggleModule(m)} />
                    {MODULE_LABELS[m]}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Contoh: admin entry data Gudang/BBM/Pupuk, atau admin Klinik saja.</p>
            </div>
          )}

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
