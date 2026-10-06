import { desc, inArray } from 'drizzle-orm';
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

/** Audit entries about specific targets (e.g. an MCP connection and its tools). */
export async function listAuditLogsForTargets(
  db: Executor,
  ctx: TenantContext,
  targetIds: string[],
  options: { limit?: number } = {},
): Promise<AuditLog[]> {
  if (targetIds.length === 0) return [];
  return db
    .select()
    .from(auditLogs)
    .where(tenantScope(ctx, auditLogs, inArray(auditLogs.targetId, targetIds)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(options.limit ?? 50);
}
