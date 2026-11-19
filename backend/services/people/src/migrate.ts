import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { requiredEnv } from './config.js'

const pool = new Pool({ connectionString: requiredEnv('DATABASE_URL') })
const directory = new URL('../db/', import.meta.url)
const files = (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort()

try {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query('SELECT pg_advisory_xact_lock($1)', [6427302])
    await db.query('CREATE TABLE IF NOT EXISTS people_schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const name of files) {
      const sql = (await readFile(new URL(name, directory), 'utf8')).replace(/\r\n/g, '\n')
      const sha256 = createHash('sha256').update(sql).digest('hex')
      const existing = await db.query<{ sha256: string }>('SELECT sha256 FROM people_schema_migrations WHERE name = $1', [name])
      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== sha256) throw new Error('Applied migration changed: ' + name)
        continue
      }
      await db.query(sql)
      await db.query('INSERT INTO people_schema_migrations(name, sha256) VALUES($1, $2)', [name, sha256])
    }
    await db.query('COMMIT')
    console.log('People database migrations are current.')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    db.release()
  }
} finally {
  await pool.end()
}
