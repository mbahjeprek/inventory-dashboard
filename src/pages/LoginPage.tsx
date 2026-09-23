import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import plantationWelcome from "../assets/plantation-welcome.jpg";

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
    } catch (e: any) {
      setError(e?.message?.includes("401") ? "Username atau password salah" : "Gagal terhubung ke server, coba lagi");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0f2a1c]">
      <img src={plantationWelcome} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-l from-black/80 via-black/40 to-black/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40" />

      <div className="relative z-10 min-h-screen flex flex-col lg:flex-row lg:items-center gap-10 p-6 sm:p-10 lg:px-20 lg:py-16">
        <div className="w-full lg:w-auto flex justify-center lg:justify-start">
          <form
            onSubmit={submit}
            className="bg-white/97 backdrop-blur-md rounded-2xl w-full max-w-md shadow-2xl p-8 sm:p-10 space-y-5"
          >
            <div className="flex flex-col items-center gap-2 mb-4">
              <img src="/logo-agro.png" alt="Agro" className="w-14 h-14 object-contain" />
              <h2 className="font-semibold text-xl text-[var(--text-primary)]">Inventory Agro Barokah</h2>
              <p className="text-sm text-[var(--text-secondary)]">Masuk untuk melanjutkan</p>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text-secondary)] mb-1.5 block">Username</label>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full text-sm rounded-lg border border-[var(--border)] px-3.5 py-3"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text-secondary)] mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full text-sm rounded-lg border border-[var(--border)] px-3.5 py-3"
              />
            </div>

            {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-lg text-sm font-semibold bg-[var(--accent-blue)] text-white shadow-md hover:opacity-90 disabled:opacity-50 transition"
            >
              {submitting ? "Masuk..." : "Masuk"}
            </button>
          </form>
        </div>

        <div className="order-first lg:order-none flex-1 flex flex-col items-center text-center lg:items-end lg:text-right text-white space-y-5 pt-4 lg:pt-0">
          <div className="flex items-center gap-3 lg:flex-row-reverse">
            <img src="/logo-agro.png" alt="Agro" className="w-10 h-10 object-contain drop-shadow" />
            <div>
              <div className="font-semibold text-lg leading-tight">Management Inventory Agro</div>
              <div className="text-xs text-white/70 leading-tight">Perkebunan Kelapa Sawit</div>
            </div>
          </div>

          <div className="w-16 h-1 rounded-full bg-[#a7e8c4]" />

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight drop-shadow-md lg:max-w-xl">
            Selamat Datang di Managemen Inventory Barokah Agro Perkasa
          </h1>

          <p className="hidden lg:block text-xs text-white/50 pt-6">© {new Date().getFullYear()} Agro Barokah</p>
        </div>
      </div>
    </div>
  );
}
