import { useState } from "react";
import { X } from "lucide-react";
import { api, ESTATES, type UserAccount, type Role } from "../lib/api";
import { ACTIONS, MODULES, MODULE_ACTIONS, MODULE_LABELS, OTHER_PERMS, PERM_TEMPLATES, modulePerm, type Action, type Module } from "../lib/access";
import { PasswordInput } from "./PasswordInput";
import { useAuth } from "../context/AuthContext";

// Add / edit a login account. A superuser gets everything; an estate account gets the estates and
// permissions ticked here (server/src/app.ts enforces them on every request).
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
  // Only a superuser can make or change Super User accounts (enforced in app.ts too).
  const { user: me } = useAuth();
  const meSuper = me?.role === "superuser";
  const [username, setUsername] = useState(user?.username ?? "");
  const [nama, setNama] = useState(user?.nama ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "estate");
  const [estates, setEstates] = useState<string[]>((user?.estates ?? "").split(",").filter(Boolean));
  const [perms, setPerms] = useState<string[]>((user?.perms ?? "").split(",").filter(Boolean));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggleEstate = (e: string) => setEstates((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  // Input/Edit/Hapus/Koreksi only make sense with Lihat: ticking one ticks Lihat, unticking Lihat
  // clears the module.
  const toggleModule = (m: Module, a: Action) =>
    setPerms((cur) => {
      const key = modulePerm(m, a);
      const view = modulePerm(m, "view");
      if (cur.includes(key)) return a === "view" ? cur.filter((p) => !p.startsWith(`${m.toLowerCase()}.`)) : cur.filter((p) => p !== key);
      return [...new Set([...cur, key, view])];
    });
  const toggleRow = (m: Module) =>
    setPerms((cur) => {
      const all = MODULE_ACTIONS[m].map((a) => modulePerm(m, a));
      return all.every((p) => cur.includes(p)) ? cur.filter((p) => !all.includes(p)) : [...new Set([...cur, ...all])];
    });
  const togglePerm = (key: string) => setPerms((cur) => (cur.includes(key) ? cur.filter((p) => p !== key) : [...cur, key]));

  const submit = async () => {
    if (!username.trim() || !nama.trim() || (!isEdit && !password)) {
      setError("Username, nama, dan password wajib diisi");
      return;
    }
    if (role === "estate" && estates.length === 0) {
      setError("Pilih minimal satu estate");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        username: username.trim(),
        nama: nama.trim(),
        role,
        estates: role === "estate" ? estates : undefined,
        perms: role === "estate" ? perms : undefined,
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

  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";
  const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
  const sectionCls = "text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">{isEdit ? "Edit Akun Pengguna" : "Tambah Akun Pengguna"}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nama Lengkap</label>
              <input value={nama} onChange={(e) => setNama(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Password{isEdit ? " (kosongkan kalau tidak ganti)" : ""}</label>
              <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" className={inputCls} />
            </div>
          </div>

          <div>
            <div className={sectionCls}>Jenis akun</div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["estate", "Akses sesuai centang"],
                  ["superuser", "Super User (semua akses)"],
                ] as [Role, string][]
              )
                .filter(([r]) => meSuper || r !== "superuser")
                .map(([r, label]) => (
                <label
                  key={r}
                  className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md border cursor-pointer ${
                    role === r ? "border-[var(--accent-blue)] bg-[var(--accent-blue-bg)]" : "border-[var(--border)]"
                  }`}
                >
                  <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {role === "estate" && (
            <>
              <div>
                <div className={sectionCls}>Estate yang bisa diakses</div>
                <div className="flex flex-wrap gap-2">
                  {ESTATES.map((e) => (
                    <label key={e} className="flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md border border-[var(--border)] cursor-pointer">
                      <input type="checkbox" checked={estates.includes(e)} onChange={() => toggleEstate(e)} />
                      {e}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className={`${sectionCls} mb-0`}>Hak akses modul</div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] text-[var(--text-muted)] self-center">Template:</span>
                    {PERM_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => setPerms((cur) => [...cur.filter((p) => !MODULES.some((m) => p.startsWith(`${m.toLowerCase()}.`))), ...t.perms])}
                        className="text-[11px] px-2 py-1 rounded border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto border border-[var(--border)] rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#f8fafc] text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                        <th className="text-left px-3 py-2 font-medium">Modul</th>
                        {ACTIONS.map((a) => (
                          <th key={a.key} className="px-2 py-2 font-medium text-center">
                            {a.label}
                          </th>
                        ))}
                        <th className="px-2 py-2 font-medium text-center">Semua</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {MODULES.map((m) => (
                        <tr key={m}>
                          <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{MODULE_LABELS[m]}</td>
                          {ACTIONS.map((a) => (
                            <td key={a.key} className="px-2 py-2 text-center">
                              {MODULE_ACTIONS[m].includes(a.key) ? (
                                <input
                                  type="checkbox"
                                  aria-label={`${MODULE_LABELS[m]} ${a.label}`}
                                  checked={perms.includes(modulePerm(m, a.key))}
                                  onChange={() => toggleModule(m, a.key)}
                                  className="w-4 h-4 cursor-pointer"
                                />
                              ) : (
                                <span className="text-[var(--text-muted)]">-</span>
                              )}
                            </td>
                          ))}
                          <td className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${MODULE_LABELS[m]} semua`}
                              checked={MODULE_ACTIONS[m].every((a) => perms.includes(modulePerm(m, a)))}
                              onChange={() => toggleRow(m)}
                              className="w-4 h-4 cursor-pointer"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                  Lihat = buka halaman & data · Input = stok masuk/keluar & tambah data · Edit / Hapus = ubah atau hapus data & transaksi · Koreksi =
                  koreksi stok satu barang · Opname = buat & isi hitungan Stok Opname · Approve Opname = setujui / kembalikan Stok Opname
                  (stok baru berubah setelah disetujui)
                </p>
              </div>

              {OTHER_PERMS.map((g) => (
                <div key={g.group}>
                  <div className={sectionCls}>{g.group}</div>
                  <div className="flex flex-wrap gap-2">
                    {g.items.map((i) => (
                      <label key={i.key} className="flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md border border-[var(--border)] cursor-pointer">
                        <input type="checkbox" checked={perms.includes(i.key)} onChange={() => togglePerm(i.key)} />
                        {i.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)]">
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
