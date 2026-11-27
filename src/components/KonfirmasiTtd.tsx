import { AlertTriangle, Check } from "lucide-react";

import { namaSama } from "../lib/mewakili";

export { namaSama };

// The step between "Setujui & tandatangani" and the signature being saved (real case 2026-11-19: a BA was signed
// by the wrong account with one click). Names the box, who signs it and who the letter names, red when they differ.
export function KonfirmasiTtd({
  kotak,
  akun,
  namaDiSurat,
  akibat,
  busy,
  onYa,
  onBatal,
}: {
  kotak: string;
  akun: string;
  namaDiSurat?: string;
  akibat: string;
  busy: boolean;
  onYa: () => void;
  onBatal: () => void;
}) {
  const nama = (namaDiSurat ?? "").trim();
  const beda = !!nama && !namaSama(akun, nama);
  return (
    <div className={`w-full rounded-md border p-3 space-y-2 ${beda ? "border-[var(--accent-red)] bg-[var(--accent-red-bg)]" : "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)]"}`}>
      <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
        <AlertTriangle size={15} className={beda ? "text-[var(--accent-red)]" : "text-[var(--accent-amber)]"} /> Periksa dulu sebelum tanda tangan
      </p>
      <ul className="text-sm text-[var(--text-secondary)] space-y-0.5 list-disc pl-5">
        <li>
          Kotak: <b>{kotak}</b>
        </li>
        <li>
          Ditandatangani dengan akun: <b>{akun || "-"}</b>
        </li>
        {nama && (
          <li>
            Nama di surat: <b>{nama}</b>
          </li>
        )}
        <li>{akibat}</li>
      </ul>
      {beda && (
        <p className="text-sm font-medium text-[var(--accent-red)]">
          Nama akun Anda ({akun}) berbeda dengan nama di surat ({nama}). Kalau Anda menandatangani mewakili beliau, lanjutkan: kotak ini akan tertulis "for {nama}", ditandatangani {akun}. Kalau bukan, pilih Batal.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onBatal} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-white hover:bg-[var(--bg-page)] disabled:opacity-50">
          Batal
        </button>
        <button
          autoFocus={!beda}
          onClick={onYa}
          disabled={busy}
          className={`inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md text-white hover:opacity-90 disabled:opacity-50 ${beda ? "bg-[var(--accent-red)]" : "bg-[var(--accent-blue)]"}`}
        >
          <Check size={15} /> {busy ? "Menyimpan..." : "Ya, sudah benar, tandatangani"}
        </button>
      </div>
    </div>
  );
}
