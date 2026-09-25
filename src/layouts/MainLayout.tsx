import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { PinjamanBanner } from "../components/PinjamanBanner";
import { useOpenPinjaman } from "../hooks/useOpenPinjaman";

export function MainLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const refreshPinjaman = useOpenPinjaman((s) => s.refresh);

  // Close the phone drawer once a menu item has navigated somewhere; open loans are re-read so the
  // warnings follow a loan made or returned a moment ago.
  useEffect(() => {
    setMobileOpen(false);
    refreshPinjaman();
  }, [location.pathname, refreshPinjaman]);

  return (
    <div className="flex min-h-screen bg-[var(--bg-page)]">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-[var(--bg-sidebar)] text-white shadow">
          <button onClick={() => setMobileOpen(true)} title="Buka menu" className="p-1.5 -ml-1.5 rounded-md hover:bg-white/10">
            <Menu size={20} />
          </button>
          <img src="/logo-agro.png" alt="Agro" className="w-6 h-6 object-contain" />
          <span className="font-semibold text-sm">Management Inventory Agro</span>
        </header>

        <main className="flex-1 min-w-0 p-4 md:p-6">
          <PinjamanBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
