import { useEffect, useId, useState } from "react";
import { api, type AlatGrup } from "../lib/api";

export type AlatOption = { kode: string; jenis_unit: string; nama: string; grup: AlatGrup };

// The unit group of a BBM lokasi: KNS and WJA have their own units; Nilam / Zamrud / Firus share AKSS's.
export const grupLokasi = (lokasi: string): AlatGrup => {
  const l = lokasi.trim().toUpperCase();
  return l.startsWith("KNS") ? "KNS" : l.startsWith("WJA") ? "WJA" : "AKSS";
};
// A unit of another group typed at this lokasi (allowed: borrowed), said in a line under the field.
export const alatLain = (alat: AlatOption | undefined, lokasi: string) =>
  alat && lokasi && alat.grup !== grupLokasi(lokasi) ? `Unit milik ${alat.grup}, bukan ${grupLokasi(lokasi)}: pastikan memang dipinjam` : "";

// Kode Kendaraan picked from Master Data Alat Berat (small list, loaded once and filtered by the
// browser); anything else (e.g. KONTRAKTOR) can still be typed. `onAlat` gets the matching unit.
// With `lokasi` the list shows only that lokasi's group (KNS / WJA / AKSS).
export function AlatAutocomplete({
  value,
  onChange,
  onAlat,
  lokasi = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onAlat?: (alat: AlatOption | undefined) => void;
  lokasi?: string;
}) {
  const listId = useId();
  const [options, setOptions] = useState<AlatOption[]>([]);

  useEffect(() => {
    api
      .alatPick("")
      .then(setOptions)
      .catch(() => setOptions([]));
  }, []);

  useEffect(() => {
    onAlat?.(options.find((o) => o.kode.toUpperCase() === value.trim().toUpperCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options]);

  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Pilih atau ketik kode..."
        className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
      />
      <datalist id={listId}>
        {options.filter((o) => !lokasi || o.grup === grupLokasi(lokasi)).map((o) => (
          <option key={o.kode} value={o.kode} label={[o.jenis_unit, o.nama].filter(Boolean).join(" · ")} />
        ))}
      </datalist>
    </>
  );
}
