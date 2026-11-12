import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Db = pg.Pool;

export function createDb(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

const migrationsDir = new URL("../migrations/", import.meta.url);

/** Применяет миграции по порядку имён. При параллельном запуске их выполняет один процесс. */
export async function migrate(db: Db): Promise<string[]> {
  const files = (await readdir(fileURLToPath(migrationsDir))).filter((f) => f.endsWith(".sql")).sort();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('orders-aggregator:migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ name: string }>(`SELECT name FROM schema_migrations`);
    const applied = new Set(rows.map((row) => row.name));
    const done: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(new URL(file, migrationsDir), "utf8");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      done.push(file);
    }
    await client.query("COMMIT");
    return done;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
