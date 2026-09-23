import { Outlet } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";

export function MainLayout() {
  return (
    <div className="flex min-h-screen bg-[var(--bg-page)]">
      <Sidebar />
      <main className="flex-1 min-w-0 p-6">
        <Outlet />
      </main>
    </div>
  );
}
