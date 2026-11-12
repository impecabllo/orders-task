import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createDb, migrate } from "../src/db.js";

it("применяет миграции один раз при параллельном запуске", async () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orders_test");
  const db = createDb(url.href);
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const migrationDb = createDb(url.href);
  try {
    const results = await Promise.all([migrate(migrationDb), migrate(migrationDb)]);
    expect(results.map((files) => files.length).sort()).toEqual([0, 2]);
    expect(results.flat()).toEqual(["001_init.sql", "002_order_amount_paid.sql"]);
  } finally {
    await migrationDb.end();
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  }
});
