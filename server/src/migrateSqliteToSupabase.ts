import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { Pool, type PoolClient } from "pg";

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

async function copyTable(client: PoolClient, spec: TableSpec) {
  const rows = sqlite.prepare(`SELECT * FROM ${spec.table}`).all() as Record<string, any>[];
  if (rows.length === 0) {
    console.log(`${spec.table}: 0 rows, skipped.`);
    return;
  }

  const colList = spec.columns.join(", ");
  const placeholders = spec.columns.map((_, i) => `$${i + 1}`).join(", ");
  const insertSql = `INSERT INTO ${spec.table} (${colList}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = spec.columns.map((c) => row[c] ?? null);
    await client.query(insertSql, values);
  }

  if (spec.columns.includes("id")) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${spec.table}', 'id'), COALESCE((SELECT MAX(id) FROM ${spec.table}), 1))`
    );
  }

  console.log(`${spec.table}: ${rows.length} rows migrated.`);
}

async function main() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Truncate dependents first so `DELETE FROM items` (inside copyTable) doesn't hit FK errors
    // when re-running this script against an already-populated database.
    for (const spec of [...TABLES].reverse()) {
      await client.query(`DELETE FROM ${spec.table}`);
    }
    for (const spec of TABLES) {
      await copyTable(client, spec);
    }
    await client.query("COMMIT");
    console.log("Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
