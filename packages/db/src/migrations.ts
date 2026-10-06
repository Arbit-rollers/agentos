import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies all pending migrations. Returns false when none have been generated yet. */
export async function runMigrations(databaseUrl: string): Promise<boolean> {
  if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) return false;
  const { db, sql } = createDb(databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
    return true;
  } finally {
    await sql.end();
  }
}
