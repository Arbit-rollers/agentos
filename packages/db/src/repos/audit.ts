import { desc } from 'drizzle-orm';
import type { Executor } from '../client';
import { auditLogs } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = Omit<typeof auditLogs.$inferInsert, 'id' | 'createdAt'>;

export async function insertAuditLog(db: Executor, values: NewAuditLog): Promise<void> {
  await db.insert(auditLogs).values(values);
}

export async function listAuditLogs(
  db: Executor,
  ctx: TenantContext,
  options: { limit?: number } = {},
): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(tenantScope(ctx, auditLogs))
    .orderBy(desc(auditLogs.createdAt))
    .limit(options.limit ?? 50);
}
