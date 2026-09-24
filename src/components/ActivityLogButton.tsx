import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { ActivityLogPage } from "../pages/ActivityLogPage";

// "Log" button for an inventory page: opens that page's own activity history (module + gudang/lokasi)
// in a large dialog, so the history sits next to the data instead of in a separate menu.
export function ActivityLogButton({ module, estate }: { module: "BARANG" | "BBM" | "PUPUK"; estate: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[#f1f5f9]"
      >
        <History size={16} /> Log
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-6xl max-h-full overflow-y-auto rounded-lg bg-[var(--bg-page)] shadow-2xl p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <ActivityLogPage module={module} estateLock={estate} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
