import { config } from "./config.js";
import { createDb, migrate } from "./db.js";

const db = createDb(config.databaseUrl);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "nothing to apply");
} finally {
  await db.end();
}
