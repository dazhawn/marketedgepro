// One-off additive migration: creates the screener_runs table (idempotent).
// Run: npx tsx script/create-screener-table.ts  (DATABASE_URL from env)
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS screener_runs (
      id serial PRIMARY KEY,
      mode varchar(10) NOT NULL,
      rows jsonb NOT NULL,
      meta jsonb NOT NULL,
      received_at timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS screener_requests (
      id serial PRIMARY KEY,
      mode varchar(10) NOT NULL,
      requested_at timestamp DEFAULT now() NOT NULL,
      fulfilled_at timestamp
    )
  `);
  console.log("screener_runs + screener_requests tables ready");
  process.exit(0);
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
