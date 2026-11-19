import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { Pool } from "pg"
import { requiredEnv } from "./config.js"
const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") })
try {
  const db = await pool.connect()
  try {
    await db.query("BEGIN")
    await db.query("SELECT pg_advisory_xact_lock($1)", [6427303])
    await db.query(
      "CREATE TABLE IF NOT EXISTS conversations_schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
    )
    const directory = new URL("../db/", import.meta.url)
    for (const name of (await readdir(directory))
      .filter((value) => /^\d+_.+\.sql$/.test(value))
      .sort()) {
      const sql = (await readFile(new URL(name, directory), "utf8")).replace(
          /\r\n/g,
          "\n",
        ),
        digest = createHash("sha256").update(sql).digest("hex")
      const previous = (
        await db.query<{ sha256: string }>(
          "SELECT sha256 FROM conversations_schema_migrations WHERE name=$1",
          [name],
        )
      ).rows[0]
      if (previous) {
        if (previous.sha256 !== digest)
          throw new Error("Applied migration changed: " + name)
        continue
      }
      await db.query(sql)
      await db.query(
        "INSERT INTO conversations_schema_migrations(name,sha256) VALUES($1,$2)",
        [name, digest],
      )
    }
    await db.query("COMMIT")
    console.log("Conversations database migrations are current.")
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  } finally {
    db.release()
  }
} finally {
  await pool.end()
}
