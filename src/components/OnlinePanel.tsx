import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { estateOfPath, moduleOfPath } from "../lib/access";

type Row = Awaited<ReturnType<typeof api.userOnline>>[number];
const MODUL: Record<string, string> = { GUDANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk", OLI: "Oli", KLINIK: "Klinik" };
const HALAMAN: Record<string, string> = {
  "/": "Dashboard",
  "/koperasi": "Koperasi",
  "/kendaraan": "Kendaraan & Alat Berat",
  "/stok-opname": "Stok Opname",
  "/pinjaman": "Pinjaman & Transfer",
  "/dokumen": "Dokumen & Link",
  "/log-user": "Log Aktivitas User",
  "/users": "Pengguna",
  "/master-barang": "Master Barang",
  "/master-obat": "Master Obat",
  "/master-pasien": "Master Pasien",
  "/alat-berat": "Master Alat Berat",
  "/peta-blok": "Peta Blok",
  "/karyawan": "Master Karyawan",
  "/master-blok": "Master Blok",
  "/master-oli": "Master Oli",
  "/master-pupuk": "Master Pupuk",
  "/laporan-klinik": "Laporan Klinik",
  "/semua-estate": "Semua Estate",
  "/stock-in": "Stock In",
  "/stock-out": "Stock Out",
};
const TAB: Record<string, string> = { in: "Stock In", out: "Stock Out", rusak: "Expired & Rusak", laporan: "Laporan Harian" };
// "/inventory-klinik-zamrud?tab=laporan" -> "Klinik ZAMRUD · Laporan Harian".
export function halamanLabel(page: string | null) {
  if (!page) return "-";
  const [path, qs] = page.split("?");
  const tab = new URLSearchParams(qs ?? "").get("tab");
  const m = moduleOfPath(path);
  const base = m ? `${MODUL[m]} ${estateOfPath(path) ?? ""}`.trim() : (HALAMAN[path] ?? HALAMAN[`/${path.split("/")[1]}`] ?? path);
  return tab && TAB[tab] ? `${base} · ${TAB[tab]}` : base;
}
const lalu = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "baru saja" : `${m} menit lalu`;
};

// Log Aktivitas User: who is on the app now (seen in the last 5 minutes) and who left in the last 30,
// with the page they are on; refreshed every 30 seconds.
export function OnlinePanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const load = () =>
      api
        .userOnline()
        .then(setRows)
        .catch(() => setRows([]));
    load();
    const t = setInterval(() => (load(), setTick((n) => n + 1)), 30_000);
    return () => clearInterval(t);
  }, []);
  const online = (rows ?? []).filter((r) => r.online);
  const baru = (rows ?? []).filter((r) => !r.online);
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent-green)] opacity-60 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent-green)]" />
        </span>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Sedang online ({online.length})</h2>
        <span className="text-xs text-[var(--text-muted)]">aktif dalam 5 menit terakhir · diperbarui tiap 30 detik</span>
      </div>
      {rows === null ? (
        <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
      ) : (
        <div className="p-3 space-y-3">
          {!online.length ? (
            <p className="text-sm text-[var(--text-muted)] px-1">Tidak ada yang online saat ini.</p>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {online.map((r) => (
                <div key={r.id} className="flex items-start gap-2.5 rounded-md border border-[var(--accent-green-border)] bg-[var(--accent-green-bg)] px-3 py-2">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--accent-green)] flex-none" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {r.nama || r.username} <span className="text-xs font-normal text-[var(--text-muted)]">@{r.username}</span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] truncate">di {halamanLabel(r.last_page)}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {lalu(r.last_seen_at)} · {r.role === "superuser" ? "Super User" : (r.estates ?? "").split(",").filter(Boolean).join(", ")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {baru.length > 0 && (
            <div className="text-xs text-[var(--text-muted)] px-1">
              Baru keluar (30 menit terakhir):{" "}
              {baru.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && " · "}
                  <span className="text-[var(--text-secondary)]">{r.nama || r.username}</span> ({lalu(r.last_seen_at)}, {halamanLabel(r.last_page)})
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
