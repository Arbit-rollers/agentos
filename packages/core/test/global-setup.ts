import { migrateTestDatabase } from '@agentos/db/testing';

export default async function setup() {
  await migrateTestDatabase();
}
