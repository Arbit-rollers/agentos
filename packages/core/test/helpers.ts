import { createTestDb, resetDatabase } from '@agentos/db/testing';
import { afterAll, beforeEach } from 'vitest';
import { authenticate, register } from '../src/auth';

/** Opens the test database for a test file and empties it before every test. */
export function useTestDb() {
  const { db, sql } = createTestDb();
  beforeEach(() => resetDatabase(sql));
  afterAll(() => sql.end());
  return { db, sql };
}

let counter = 0;

/** Registers a fresh user and returns their authenticated session. */
export async function createUser(db: ReturnType<typeof useTestDb>['db'], email?: string) {
  const address = email ?? `user${++counter}@example.com`;
  const { token } = await register(db, { email: address, password: 'correct horse battery' });
  const session = await authenticate(db, token);
  if (!session) throw new Error('registration did not produce a session');
  return { token, ...session };
}
