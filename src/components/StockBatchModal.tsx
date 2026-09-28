import { useEffect, useMemo, useState } from "react";
import { api, GUDANG_TUJUAN, type PickerItem, type StockScope } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { BatchGrid, fmtNum, isBlankIn, parseNum, runningStock, type Cells, type GridCol } from "./BatchGrid";

// Input Banyak for Gudang (Nilam without a scope, KNS / WJA / Zamrud / Firus with one) and Klinik:
// one row per barang / obat, the stock of each running down its rows (see BatchGrid). The same rules
// as the Transaksi form: Stok Keluar never above the stock, Nilam and Klinik count whole units, a
// Nilam Stok Keluar to another estate becomes that gudang's Stok Masuk, Klinik Stok Masuk goes to the
// batch of its expiry date and Stok Keluar / Buang takes the batches that expire first. These
// movements are timestamped when saved.
const NILAM_TUJUAN = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];
const PAGE = 500;

// Every barang / obat of the scope with its stock, for the row's picker.
async function allItems(scope?: StockScope): Promise<PickerItem[]> {
  const out: PickerItem[] = [];
  for (let page = 1; ; page++) {
    const params = { page, pageSize: PAGE };
    const res =
      scope?.kind === "klinik"
        ? await api.klinikPickItems({ ...params, klinik: scope.name })
        : scope?.kind === "gudang"
          ? await api.gudangPickItems({ ...params, gudang: scope.name })
          : await api.items(params);
    out.push(...res.data);
    if (res.data.length < PAGE || out.length >= res.total) return out;
  }
}

