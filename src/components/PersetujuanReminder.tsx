import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Signature, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { usePersetujuan } from "../hooks/usePersetujuan";
import { PERSETUJUAN_PATH, pageAllowed } from "../lib/access";

// After login: when documents wait for this account's signature, a reminder with what they are and a button to
// Persetujuan. Shown once per session (closing it keeps the sidebar badge).
const KEY = "persetujuan-reminder";
export function PersetujuanReminder() {
  const { user } = useAuth();
  const jumlah = usePersetujuan((s) => s.jumlah);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [buka, setBuka] = useState(false);

  useEffect(() => {
    if (!user || !jumlah?.total || pathname === PERSETUJUAN_PATH || !pageAllowed(user, PERSETUJUAN_PATH)) return;
    let sudah = false;
    try {
      sudah = sessionStorage.getItem(`${KEY}-${user.id}`) === "1";
      sessionStorage.setItem(`${KEY}-${user.id}`, "1");
    } catch {
      // without storage it shows once per page load
    }
    if (!sudah) setBuka(true);
  }, [user, jumlah, pathname]);

  if (!buka || !jumlah?.total) return null;
  const baris = [
    jumlah.ba > 0 && `${jumlah.ba} Berita Acara Pemusnahan menunggu persetujuan Anda`,
    jumlah.permintaan > 0 && `${jumlah.permintaan} Permintaan Obat menunggu tanda tangan Anda`,
    !!jumlah.kop && `${jumlah.kop} Permintaan Barang Koperasi menunggu persetujuan Anda`,
  ].filter(Boolean) as string[];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setBuka(false)}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border)]">
          <span className="w-9 h-9 shrink-0 rounded-full bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] flex items-center justify-center">
            <Signature size={18} />
          </span>
          <div className="flex-1">
            <h3 className="font-semibold text-[var(--text-primary)]">Menunggu persetujuan Anda</h3>
            <p className="text-xs text-[var(--text-muted)]">{jumlah.total} dokumen perlu ditandatangani / disetujui</p>
          </div>
          <button onClick={() => setBuka(false)} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <ul className="px-5 py-3 space-y-1.5 text-sm text-[var(--text-primary)]">
          {baris.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]" />
              {b}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button onClick={() => setBuka(false)} className="text-sm px-3.5 py-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
            Nanti
          </button>
          <button
            onClick={() => (setBuka(false), navigate(PERSETUJUAN_PATH))}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
          >
            <Signature size={15} /> Buka Persetujuan
          </button>
        </div>
      </div>
    </div>
  );
}
