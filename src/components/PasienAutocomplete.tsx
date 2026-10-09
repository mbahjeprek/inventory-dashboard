import { useEffect, useRef, useState } from "react";
import { api, type Pasien } from "../lib/api";
import { tglSheet, usiaOf } from "../lib/kunjungan";

// Nama Pasien of Input Kunjungan: typing shows the estate's Master Pasien with the same name (with
// their L/P, age and divisi to tell people apart); picking one fills the visit's identity. A name not
// in the list is a new patient, added to Master Pasien when the visit is saved.
export function PasienAutocomplete({
  estate,
  value,
  pasienId,
  onType,
  onPick,
}: {
  estate: string;
  value: string;
  pasienId: number | null | undefined;
  onType: (nama: string) => void;
  onPick: (p: Pasien) => void;
}) {
  const [list, setList] = useState<Pasien[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const searching = open && value.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => api.pasienPick(estate, value).then(setList).catch(() => setList([])), 200);
    return () => clearTimeout(t);
  }, [estate, value, searching]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p: Pasien) => {
    onPick(p);
    setOpen(false);
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div ref={box} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === "Escape") return setOpen(false);
          if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
          e.preventDefault();
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, list.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else pick(list[active]);
        }}
        placeholder="ketik nama pasien"
        autoComplete="off"
        className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-[var(--bg-card)]"
      />
      <span className={`block text-[11px] mt-0.5 ${pasienId ? "text-[var(--accent-green)]" : "text-[var(--text-muted)]"}`}>
        {pasienId ? "Pasien terdaftar di Master Pasien" : value.trim() ? "Pasien baru: ditambahkan ke Master Pasien saat disimpan" : "Pilih dari daftar kalau sudah pernah berobat"}
      </span>
      {searching && list.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 top-[2.6rem] max-h-72 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow-lg text-sm">
          {list.map((p, i) => {
            const usia = usiaOf(p.tanggal_lahir_iso, today);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full text-left px-3 py-2 ${i === active ? "bg-[var(--accent-blue-bg)]" : ""}`}
                >
                  <div className="text-[var(--text-primary)]">{p.nama}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {[p.jenis_kelamin, usia !== null && `${usia} th`, p.tanggal_lahir_iso && `lahir ${tglSheet(p.tanggal_lahir_iso)}`, p.status_pasien, p.divisi, p.penanggung && `ditanggung ${p.penanggung}`, `${p.kunjungan}× berobat`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
