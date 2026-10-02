import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { OpnameModule } from "../lib/api";
import { CreatePinjamanModal } from "../pages/PinjamanPage";

// Under Stock Out: when the goods go into another estate's stock (not used here), book a Transfer
// instead - the receiving estate's stock goes up at once and it doesn't type a Stock In itself.
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] px-3 py-2">
        <span className="text-[11px] text-[var(--text-secondary)]">Dikirim ke stok estate lain (bukan dipakai di {dari})?</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-[var(--accent-blue-border)] bg-white text-[var(--accent-blue)] hover:opacity-90"
        >
          <ArrowRight size={13} /> Kirim ke estate lain
        </button>
      </div>
      {open && (
        <CreatePinjamanModal
          jenis="TRANSFER"
          modules={[module]}
          myEstates={[dari]}
          initial={{ module, dari, kode, qty: qty && qty > 0 ? qty : undefined, note }}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            onDone();
          }}
        />
      )}
    </>
  );
}
