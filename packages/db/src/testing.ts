// Test helpers, exported separately so application code can't truncate tables by accident.
import { createDb, type Database, type SqlClient } from './client';
import { runMigrations } from './migrations';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos_test';

export async function migrateTestDatabase(): Promise<void> {
  await runMigrations(TEST_DATABASE_URL);
}

export function createTestDb(): { db: Database; sql: SqlClient } {
  return createDb(TEST_DATABASE_URL, { max: 4 });
}

/** Empties every application table (keeps the migrations table). */
export async function resetDatabase(sql: SqlClient): Promise<void> {
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await sql.unsafe(`truncate ${list} restart identity cascade`);
}
