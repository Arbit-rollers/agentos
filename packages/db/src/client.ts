import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type Database = ReturnType<typeof createDb>['db'];

export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const sql = postgres(databaseUrl, { max: options.max ?? 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type SqlClient = ReturnType<typeof postgres>;

/** Round-trips a trivial query; throws if the database is unreachable. */
export async function pingDb(sql: SqlClient): Promise<void> {
  await sql`select 1`;
}
