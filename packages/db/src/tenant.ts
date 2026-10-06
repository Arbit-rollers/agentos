import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Identity of the caller for every tenant-owned query (PRD §2, §21). Only the auth layer
 * creates one, after validating a session; repositories never trust a workspace id that
 * did not come from a TenantContext.
 */
export type TenantContext = {
  readonly userId: string;
  readonly workspaceId: string;
};

/**
 * Builds the WHERE clause for a tenant-owned table: the caller's workspace AND any extra
 * conditions. Use it for every select/update/delete on a table with `workspace_id`.
 */
export function tenantScope(
  ctx: TenantContext,
  table: { workspaceId: PgColumn },
  ...conditions: (SQL | undefined)[]
): SQL {
  return and(eq(table.workspaceId, ctx.workspaceId), ...conditions) as SQL;
}
