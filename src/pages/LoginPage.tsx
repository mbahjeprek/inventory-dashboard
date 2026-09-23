import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Package, Fuel, Sprout } from "lucide-react";
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
    } catch (e: any) {
      setError(e?.message?.includes("401") ? "Username atau password salah" : "Gagal terhubung ke server, coba lagi");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[var(--bg-page)]">
      {/* Welcome panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-[#0f3d2e] via-[#14532d] to-[#1e6b45] text-white flex-col justify-between p-12">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <img
          src="/logo-agro.png"
          alt=""
          className="absolute -right-24 -bottom-16 w-[420px] h-[420px] object-contain opacity-[0.12] pointer-events-none"
        />

        <div className="relative flex items-center gap-3">
          <img src="/logo-agro.png" alt="Agro" className="w-10 h-10 object-contain" />
          <div>
            <div className="font-semibold text-lg leading-tight">Management Inventory Agro</div>
            <div className="text-xs text-white/60 leading-tight">Perkebunan Kelapa Sawit</div>
          </div>
        </div>

        <div className="relative space-y-5 max-w-md">
          <h1 className="text-3xl font-semibold leading-snug">
            Selamat Datang di Sistem Inventory Perkebunan Sawit
          </h1>
          <p className="text-sm text-white/70 leading-relaxed">
            Pantau stok gudang, BBM, dan aktivitas operasional setiap estate — Nilam, KNS, WJA, Zamrud, dan
            Firus — dalam satu sistem yang terintegrasi dan rapi.
          </p>

          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
              <Package size={18} className="text-[#a7e8c4] mb-1.5" />
              <div className="text-xs text-white/80">Inventory Gudang</div>
            </div>
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
              <Fuel size={18} className="text-[#a7e8c4] mb-1.5" />
              <div className="text-xs text-white/80">Inventory BBM</div>
            </div>
            <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
              <Sprout size={18} className="text-[#a7e8c4] mb-1.5" />
              <div className="text-xs text-white/80">Multi Estate</div>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} Agro Barokah</p>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center p-4">
        <form onSubmit={submit} className="bg-white rounded-lg w-full max-w-sm shadow-xl p-6 space-y-4">
          <div className="flex flex-col items-center gap-2 mb-2">
            <img src="/logo-agro.png" alt="Agro" className="w-10 h-10 object-contain" />
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
    </div>
  );
}
