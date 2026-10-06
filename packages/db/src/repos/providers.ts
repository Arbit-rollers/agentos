import { asc, eq, or, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { modelConfigs, modelFallbacks, modelRoutes, providerConnections } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type ProviderConnection = typeof providerConnections.$inferSelect;
export type ProviderKindValue = ProviderConnection['provider'];

export async function insertProviderConnection(
  db: Executor,
  ctx: TenantContext,
  values: Pick<ProviderConnection, 'provider' | 'name' | 'endpoint' | 'secretId'>,
): Promise<ProviderConnection> {
  const [row] = await db
    .insert(providerConnections)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  return row!;
}

export async function listProviderConnections(
  db: Executor,
  ctx: TenantContext,
): Promise<ProviderConnection[]> {
  return db
    .select()
    .from(providerConnections)
    .where(tenantScope(ctx, providerConnections))
    .orderBy(asc(providerConnections.createdAt));
}

export async function findProviderConnection(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<ProviderConnection | undefined> {
  const [row] = await db
    .select()
    .from(providerConnections)
    .where(tenantScope(ctx, providerConnections, eq(providerConnections.id, id)))
    .limit(1);
  return row;
}

export async function updateProviderConnection(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<ProviderConnection, 'status' | 'models' | 'lastCheckedAt' | 'lastError' | 'secretId'>
  >,
): Promise<ProviderConnection | undefined> {
  const [row] = await db
    .update(providerConnections)
    .set(values)
    .where(tenantScope(ctx, providerConnections, eq(providerConnections.id, id)))
    .returning();
  return row;
}

export async function deleteProviderConnection(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(providerConnections)
    .where(tenantScope(ctx, providerConnections, eq(providerConnections.id, id)))
    .returning({ id: providerConnections.id });
  return rows.length > 0;
}

/** How many agent model configs reference the connection (as primary, route or fallback). */
export async function countConnectionUsage(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${modelConfigs.id})::int` })
    .from(modelConfigs)
    .leftJoin(modelRoutes, eq(modelRoutes.modelConfigId, modelConfigs.id))
    .leftJoin(modelFallbacks, eq(modelFallbacks.modelConfigId, modelConfigs.id))
    .where(
      tenantScope(
        ctx,
        modelConfigs,
        or(
          eq(modelConfigs.primaryConnectionId, connectionId),
          eq(modelRoutes.connectionId, connectionId),
          eq(modelFallbacks.connectionId, connectionId),
        ),
      ),
    );
  return row?.count ?? 0;
}
