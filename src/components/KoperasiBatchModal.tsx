import { useEffect, useMemo, useRef, useState } from "react";
import { api, type KopAnggota, type KopBarang } from "../lib/api";
import { BatchGrid, HeaderField, fmtNum, headerInputCls, isBlankIn, localToday, parseNum, runningStock, type Cells, type GridCol } from "./BatchGrid";

// Input Banyak for the koperasi: many rows typed as a table and saved in one go (all or none).
// Pengambilan: one day, each row one barang of one anggota (by NIK; a karyawan not yet anggota becomes
// one), harga = the barang's harga jual unless typed; the stock and each anggota's Rp 1.500.000 a month
// are checked row after row. Pembelian: one day, each row one barang bought, its own No PO / nota.
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const norm = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

function useBarang() {
  const [items, setItems] = useState<KopBarang[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .kopBarang({ aktif: "1" })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);
  const byKode = useMemo(() => new Map(items.map((i) => [i.kode.toUpperCase(), i])), [items]);
  // The full name typed instead of the kode counts too, when only one barang has it.
  const byNama = useMemo(() => {
    const m = new Map<string, KopBarang | null>();
    for (const i of items) m.set(norm(i.nama), m.has(norm(i.nama)) ? null : i);
    return m;
  }, [items]);
  const itemOf = (c: Cells) => byKode.get(norm(c.barang)) ?? byNama.get(norm(c.barang)) ?? undefined;
  return { items, loading, byKode, itemOf };
}

