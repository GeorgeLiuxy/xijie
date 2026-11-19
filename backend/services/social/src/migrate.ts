import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { Pool } from "pg"
import { requiredEnv } from "./config.js"
const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") }),
  directory = new URL("../db/", import.meta.url)
try {
  const db = await pool.connect()
  try {
    await db.query("BEGIN")
    await db.query("SELECT pg_advisory_xact_lock($1)", [6427305])
    await db.query(
      "CREATE TABLE IF NOT EXISTS social_schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
    )
    for (const name of (await readdir(directory))
      .filter((n) => /^\d+_.+\.sql$/.test(n))
      .sort()) {
      const sql = (await readFile(new URL(name, directory), "utf8")).replace(
          /\r\n/g,
          "\n",
        ),
        hash = createHash("sha256").update(sql).digest("hex"),
        old = (
          await db.query(
            "SELECT sha256 FROM social_schema_migrations WHERE name=$1",
            [name],
          )
        ).rows[0]
      if (old) {
        if (old.sha256 !== hash)
          throw new Error("Applied migration changed: " + name)
        continue
      }
      await db.query(sql)
      await db.query(
        "INSERT INTO social_schema_migrations(name,sha256) VALUES($1,$2)",
        [name, hash],
      )
    }
    await db.query("COMMIT")
    console.log("Social migrations are current.")
  } catch (e) {
    await db.query("ROLLBACK")
    throw e
  } finally {
    db.release()
  }
} finally {
  await pool.end()
}
