import "dotenv/config";
import fs from "fs";
import { execute, pool, withTransaction } from "./db.js";

// Koperasi Nilam from its Google Sheet (REKAP PENJUALAN 2023-2025, REKAP PEMBELIAN, BARANG RUSAK,
// SISA STOCK, DATA KARYAWAN), prepared into one JSON file:
//   npx tsx server/src/importKoperasi.ts koperasi_import.json
// Barang and anggota are upserted; the imported movements (sumber 'IMPORT') are replaced as a whole,
// so running it again with a newer sheet doesn't double them. Rows entered in the app stay.
// Karyawan in the sheet's DATA KARYAWAN but not in master karyawan yet are added (never changed).
type Barang = { kode: string; nama: string; satuan: string; harga_jual: number; harga_beli: number; lacak_stok: boolean; aktif: boolean };
type Anggota = { kode: string; jenis: string; nama: string; jabatan: string; estate: string; divisi: string; aktif: boolean };
type Tx = { jenis: string; tanggal: string; periode: string; bon?: string; barang: string; qty: number; harga: number; total: number; anggota?: string; no_po?: string; keterangan: string };
type Karyawan = { nik: string; nama: string; status: string; estate: string; lokasi_kerja: string };

const file = process.argv[2];
if (!file) throw new Error("Pakai: npx tsx server/src/importKoperasi.ts <koperasi_import.json>");
const data: { barang: Barang[]; anggota: Anggota[]; tx: Tx[]; karyawan_baru: Karyawan[] } = JSON.parse(fs.readFileSync(file, "utf-8"));

async function main() {
  await withTransaction(async (c) => {
    let added = 0;
    for (const k of data.karyawan_baru) {
      const r = await execute(
        `INSERT INTO karyawan (nik, nama, status, estate, lokasi_kerja) VALUES (@nik, @nama, @status, @estate, @lokasi_kerja) ON CONFLICT (nik) DO NOTHING`,
        k,
        c
      );
      added += r.rowCount;
    }
    for (const b of data.barang)
      await execute(
        `INSERT INTO koperasi_barang (kode, nama, satuan, harga_jual, harga_beli, lacak_stok, aktif)
         VALUES (@kode, @nama, @satuan, @harga_jual, @harga_beli, @lacak_stok, @aktif)
         ON CONFLICT (kode) DO UPDATE SET nama = excluded.nama, satuan = excluded.satuan, harga_jual = excluded.harga_jual,
           harga_beli = excluded.harga_beli, lacak_stok = excluded.lacak_stok, aktif = excluded.aktif`,
        b,
        c
      );
    for (const a of data.anggota)
      await execute(
        `INSERT INTO koperasi_anggota (kode, jenis, nama, jabatan, estate, divisi, aktif)
         VALUES (@kode, @jenis, @nama, @jabatan, @estate, @divisi, @aktif)
         ON CONFLICT (kode) DO UPDATE SET jenis = excluded.jenis, nama = COALESCE(NULLIF(excluded.nama, ''), koperasi_anggota.nama),
           jabatan = excluded.jabatan, estate = excluded.estate, divisi = excluded.divisi, aktif = excluded.aktif`,
        a,
        c
      );
    await execute("DELETE FROM koperasi_tx WHERE sumber = 'IMPORT'", {}, c);
    // 1000 rows per INSERT (unnest of one array per column).
    for (let i = 0; i < data.tx.length; i += 1000) {
      const part = data.tx.slice(i, i + 1000);
      const col = <K extends keyof Tx>(k: K, d: Tx[K] | null = null) => part.map((t) => t[k] ?? d);
      await execute(
        `INSERT INTO koperasi_tx (jenis, tanggal_iso, periode, bon, barang_kode, qty, harga, total, anggota_kode, bayar, no_po, keterangan, sumber)
         SELECT j, tg, p, b, k, q, h, t, a, CASE WHEN a IS NULL THEN 'POTONG_GAJI' WHEN a ~ '^[A-Z]{3}[0-9]+$' THEN 'POTONG_GAJI' ELSE 'INSTANSI' END, po, ket, 'IMPORT'
           FROM unnest(@j::text[], @tg::text[], @p::text[], @b::text[], @k::text[], @q::float8[], @h::float8[], @t::float8[], @a::text[], @po::text[], @ket::text[])
             AS x(j, tg, p, b, k, q, h, t, a, po, ket)`,
        {
          j: col("jenis"),
          tg: col("tanggal"),
          p: col("periode"),
          b: col("bon"),
          k: col("barang"),
          q: col("qty"),
          h: col("harga"),
          t: col("total"),
          a: col("anggota"),
          po: col("no_po", ""),
          ket: col("keterangan", ""),
        },
        c
      );
    }
    // The running month has no prices in the sheet yet (they are filled in at month end from the
    // purchase the goods came from): it gets the barang's last price, so its rekap isn't 0.
    const priced = await execute(
      `UPDATE koperasi_tx t SET harga = b.harga_jual, total = t.qty * b.harga_jual
         FROM koperasi_barang b WHERE b.kode = t.barang_kode AND t.sumber = 'IMPORT' AND t.jenis = 'JUAL' AND t.harga = 0 AND b.harga_jual > 0`,
      {},
      c
    );
    console.log(`Harga diisi dari harga terakhir: ${priced.rowCount} baris`);
    console.log(`Karyawan baru: ${added}, barang: ${data.barang.length}, anggota: ${data.anggota.length}, transaksi: ${data.tx.length}`);
  });
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
