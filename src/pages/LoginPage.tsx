import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Boxes } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (status === "authed") {
    const redirectTo = (location.state as { from?: string } | null)?.from || "/";
    return <Navigate to={redirectTo} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Username dan password wajib diisi");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await login(username.trim(), password);
    } catch {
      setError("Username atau password salah");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-page)] p-4">
      <form onSubmit={submit} className="bg-white rounded-lg w-full max-w-sm shadow-xl p-6 space-y-4">
        <div className="flex flex-col items-center gap-2 mb-2">
          <Boxes size={32} className="text-[var(--accent-blue)]" />
          <h1 className="font-semibold text-base text-[var(--text-primary)]">Inventory Agro Barokah</h1>
          <p className="text-xs text-[var(--text-secondary)]">Masuk untuk melanjutkan</p>
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Username</label>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
          />
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
          />
        </div>

        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Masuk..." : "Masuk"}
        </button>
      </form>
    </div>
  );
}
