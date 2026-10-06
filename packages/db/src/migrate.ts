import { runMigrations } from './migrations';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const applied = await runMigrations(databaseUrl);
console.log(applied ? 'Migrations applied.' : 'No migrations generated yet; nothing to apply.');
