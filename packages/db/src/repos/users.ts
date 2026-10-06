import { eq } from 'drizzle-orm';
import type { Executor } from '../client';
import { users } from '../schema/index';

export type User = typeof users.$inferSelect;

export async function insertUser(
  db: Executor,
  values: { email: string; passwordHash: string; locale?: string },
): Promise<User> {
  const [user] = await db.insert(users).values(values).returning();
  return user!;
}

export async function findUserByEmail(db: Executor, email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function findUserById(db: Executor, id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}