export function StockBatchModal({ scope, onClose, onSuccess }: { scope?: StockScope; onClose: () => void; onSuccess: (count: number) => void }) {
  const { user } = useAuth();
  const klinik = scope?.kind === "klinik";
  const nilam = !scope;
  const estate = scope?.name ?? "NILAM";
  const whole = klinik || nilam;
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    allItems(scope)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byKode = useMemo(() => new Map(items.map((i) => [i.kode.toUpperCase(), i])), [items]);
  const itemOf = (c: Cells) => byKode.get((c.barang ?? "").trim().toUpperCase());
  const masuk = (c: Cells) => c.tipe === "IN";
  const buang = (c: Cells) => c.tipe === "BUANG";
  const tujuanOptions = nilam ? NILAM_TUJUAN : (GUDANG_TUJUAN[estate] ?? [estate]);
  const unit = (c: Cells) => itemOf(c)?.satuan ?? "";

  const columns: GridCol[] = [
    {
      key: "tipe",
      label: "Tipe",
      width: klinik ? 125 : 105,
      type: "select",
      options: [
        { value: "OUT", label: "Stock Out" },
        { value: "IN", label: "Stock In" },
        ...(klinik ? [{ value: "BUANG", label: "Buang (expired)" }] : []),
      ],
      tone: (c) => (masuk(c) ? "text-[var(--accent-green)]" : buang(c) ? "text-[var(--accent-amber)]" : "text-[var(--accent-red)]"),
    },
    {
      key: "barang",
      label: klinik ? "Kode Obat / Alat" : "Kode Barang",
      width: 150,
      options: items.map((i) => ({ value: i.kode, label: `${i.nama} · stok ${fmtNum(i.stock_tersedia)} ${i.satuan ?? ""}` })),
      placeholder: loading ? "memuat daftar..." : "ketik kode / nama",
      hint: (c) => {
        const i = itemOf(c);
        return i ? `${i.nama} · stok ${fmtNum(i.stock_tersedia)} ${i.satuan ?? ""}` : (c.barang ?? "").trim() && !loading ? "tidak ada di daftar" : undefined;
      },
    },
    { key: "jumlah", label: "Jumlah", width: 85, type: "number", align: "right", hint: (c) => unit(c) || undefined },
    ...(klinik
      ? [{ key: "exp", label: "Tgl Expired", width: 140, type: "date" as const, off: (c: Cells) => !masuk(c) && "otomatis (FEFO)" }]
      : [
          {
            key: "tujuan",
            label: "Tujuan",
            width: 115,
            type: "select" as const,
            carry: true,
            options: [{ value: "", label: "-- Pilih --" }, ...tujuanOptions.map((t) => ({ value: t }))],
            off: (c: Cells) => masuk(c) && "-",
            hint: (c: Cells) => (nilam && !masuk(c) && c.tujuan && c.tujuan !== "NILAM" ? `→ Stock In Gudang ${c.tujuan}` : undefined),
          },
        ]),
    {
      key: "penerima",
      label: klinik ? "Pasien / Penerima" : "Penerima / Diterima oleh",
      width: 170,
      carry: !klinik,
      suggest: (q) => api.karyawanPick(estate, q).then((l) => l.map((k) => k.nama)),
      placeholder: (c) => (masuk(c) ? "diterima oleh" : "nama penerima"),
      off: (c) => (klinik && masuk(c) ? (user?.nama ?? "") : klinik && buang(c) && "-"),
    },
    { key: "note", label: "Catatan", width: 220, placeholder: (c) => (masuk(c) ? "cth. Penerimaan dari supplier" : "cth. Untuk perbaikan ...") },
  ];
  const blank = isBlankIn(columns);
  const blankRow: Cells = { tipe: "OUT", barang: "", jumlah: "", exp: "", tujuan: nilam ? "" : tujuanOptions.length === 1 ? tujuanOptions[0] : "", penerima: "", note: "" };

  const run = (rows: Cells[]) =>
    runningStock(rows, {
      start: (k) => byKode.get(k)?.stock_tersedia ?? 0,
      keyOf: (c) => (itemOf(c) ? (c.barang ?? "").trim().toUpperCase() : ""),
      delta: (c) => (parseNum(c.jumlah) > 0 ? (masuk(c) ? 1 : -1) * parseNum(c.jumlah) : 0),
      blank,
    });

  const problem = (c: Cells, i: number, rows: Cells[]) => {
    const n = parseNum(c.jumlah);
    const keluar = !masuk(c);
    const missing = [
      !itemOf(c) && (klinik ? "Obat (pilih dari daftar)" : "Barang (pilih dari daftar)"),
      !(n > 0) && "Jumlah",
      !klinik && keluar && !c.tujuan && "Tujuan",
      !(klinik && (masuk(c) || buang(c))) && !c.penerima.trim() && (klinik ? "Pasien / Penerima" : masuk(c) ? "Diterima oleh" : "Penerima"),
      !c.note.trim() && "Catatan",
    ].filter(Boolean);
    if (missing.length) return `Wajib diisi: ${missing.join(", ")}`;
    if (whole && !Number.isInteger(n)) return "Jumlah harus bilangan bulat";
    const s = run(rows)[i];
    if (keluar && s && s.after < 0) return `Stok tidak cukup (tinggal ${fmtNum(s.before)} ${unit(c)})`;
    return "";
  };

  const submit = async (rows: Cells[], evidenceId: string) => {
    const base = (c: Cells) => ({ qty: parseNum(c.jumlah), note: c.note.trim() });
    if (klinik) {
      const res = await api.createKlinikBatch({
        evidence_id: evidenceId,
        klinik: estate,
        rows: rows.map((c) => ({
          ...base(c),
          obat_kode: itemOf(c)!.kode,
          type: masuk(c) ? "IN" : "OUT",
          expired_date: masuk(c) ? c.exp : "",
          buang: buang(c),
          penerima: masuk(c) ? (user?.nama ?? "") : buang(c) ? "" : c.penerima.trim(),
        })),
      });
      return res.count;
    }
    const gudangRows = rows.map((c) => ({
      ...base(c),
      item_kode: itemOf(c)!.kode,
      type: (masuk(c) ? "IN" : "OUT") as "IN" | "OUT",
      tujuan: masuk(c) ? "" : c.tujuan,
      penerima: c.penerima.trim(),
    }));
    const res = nilam
      ? await api.createNilamBatch({ evidence_id: evidenceId, rows: gudangRows })
      : await api.createGudangBatch({ evidence_id: evidenceId, gudang: estate, rows: gudangRows });
    return res.count;
  };

  return (
    <BatchGrid
      title={klinik ? `Input Banyak Klinik - ${estate}` : `Input Banyak Gudang - ${estate}`}
      subtitle={klinik ? "Stock In / Stock Out obat & alat medis sekaligus" : "Stock In / Stock Out barang sekaligus"}
      draftKey={`batch:${scope?.kind ?? "nilam"}:${estate}`}
      columns={columns}
      blankRow={blankRow}
      problem={problem}
      saldo={(rows) => run(rows).map((s) => s && { text: fmtNum(s.after), bad: s.after < 0 })}
      saldoLabel="Sisa Stok"
      summary={(rows) => {
        const out = rows.filter((c) => !masuk(c)).length;
        return (
          <>
            <b className="text-[var(--accent-red)]">{out}</b> stock out · <b className="text-[var(--accent-green)]">{rows.length - out}</b> stock in
          </>
        );
      }}
      submit={submit}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