export function KopJualBatchModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (count: number) => void }) {
  const [tanggal, setTanggal] = useState(localToday());
  const periode = tanggal.slice(0, 7);
  const { items, loading, byKode, itemOf } = useBarang();
  const [anggota, setAnggota] = useState<KopAnggota[]>([]);
  const [limit, setLimit] = useState(1_500_000);
  // Potong gaji already taken in the periode, per anggota.
  const [terpakai, setTerpakai] = useState<Map<string, number>>(new Map());
  // Karyawan typed by NIK who aren't anggota yet, looked up once each.
  const [extra, setExtra] = useState<Map<string, KopAnggota | null>>(new Map());
  const asked = useRef(new Set<string>());

  useEffect(() => {
    api.kopAnggota({ status: "aktif" }).then(setAnggota).catch(() => setAnggota([]));
  }, []);
  useEffect(() => {
    api
      .kopRekap(periode)
      .then((r) => (setLimit(r.limit), setTerpakai(new Map(r.data.map((x) => [x.kode, x.potong_gaji])))))
      .catch(() => setTerpakai(new Map()));
  }, [periode]);

  const byAnggota = useMemo(() => new Map(anggota.map((a) => [a.kode.toUpperCase(), a])), [anggota]);
  const anggotaOf = (c: Cells): KopAnggota | null | undefined => {
    const k = norm(c.anggota).replace(/\s/g, "");
    if (!k) return undefined;
    const a = byAnggota.get(k);
    if (a) return a;
    if (extra.has(k)) return extra.get(k);
    if (k.length >= 5 && !asked.current.has(k)) {
      asked.current.add(k);
      api
        .kopPickAnggota(k)
        .then((list) => setExtra((m) => new Map(m).set(k, list.find((x) => x.kode.toUpperCase() === k) ?? null)))
        .catch(() => setExtra((m) => new Map(m).set(k, null)));
    }
    return undefined;
  };
  const hargaOf = (c: Cells) => {
    const typed = parseNum(c.harga);
    return Number.isFinite(typed) ? typed : (itemOf(c)?.harga_jual ?? NaN);
  };

  const columns: GridCol[] = [
    {
      key: "anggota",
      label: "NIK / Anggota",
      width: 200,
      carry: true,
      options: anggota.map((a) => ({ value: a.kode, label: `${a.nama}${a.jabatan ? ` · ${a.jabatan}` : ""}` })),
      placeholder: "ketik nama / NIK",
      hint: (c) => {
        const a = anggotaOf(c);
        if (a) return `${a.nama}${a.jenis === "INSTANSI" ? " · instansi" : ""}${a.baru ? " · anggota baru" : ""}`;
        if (!norm(c.anggota)) return undefined;
        return extra.has(norm(c.anggota).replace(/\s/g, "")) ? "tidak ada di master karyawan" : "mencari...";
      },
    },
    {
      key: "barang",
      label: "Kode Barang",
      width: 240,
      options: items.map((i) => ({ value: i.kode, label: `${i.nama} · ${i.lacak_stok ? `stok ${fmtNum(i.stok)} ${i.satuan}` : "tanpa stok"} · ${rp(i.harga_jual)}` })),
      placeholder: loading ? "memuat daftar..." : "ketik kode / nama",
      hint: (c) => {
        const i = itemOf(c);
        return i ? `${i.nama} · ${i.lacak_stok ? `stok ${fmtNum(i.stok)} ${i.satuan}` : "tanpa stok"}` : norm(c.barang) && !loading ? "tidak ada di daftar barang" : undefined;
      },
    },
    { key: "jumlah", label: "Jumlah", width: 90, type: "number", align: "right", hint: (c) => itemOf(c)?.satuan || undefined },
    {
      key: "harga",
      label: "Harga (Rp)",
      width: 130,
      type: "number",
      align: "right",
      copy: false,
      placeholder: (c) => (itemOf(c) ? fmtNum(itemOf(c)!.harga_jual) : ""),
      hint: (c) => {
        const q = parseNum(c.jumlah);
        const h = hargaOf(c);
        return q > 0 && Number.isFinite(h) ? `= ${rp(q * h)}` : undefined;
      },
    },
  ];
  const blank = isBlankIn(columns);
  const blankRow: Cells = { anggota: "", barang: "", jumlah: "", harga: "" };
  const kodeOf = (c: Cells) => {
    const a = anggotaOf(c);
    return a ? a.kode.toUpperCase() : "";
  };

  const stock = (rows: Cells[]) =>
    runningStock(rows, {
      start: (k) => byKode.get(k)?.stok ?? 0,
      keyOf: (c) => (itemOf(c)?.lacak_stok ? itemOf(c)!.kode.toUpperCase() : ""),
      delta: (c) => (parseNum(c.jumlah) > 0 ? -parseNum(c.jumlah) : 0),
      blank,
    });
  // Sisa limit of the row's anggota after it (instansi: none).
  const sisa = (rows: Cells[]) =>
    runningStock(rows, {
      start: (k) => limit - (terpakai.get(k) ?? 0),
      keyOf: (c) => (anggotaOf(c)?.jenis === "KARYAWAN" ? kodeOf(c) : ""),
      delta: (c) => {
        const q = parseNum(c.jumlah);
        const h = hargaOf(c);
        return q > 0 && Number.isFinite(h) ? -q * h : 0;
      },
      blank,
    });

  const problem = (c: Cells, i: number, rows: Cells[]) => {
    const a = anggotaOf(c);
    const q = parseNum(c.jumlah);
    const h = hargaOf(c);
    const missing = [!a && "Anggota (NIK yang terdaftar)", !itemOf(c) && "Barang (pilih dari daftar)", !(q > 0) && "Jumlah", !(h >= 0) && "Harga"].filter(Boolean);
    if (missing.length) return `Wajib diisi: ${missing.join(", ")}`;
    if (!a!.aktif) return `${a!.nama} sudah tidak aktif`;
    const s = stock(rows)[i];
    if (s && s.after < 0) return `Stok ${itemOf(c)!.nama} tidak cukup (tinggal ${fmtNum(s.before)})`;
    const l = sisa(rows)[i];
    if (l && l.after < -0.005) return `${a!.nama} melebihi limit ${rp(limit)} (sisa ${rp(Math.max(l.before, 0))})`;
    return "";
  };

  const submit = async (rows: Cells[], evidenceId: string) => {
    const res = await api.kopJualBatch({
      tanggal,
      evidence_id: evidenceId || null,
      rows: rows.map((c) => ({ anggota_kode: kodeOf(c), barang_kode: itemOf(c)!.kode, qty: parseNum(c.jumlah), harga: hargaOf(c) })),
    });
    return res.count;
  };

  return (
    <BatchGrid
      title="Input Banyak Pengambilan"
      subtitle={`Banyak karyawan sekaligus; baris satu orang jadi satu bon, dipotong gaji ${new Date(`${periode}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`}
      draftKey="batch:koperasi:jual"
      header={
        <>
          <HeaderField label="Tanggal pengambilan">
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={headerInputCls} />
          </HeaderField>
          <p className="text-xs text-[var(--text-secondary)] self-center max-w-md">
            NIK terbawa ke baris berikutnya (Enter), jadi barang satu orang tinggal diketik ke bawah. Harga kosong = harga jual barang. Limit {rp(limit)} per orang per bulan.
          </p>
        </>
      }
      columns={columns}
      blankRow={blankRow}
      problem={problem}
      saldo={(rows) => sisa(rows).map((s) => (s ? { text: rp(s.after), bad: s.after < -0.005 } : null))}
      saldoLabel="Sisa limit"
      summary={(rows) => {
        const total = rows.reduce((s, c) => {
          const q = parseNum(c.jumlah);
          const h = hargaOf(c);
          return s + (q > 0 && Number.isFinite(h) ? q * h : 0);
        }, 0);
        const orang = new Set(rows.map(kodeOf).filter(Boolean)).size;
        return (
          <>
            {orang} orang · total <b className="text-[var(--text-primary)]">{rp(total)}</b>
          </>
        );
      }}
      submit={submit}
      onClose={onClose}
      onSuccess={onSuccess}
      evidenceOptional
      evidenceLabel="Foto bon (opsional, satu untuk semua baris)"
    />
  );
}

export function KopBeliBatchModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (count: number) => void }) {
  const [tanggal, setTanggal] = useState(localToday());
  const [updateHarga, setUpdateHarga] = useState(true);
  const { items, loading, byKode, itemOf } = useBarang();
  const hargaOf = (c: Cells) => {
    const typed = parseNum(c.harga);
    return Number.isFinite(typed) ? typed : (itemOf(c)?.harga_beli ?? NaN);
  };

  const columns: GridCol[] = [
    {
      key: "barang",
      label: "Kode Barang",
      width: 260,
      options: items.map((i) => ({ value: i.kode, label: `${i.nama} · stok ${fmtNum(i.stok)} ${i.satuan} · beli ${rp(i.harga_beli)}` })),
      placeholder: loading ? "memuat daftar..." : "ketik kode / nama",
      hint: (c) => {
        const i = itemOf(c);
        return i ? `${i.nama} · stok ${fmtNum(i.stok)} ${i.satuan}` : norm(c.barang) && !loading ? "tidak ada di daftar barang (tambah dulu di Stok Barang)" : undefined;
      },
    },
    { key: "jumlah", label: "Jumlah", width: 100, type: "number", align: "right", hint: (c) => itemOf(c)?.satuan || undefined },
    {
      key: "harga",
      label: "Harga Beli (Rp)",
      width: 140,
      type: "number",
      align: "right",
      copy: false,
      placeholder: (c) => (itemOf(c) ? fmtNum(itemOf(c)!.harga_beli) : ""),
      hint: (c) => {
        const q = parseNum(c.jumlah);
        const h = hargaOf(c);
        return q > 0 && Number.isFinite(h) ? `= ${rp(q * h)}` : undefined;
      },
    },
    { key: "no_po", label: "No PO / Nota", width: 160, carry: true, placeholder: "opsional" },
  ];
  const blank = isBlankIn(columns);
  const blankRow: Cells = { barang: "", jumlah: "", harga: "", no_po: "" };
  const run = (rows: Cells[]) =>
    runningStock(rows, {
      start: (k) => byKode.get(k)?.stok ?? 0,
      keyOf: (c) => itemOf(c)?.kode.toUpperCase() ?? "",
      delta: (c) => (parseNum(c.jumlah) > 0 ? parseNum(c.jumlah) : 0),
      blank,
    });

  const problem = (c: Cells) => {
    const missing = [!itemOf(c) && "Barang (pilih dari daftar)", !(parseNum(c.jumlah) > 0) && "Jumlah", !(hargaOf(c) >= 0) && "Harga beli"].filter(Boolean);
    return missing.length ? `Wajib diisi: ${missing.join(", ")}` : "";
  };

  const submit = async (rows: Cells[], evidenceId: string) => {
    const res = await api.kopBeliBatch({
      tanggal,
      evidence_id: evidenceId || null,
      update_harga: updateHarga,
      rows: rows.map((c) => ({ barang_kode: itemOf(c)!.kode, qty: parseNum(c.jumlah), harga: hargaOf(c), no_po: (c.no_po ?? "").trim() })),
    });
    return res.count;
  };

  return (
    <BatchGrid
      title="Input Banyak Pembelian"
      subtitle="Banyak barang masuk ke stok koperasi sekaligus"
      draftKey="batch:koperasi:beli"
      header={
        <>
          <HeaderField label="Tanggal pembelian">
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={headerInputCls} />
          </HeaderField>
          <label className="flex items-center gap-2 text-sm self-end pb-1.5">
            <input type="checkbox" checked={updateHarga} onChange={(e) => setUpdateHarga(e.target.checked)} /> Harga jual ke anggota ikut harga beli ini
          </label>
        </>
      }
      columns={columns}
      blankRow={blankRow}
      problem={problem}
      saldo={(rows) => run(rows).map((s) => (s ? { text: fmtNum(s.after) } : null))}
      saldoLabel="Stok setelah"
      summary={(rows) => (
        <>
          total{" "}
          <b className="text-[var(--text-primary)]">
            {rp(
              rows.reduce((s, c) => {
                const q = parseNum(c.jumlah);
                const h = hargaOf(c);
                return s + (q > 0 && Number.isFinite(h) ? q * h : 0);
              }, 0)
            )}
          </b>
        </>
      )}
      submit={submit}
      onClose={onClose}
      onSuccess={onSuccess}
      evidenceOptional
      evidenceLabel="Foto nota (opsional, satu untuk semua baris)"
    />
  );
}
