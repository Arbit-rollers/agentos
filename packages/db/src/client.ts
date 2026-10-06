import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const sql = postgres(databaseUrl, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Database = ReturnType<typeof createDb>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything repositories can run queries on: the database or an open transaction. */
export type Executor = Database | Transaction;
export type SqlClient = ReturnType<typeof postgres>;

/** Round-trips a trivial query; throws if the database is unreachable. */
export async function pingDb(sql: SqlClient): Promise<void> {
  await sql`select 1`;
}

export function withTransaction<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
