import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Package, Fuel, Sprout } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import plantationAerial from "../assets/plantation-aerial.jpg";
import plantationFruit from "../assets/plantation-fruit.jpg";

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
      <img src={plantationAerial} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40" />

      <div className="relative z-10 min-h-screen flex flex-col lg:flex-row lg:items-center gap-10 p-6 sm:p-10 lg:p-16">
        <div className="flex-1 text-white space-y-5 lg:max-w-lg pt-4 lg:pt-0">
          <div className="flex items-center gap-3">
            <img src="/logo-agro.png" alt="Agro" className="w-10 h-10 object-contain drop-shadow" />
            <div>
              <div className="font-semibold text-lg leading-tight">Management Inventory Agro</div>
              <div className="text-xs text-white/70 leading-tight">Perkebunan Kelapa Sawit</div>
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold leading-snug drop-shadow-sm">
            Selamat Datang di Sistem Inventory Perkebunan Sawit
          </h1>
          <p className="text-sm text-white/80 leading-relaxed max-w-md">
            Pantau stok gudang, BBM, dan aktivitas operasional setiap estate — Nilam, KNS, WJA, Zamrud, dan
            Firus — dalam satu sistem yang terintegrasi dan rapi.
          </p>

          <div className="hidden sm:flex items-center gap-4 pt-2">
            <img
              src={plantationFruit}
              alt="Buah kelapa sawit"
              className="w-28 h-20 object-cover rounded-lg border-2 border-white/25 shadow-xl"
            />
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-white/10 rounded-lg p-2.5 backdrop-blur-sm">
                <Package size={16} className="text-[#a7e8c4] mb-1" />
                <div className="text-[11px] text-white/85 leading-tight">Inventory Gudang</div>
              </div>
              <div className="bg-white/10 rounded-lg p-2.5 backdrop-blur-sm">
                <Fuel size={16} className="text-[#a7e8c4] mb-1" />
                <div className="text-[11px] text-white/85 leading-tight">Inventory BBM</div>
              </div>
              <div className="bg-white/10 rounded-lg p-2.5 backdrop-blur-sm">
                <Sprout size={16} className="text-[#a7e8c4] mb-1" />
                <div className="text-[11px] text-white/85 leading-tight">Multi Estate</div>
              </div>
            </div>
          </div>

          <p className="hidden lg:block text-xs text-white/40 pt-6">© {new Date().getFullYear()} Agro Barokah</p>
        </div>

        <div className="w-full lg:w-auto flex justify-center lg:justify-end lg:pr-4">
          <form
            onSubmit={submit}
            className="bg-white/97 backdrop-blur-md rounded-xl w-full max-w-sm shadow-2xl p-6 space-y-4"
          >
            <div className="flex flex-col items-center gap-1.5 mb-2">
              <h2 className="font-semibold text-base text-[var(--text-primary)]">Inventory Agro Barokah</h2>
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
    </div>
  );
}
