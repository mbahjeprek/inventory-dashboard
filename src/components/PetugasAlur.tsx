import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { api } from "../lib/api";

// Who does each step of a Barang Rusak / Expired flow, read from the accounts' ticks in Pengguna: the people of
// the unit (petugas langsung) and the Super Users who may stand in (pengganti). A step nobody may do says so.
export type Petugas = { input: string[]; approve: string[]; ba: string[]; pengganti: string[] };
export function usePetugas(modul: "KOPERASI" | "KLINIK", unit: string) {
  const [p, setP] = useState<Petugas | null>(null);
  useEffect(() => {
    api
      .petugas(modul, unit)
      .then(setP)
      .catch(() => setP(null));
  }, [modul, unit]);
  return p;
}

export function PetugasBaris({ judul, nama, pengganti, kosong }: { judul: string; nama: string[]; pengganti: string[]; kosong: string }) {
  return (
    <div className="mt-1.5 pt-1.5 border-t border-dashed border-[var(--border)] text-[11px] leading-snug">
      <div className="flex items-start gap-1">
        <UserRound size={12} className="mt-px shrink-0 text-[var(--text-muted)]" />
        <span>
          <span className="text-[var(--text-muted)]">{judul}: </span>
          {nama.length ? <b className="font-medium text-[var(--text-primary)]">{nama.join(", ")}</b> : <span className="text-[var(--accent-red)]">{kosong}</span>}
        </span>
      </div>
      {pengganti.length > 0 && (
        <div className="ml-4 text-[var(--text-muted)]">
          Pengganti: {pengganti.join(", ")} <span className="italic">(Super User)</span>
        </div>
      )}
    </div>
  );
}
