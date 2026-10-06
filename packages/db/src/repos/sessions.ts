import { and, eq, gt, lte } from 'drizzle-orm';
import type { Executor } from '../client';
import { sessions } from '../schema/index';

export type Session = typeof sessions.$inferSelect;

export async function insertSession(
  db: Executor,
  values: { id: string; userId: string; workspaceId: string; expiresAt: Date },
): Promise<void> {
  await db.insert(sessions).values(values);
}

export async function findActiveSession(
  db: Executor,
  id: string,
  now: Date,
): Promise<Session | undefined> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  return session;
}

export async function extendSession(db: Executor, id: string, expiresAt: Date): Promise<void> {
  await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
}

export async function deleteSession(db: Executor, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteExpiredSessions(db: Executor, now: Date): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return deleted.length;
}
