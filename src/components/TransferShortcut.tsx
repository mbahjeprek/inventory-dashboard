import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import type { OpnameModule } from "../lib/api";
import { ESTATE_TUJUAN } from "../lib/kirim";
import { CreatePinjamanModal } from "../pages/PinjamanPage";

// Under Stock Out: when the goods go to another estate (not used here), book it there instead - as a
// Pinjaman (the same form as Catat Pinjaman: lent until given back) or a Transfer (the same form as
// Catat Transfer: the receiving estate's stock goes up at once, no Stock In typed there).
export function TransferShortcut({
  module,
  dari,
  kode,
  qty,
  note,
  onDone,
}: {
  module: OpnameModule;
  dari: string;
  kode: string;
  qty?: number;
  note?: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<"PINJAM" | "TRANSFER" | null>(null);
  const btnCls =
    "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-[var(--accent-blue-border)] bg-white text-[var(--accent-blue)] hover:opacity-90";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] px-3 py-2">
        <span className="text-[11px] text-[var(--text-secondary)]">Keluar ke estate lain (bukan dipakai di {dari})?</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setOpen("PINJAM")} className={btnCls}>
            <Plus size={13} /> Catat Pinjaman
          </button>
          <button type="button" onClick={() => setOpen("TRANSFER")} className={btnCls}>
            <ArrowRight size={13} /> Catat Transfer
          </button>
        </div>
      </div>
      {open && (
        <CreatePinjamanModal
          jenis={open}
          modules={[module]}
          myEstates={[dari]}
          initial={{ module, dari, kode, qty: qty && qty > 0 ? qty : undefined, note }}
          onClose={() => setOpen(null)}
          onSuccess={() => {
            setOpen(null);
            onDone();
          }}
        />
      )}
    </>
  );
}

// Tujuan of Nilam's Stock Out (see lib/kirim.ts).

export function KirimTujuan({ dari, value, onChange }: { dari: string; value: string; onChange: (ke: string) => void }) {
  return (
    <div>
      <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tujuan</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white">
        <option value="">Dipakai di {dari}</option>
        {ESTATE_TUJUAN.filter((e) => e !== dari).map((e) => (
          <option key={e} value={e}>
            Kirim ke stok {e}
          </option>
        ))}
      </select>
      {value && (
        <p className="text-[11px] text-[var(--accent-blue)] mt-1">
          Jumlah ini otomatis tercatat sebagai Stock In di {value} (Transfer) - {value} tidak perlu input Stock In lagi.
        </p>
      )}
    </div>
  );
}
