import { useEffect, useId, useState } from "react";
import { api } from "../lib/api";

export function KaryawanAutocomplete({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const [options, setOptions] = useState<{ nik: string; nama: string }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api.karyawan({ search: value, pageSize: 8, page: 1 }).then((res) => {
        setOptions(res.data.map((k) => ({ nik: k.nik, nama: k.nama })));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [value]);

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
