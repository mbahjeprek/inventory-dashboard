import { useEffect, useId, useState } from "react";
import { api } from "../lib/api";

// Suggests only the karyawan of `estate` (the estate the transaction belongs to); any name can
// still be typed by hand.
export function KaryawanAutocomplete({
  estate,
  value,
  onChange,
  placeholder,
}: {
  estate: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const [options, setOptions] = useState<{ nik: string; nama: string }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .karyawanPick(estate, value)
        .then(setOptions)
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [estate, value]);

  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Cari nama karyawan atau ketik manual..."}
        className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
      />
      <datalist id={listId}>
        {options.map((k) => (
          <option key={k.nik} value={k.nama} />
        ))}
      </datalist>
    </>
  );
}
