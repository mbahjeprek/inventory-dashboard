import { useEffect, useId, useState } from "react";
import { api } from "../lib/api";

export type AlatOption = { kode: string; jenis_unit: string; nama: string };

// Kode Kendaraan picked from Master Data Alat Berat (small list, loaded once and filtered by the
// browser); anything else (e.g. KONTRAKTOR) can still be typed. `onAlat` gets the matching unit.
export function AlatAutocomplete({
  value,
  onChange,
  onAlat,
}: {
  value: string;
  onChange: (v: string) => void;
  onAlat?: (alat: AlatOption | undefined) => void;
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
        {options.map((o) => (
          <option key={o.kode} value={o.kode} label={[o.jenis_unit, o.nama].filter(Boolean).join(" · ")} />
        ))}
      </datalist>
    </>
  );
}
