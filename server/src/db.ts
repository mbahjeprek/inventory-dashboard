import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL env var is not set");
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Translates named `@param` tokens (as used throughout the route handlers, ported from the
// better-sqlite3 named-parameter style) into positional $1..$n placeholders + an ordered array,
// so the original SQL text could be kept almost unchanged during the Postgres port.
function toPositional(sql: string, params: Record<string, any>): { text: string; values: any[] } {
  const values: any[] = [];
  const seen = new Map<string, number>();
  const text = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    if (!(name in params)) throw new Error(`Missing param @${name}`);
    if (seen.has(name)) return `$${seen.get(name)}`;
    values.push(params[name]);
    const idx = values.length;
    seen.set(name, idx);
    return `$${idx}`;
  });
  return { text, values };
}

type Executor = Pick<Pool, "query"> | PoolClient;

export async function queryMany<T = any>(
  sql: string,
  params: Record<string, any> = {},
  executor: Executor = pool
): Promise<T[]> {
  const { text, values } = toPositional(sql, params);
  const result = await executor.query(text, values);
  return result.rows;
}

export async function queryOne<T = any>(
  sql: string,
  params: Record<string, any> = {},
  executor: Executor = pool
): Promise<T | undefined> {
  const rows = await queryMany<T>(sql, params, executor);
  return rows[0];
}

export async function execute(
  sql: string,
  params: Record<string, any> = {},
  executor: Executor = pool
): Promise<{ rowCount: number; rows: any[] }> {
  const { text, values } = toPositional(sql, params);
  const result = await executor.query(text, values);
  return { rowCount: result.rowCount ?? 0, rows: result.rows };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
