import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  console.log('No migrations generated yet; nothing to apply.');
  process.exit(0);
}

const { db, sql } = createDb(databaseUrl, { max: 1 });
try {
  await migrate(db, { migrationsFolder });
  console.log('Migrations applied.');
} finally {
  await sql.end();
}
