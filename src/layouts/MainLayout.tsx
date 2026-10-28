import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { PinjamanBanner, PinjamanNotif } from "../components/PinjamanBanner";
import { SessionExpiredModal } from "../components/SessionExpiredModal";
import { useOpenPinjaman } from "../hooks/useOpenPinjaman";
import { useTableDragScroll } from "../hooks/useDragScroll";
import { StatusUpdateBanner, useStatusUpdate } from "../components/StatusUpdate";
import { useAuth } from "../context/AuthContext";
import { ChatWidget } from "../components/ChatWidget";
import { PersetujuanReminder } from "../components/PersetujuanReminder";
import { usePersetujuan } from "../hooks/usePersetujuan";

export function MainLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const refreshPinjaman = useOpenPinjaman((s) => s.refresh);
  const refreshStatus = useStatusUpdate((s) => s.refresh);
  const refreshPersetujuan = usePersetujuan((s) => s.refresh);
  const { refresh: refreshUser } = useAuth();
  // Every list table can be dragged with the mouse, up / down and sideways.
  useTableDragScroll();


  // Close the phone drawer once a menu item has navigated somewhere; open loans are re-read so the
  // warnings follow a loan made or returned a moment ago.
  useEffect(() => {
    setMobileOpen(false);
    refreshPinjaman();
    refreshStatus();
    refreshUser();
    refreshPersetujuan();
  }, [location.pathname, refreshPinjaman, refreshStatus, refreshUser, refreshPersetujuan]);

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
          <StatusUpdateBanner />
          <PinjamanBanner />
          <Suspense fallback={<div className="py-10 text-center text-sm text-[var(--text-muted)]">Memuat...</div>}>
            <Outlet />
          </Suspense>
        </main>
        <PinjamanNotif />
        {/* Chat (its unread check every 20 s also keeps the account "online" while a tab is open). */}
        <ChatWidget />
        <SessionExpiredModal />
        <PersetujuanReminder />
      </div>
    </div>
  );
}
