import { useEffect, useMemo, useState } from "react";
import { api, type OpnameModule, type PinjamanBarang } from "../lib/api";
import { OPNAME_MODULE_LABEL } from "../lib/opname";
import { BatchGrid, HeaderField, fmtNum, headerInputCls, isBlankIn, localToday, parseNum, runningStock, type Cells, type GridCol } from "./BatchGrid";

const ESTATES = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"];
// Nilam's gudang and Klinik are counted in whole units; BBM, pupuk, oli and the other gudang take decimals (as loanWhole on the server).
const whole = (m: OpnameModule, a: string, b: string) => m === "KLINIK" || (m === "GUDANG" && (a === "NILAM" || b === "NILAM"));

// Input Banyak Pinjaman: many barang lent by one estate to another in one go, one foto bukti. Every
// row becomes its own Pinjaman - the lender's Stok Keluar and the borrower's Stok Masuk - and is
// returned on its own later. All rows are saved or none.
export function PinjamanBatchModal({
  modules,
  myEstates,
  onClose,
  onSuccess,
}: {
  modules: OpnameModule[];
  myEstates: string[];
  onClose: () => void;
  onSuccess: (count: number) => void;
}) {
  const [module, setModule] = useState<OpnameModule>(modules[0]);
  const dariOptions = ESTATES.filter((e) => myEstates.includes(e));
  const [dari, setDari] = useState(dariOptions[0] ?? "NILAM");
  const keOptions = ESTATES.filter((e) => e !== dari);
  const [ke, setKe] = useState(keOptions[0] ?? "");
  const [items, setItems] = useState<PinjamanBarang[]>([]);
  const [loading, setLoading] = useState(true);
  // One day for every row: today, or the day they were lent when entered later.
  const [tanggal, setTanggal] = useState(localToday());

  useEffect(() => {
    // Functional: a "ke" just restored from this lender's draft is kept.
    setKe((k) => (k && k !== dari ? k : (keOptions[0] ?? "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dari]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    api
      .pinjamanBarang(module, dari, "", true)
      .then((list) => !stale && setItems(list))
      .catch(() => !stale && setItems([]))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [module, dari]);

  const byKode = useMemo(() => new Map(items.map((i) => [i.kode.toUpperCase(), i])), [items]);
  // The full name typed instead of picking from the list counts too, when only one barang has it.
  const byNama = useMemo(() => {
    const m = new Map<string, PinjamanBarang | null>();
    for (const i of items) {
      const k = i.nama.trim().replace(/\s+/g, " ").toUpperCase();
      m.set(k, m.has(k) ? null : i);
    }
    return m;
  }, [items]);
  const itemOf = (c: Cells) => {
    const v = (c.barang ?? "").trim().replace(/\s+/g, " ").toUpperCase();
    return byKode.get(v) ?? byNama.get(v) ?? undefined;
  };
  const isWhole = whole(module, dari, ke);
  // Pupuk / oli saldo may go below zero (as in the Catat Pinjaman form); the rest can't lend more than they have.
  const checkStock = module !== "PUPUK" && module !== "OLI";
  const jenisModule = module === "BBM" || module === "PUPUK" || module === "OLI";

  const columns: GridCol[] = [
    {
      key: "barang",
      label: jenisModule ? "Jenis" : module === "KLINIK" ? "Kode Obat / Alat" : "Kode Barang",
      width: 220,
      options: items.map((i) => ({ value: i.kode, label: `${i.nama} · stok ${fmtNum(i.stok)} ${i.satuan}`, stok: Number(i.stok) })),
      placeholder: loading ? "memuat daftar..." : jenisModule ? "pilih jenis" : "ketik kode / nama",
      hint: (c) => {
        const i = itemOf(c);
        return i ? `${i.nama} · stok ${dari} ${fmtNum(i.stok)} ${i.satuan}` : (c.barang ?? "").trim() && !loading ? "tidak ada di daftar stok" : undefined;
      },
    },
    { key: "jumlah", label: "Jumlah", width: 100, type: "number", align: "right", hint: (c) => itemOf(c)?.satuan || undefined },
    { key: "alasan", label: "Alasan", width: 300, carry: true, placeholder: "cth. stok habis" },
  ];
  const blank = isBlankIn(columns);
  const blankRow: Cells = { barang: "", jumlah: "", alasan: "" };

  const run = (rows: Cells[]) =>
    runningStock(rows, {
      start: (k) => byKode.get(k)?.stok ?? 0,
      keyOf: (c) => itemOf(c)?.kode.toUpperCase() ?? "",
      delta: (c) => (parseNum(c.jumlah) > 0 ? -parseNum(c.jumlah) : 0),
      blank,
    });

  const problem = (c: Cells, i: number, rows: Cells[]) => {
    const n = parseNum(c.jumlah);
    const missing = [!itemOf(c) && "Barang (pilih dari daftar)", !(n > 0) && "Jumlah", !c.alasan.trim() && "Alasan"].filter(Boolean);
    if (missing.length) return `Wajib diisi: ${missing.join(", ")}`;
    if (isWhole && !Number.isInteger(n)) return "Jumlah harus bilangan bulat";
    const s = run(rows)[i];
    if (checkStock && s && s.after < 0) return `Stok ${dari} tidak cukup (tinggal ${fmtNum(s.before)} ${itemOf(c)?.satuan ?? ""})`;
    return "";
  };

  const submit = async (rows: Cells[], evidenceId: string) => {
    if (!ke) throw new Error("Pilih estate peminjam");
    const res = await api.createPinjamanBatch({
      tanggal_iso: tanggal,
      evidence_id: evidenceId,
      module,
      dari,
      ke,
      rows: rows.map((c) => ({ kode: itemOf(c)!.kode, qty: parseNum(c.jumlah), alasan: c.alasan.trim() })),
    });
    return res.count;
  };

  return (
    <BatchGrid
      title="Input Banyak Pinjaman"
      subtitle={`Banyak barang dipinjamkan ${dari} ke ${ke} sekaligus; tiap baris jadi satu pinjaman`}
      draftKey={`batch:pinjaman:${module}:${dari}`}
      extra={{ ke }}
      onRestoreExtra={(x) => {
        const d = x as { ke?: string } | null;
        if (d?.ke && d.ke !== dari && ESTATES.includes(d.ke)) setKe(d.ke);
        // The date isn't restored: a draft left from yesterday would book every row on yesterday.
      }}
      header={
        <>
          <HeaderField label="Modul">
            <select value={module} onChange={(e) => setModule(e.target.value as OpnameModule)} className={headerInputCls}>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {OPNAME_MODULE_LABEL[m]}
                </option>
              ))}
            </select>
          </HeaderField>
          <HeaderField label="Tanggal pinjam">
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={headerInputCls} />
          </HeaderField>
          <HeaderField label="Dipinjamkan oleh">
            <select value={dari} onChange={(e) => setDari(e.target.value)} className={headerInputCls}>
              {dariOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </HeaderField>
          <HeaderField label="Dipinjam oleh">
            <select value={ke} onChange={(e) => setKe(e.target.value)} className={headerInputCls}>
              {keOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </HeaderField>
          <p className="text-xs text-[var(--text-secondary)] self-center max-w-sm">
            Stok {dari} berkurang dan stok {ke} langsung bertambah. Tiap baris tercatat sebagai pinjaman yang harus dikembalikan.
          </p>
        </>
      }
      columns={columns}
      blankRow={blankRow}
      problem={problem}
      saldo={(rows) => run(rows).map((s) => (s ? { text: fmtNum(s.after), bad: checkStock && s.after < 0 } : null))}
      saldoLabel={`Sisa stok ${dari}`}
      submit={submit}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
