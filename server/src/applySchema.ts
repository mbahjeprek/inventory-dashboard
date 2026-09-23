import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL env var is not set");
}

async function main() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(sql);
  console.log("Schema applied.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
