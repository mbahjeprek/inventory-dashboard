import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL env var is not set");
}

const sqliteDbPath = path.join(__dirname, "..", "inventory.db");
const sqlite = new Database(sqliteDbPath, { readonly: true });

type TableSpec = { table: string; columns: string[] };

// Order matters: `items` first (referenced by transactions/stock_in_log/stock_out_log via item_id).
const TABLES: TableSpec[] = [
  {
    table: "items",
    columns: [
      "id",
      "kode",
      "nama",
      "satuan",
      "buffer_stock",
      "keterangan",
      "stock_tersedia",
      "stock_in",
      "stock_out",
      "stock_fisik",
      "selisih_stock",
    ],
  },
  {
    table: "transactions",
    columns: [
      "id",
      "item_id",
      "tujuan",
      "type",
      "qty",
      "note",
      "created_at",
      "penerima",
      "is_correction",
      "mirror_source",
      "mirror_id",
    ],
  },
  {
    table: "stock_in_log",
    columns: [
      "id",
      "item_id",
      "kode",
      "nama",
      "tanggal_po",
      "no_pr",
      "po_in_akss",
      "nama_vendor",
      "qty",
      "satuan",
      "tujuan",
      "estate_raw",
      "divisi",
      "tanggal_terima",
      "tanggal_terima_iso",
      "keterangan",
    ],
  },
  {
    table: "stock_out_log",
    columns: [
      "id",
      "item_id",
      "kode",
      "nama",
      "no_request",
      "no_po",
      "req_by",
      "qty",
      "satuan",
      "tanggal_keluar",
      "tanggal_keluar_iso",
      "nik_ktp",
      "penerima",
      "tujuan",
      "estate_raw",
      "divisi",
      "no_embrace_gudang",
      "keterangan",
      "nik_karyawan",
    ],
  },
  { table: "karyawan", columns: ["id", "nik", "nama", "status", "estate", "lokasi_kerja", "nik_ktp"] },
  { table: "alat_berat", columns: ["id", "kode", "jenis_unit", "nama"] },
  {
    table: "bbm_log",
    columns: [
      "id",
      "jenis_bbm",
      "lokasi",
      "estate",
      "periode",
      "tanggal",
      "tanggal_iso",
      "no_spb",
      "stock_awal",
      "diterima",
      "pinjam",
      "pemakaian",
      "saldo_stock",
      "keterangan",
      "status_kepemilikan",
      "kode_kendaraan",
      "hm_terakhir",
    ],
  },
];

const BATCH_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// One transaction per table (not one giant transaction for the whole migration) - keeps each
// round trip short so it survives on a flaky/pooled connection, and a table that fails after this
// one succeeds doesn't roll back tables already committed.
async function copyTable(pool: Pool, spec: TableSpec) {
  const rows = sqlite.prepare(`SELECT * FROM ${spec.table}`).all() as Record<string, any>[];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${spec.table}`);

    if (rows.length > 0) {
      const colList = spec.columns.join(", ");
      for (const batch of chunk(rows, BATCH_SIZE)) {
        const values: any[] = [];
        const tuples = batch.map((row, rowIdx) => {
          const placeholders = spec.columns.map((_, colIdx) => {
            values.push(row[spec.columns[colIdx]] ?? null);
            return `$${rowIdx * spec.columns.length + colIdx + 1}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await client.query(`INSERT INTO ${spec.table} (${colList}) VALUES ${tuples.join(", ")}`, values);
      }
    }

    if (spec.columns.includes("id")) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${spec.table}', 'id'), COALESCE((SELECT MAX(id) FROM ${spec.table}), 1))`
      );
    }

    await client.query("COMMIT");
    console.log(`${spec.table}: ${rows.length} rows migrated.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });
  // Truncate dependents first (reverse order) so re-running this script against an
  // already-populated database doesn't hit FK errors when clearing `items`.
  const clearClient = await pool.connect();
  try {
    await clearClient.query("BEGIN");
    for (const spec of [...TABLES].reverse()) {
      await clearClient.query(`DELETE FROM ${spec.table}`);
    }
    await clearClient.query("COMMIT");
  } catch (err) {
    await clearClient.query("ROLLBACK");
    throw err;
  } finally {
    clearClient.release();
  }

  for (const spec of TABLES) {
    await copyTable(pool, spec);
  }

  console.log("Migration complete.");
  await pool.end();
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
