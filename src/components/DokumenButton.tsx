import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FolderOpen } from "lucide-react";
import { api, type Dokumen } from "../lib/api";
import { jenisOf } from "../lib/dokumen";

// "Dokumen (n)" next to Log / Cetak on an inventory page: the links marked for this module and estate
// (plus the ones for every estate), each opening in a new tab, and a way to the full Dokumen & Link page.
export function DokumenButton({ modul, estate }: { modul: string; estate: string }) {
  const [rows, setRows] = useState<Dokumen[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stale = false;
    api
      .dokumen({ modul, estate })
      .then((r) => !stale && setRows(r.data))
      .catch(() => !stale && setRows([]));
    return () => {
      stale = true;
    };
  }, [modul, estate]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Spreadsheet, Docs dan file terkait"
        className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
      >
        <FolderOpen size={16} /> Dokumen{rows.length > 0 && <span className="ml-0.5 min-w-5 h-5 px-1.5 rounded-full bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] text-[11px] leading-5 text-center">{rows.length}</span>}
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] bg-white border border-[var(--border)] rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] border-b border-[var(--border)]">Dokumen & link {estate}</div>
          <div className="max-h-80 overflow-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[var(--text-muted)]">Belum ada link untuk menu ini.</p>
            ) : (
              rows.map((d) => {
                const j = jenisOf(d.url);
                const Icon = j.icon;
                return (
                  <a
                    key={d.id}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                    className="group flex items-center gap-2.5 px-3 py-2 hover:bg-[#f8fafc] border-b border-[var(--border)] last:border-0"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center" style={{ background: j.bg, color: j.color }}>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-[var(--text-primary)] truncate group-hover:text-[var(--accent-blue)]">{d.judul}</span>
                      <span className="block text-[11px] text-[var(--text-muted)] truncate">
                        {j.label}
                        {d.keterangan && ` · ${d.keterangan}`}
                      </span>
                    </span>
                    <ExternalLink size={13} className="shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100" />
                  </a>
                );
              })
            )}
          </div>
          <Link
            to={`/dokumen?modul=${encodeURIComponent(modul)}&estate=${encodeURIComponent(estate)}`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-xs text-center text-[var(--accent-blue)] bg-[#f8fafc] border-t border-[var(--border)] hover:underline"
          >
            Buka semua di Dokumen & Link
          </Link>
        </div>
      )}
    </div>
  );
}
