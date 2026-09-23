import "dotenv/config";
import { execute, queryMany, pool } from "./db.js";
import { hashPassword } from "./auth.js";

async function main() {
  const [mode, ...rest] = process.argv.slice(2);

  if (mode === "create") {
    const [username, password, nama] = rest;
    if (!username || !password || !nama) {
      console.error('Usage: npm run user:create -- <username> <password> "<nama>"');
      process.exit(1);
    }
    await execute(
      `INSERT INTO users (username, password_hash, nama) VALUES (@username, @password_hash, @nama)
       ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash, nama = excluded.nama`,
      { username, password_hash: hashPassword(password), nama }
    );
    console.log(`User "${username}" created/updated.`);
  } else if (mode === "list") {
    const rows = await queryMany<{ id: number; username: string; nama: string }>(
      "SELECT id, username, nama FROM users ORDER BY username"
    );
    console.table(rows);
  } else if (mode === "delete") {
    const [username] = rest;
    if (!username) {
      console.error("Usage: npm run user:delete -- <username>");
      process.exit(1);
    }
    const result = await execute("DELETE FROM users WHERE username = @username", { username });
    console.log(result.rowCount ? `User "${username}" deleted.` : `User "${username}" not found.`);
  } else {
    console.error("Usage: npm run user:create|user:list|user:delete -- ...");
    process.exit(1);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
