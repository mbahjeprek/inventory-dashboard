import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { errorText } from "../lib/api";

// The session ran out while a page was open (api.ts fires "session-expired" on a 401): log in again
// right here, over the page, so a form being filled in keeps what was typed - then press Simpan again.
export function SessionExpiredModal() {
  const { user, login } = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onExpired = () => {
      setUsername((u) => u || user?.username || "");
      setOpen(true);
    };
    window.addEventListener("session-expired", onExpired);
    return () => window.removeEventListener("session-expired", onExpired);
  }, [user?.username]);

  if (!open) return null;

  const submit = async () => {
    setError("");
    if (!username.trim() || !password) return setError("Username dan password wajib diisi");
    setBusy(true);
    try {
      await login(username.trim(), password);
      setPassword("");
      setOpen(false);
    } catch (e) {
      setError(errorText(e, "Gagal login"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="bg-white rounded-lg w-full max-w-sm shadow-xl p-5 space-y-3"
      >
        <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          <LogIn size={18} className="text-[var(--accent-blue)]" /> Sesi login habis
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Login lagi untuk melanjutkan. Halaman dan isian form di belakang tidak hilang - setelah login, tekan Simpan lagi.
        </p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
        />
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <button type="submit" disabled={busy} className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Masuk..." : "Login"}
        </button>
      </form>
    </div>
  );
}
