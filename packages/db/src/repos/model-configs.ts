import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../client';
import { modelConfigs, modelFallbacks, modelRoutes } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type ModelConfigRow = typeof modelConfigs.$inferSelect;
export type ModelTargetRow = { connectionId: string; model: string };
export type ModelConfig = ModelConfigRow & {
  routes: (ModelTargetRow & { taskCategory: string })[];
  fallbacks: ModelTargetRow[];
};

export async function findModelConfig(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
): Promise<ModelConfig | undefined> {
  const [config] = await db
    .select()
    .from(modelConfigs)
    .where(tenantScope(ctx, modelConfigs, eq(modelConfigs.agentId, agentId)))
    .limit(1);
  if (!config) return undefined;
  const [routes, fallbacks] = await Promise.all([
    db
      .select({
        taskCategory: modelRoutes.taskCategory,
        connectionId: modelRoutes.connectionId,
        model: modelRoutes.model,
      })
      .from(modelRoutes)
      .where(eq(modelRoutes.modelConfigId, config.id))
      .orderBy(asc(modelRoutes.priority)),
    db
      .select({ connectionId: modelFallbacks.connectionId, model: modelFallbacks.model })
      .from(modelFallbacks)
      .where(eq(modelFallbacks.modelConfigId, config.id))
      .orderBy(asc(modelFallbacks.priority)),
  ]);
  return { ...config, routes, fallbacks };
}

/**
 * Replaces the agent's model configuration, routes and fallbacks. Call inside a transaction;
 * the caller has already verified the agent and every connection belong to `ctx`.
 */
export async function replaceModelConfig(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  values: Pick<
    ModelConfigRow,
    'strategy' | 'primaryConnectionId' | 'primaryModel' | 'parameters' | 'budgetPolicy'
  > & {
    routes: (ModelTargetRow & { taskCategory: string })[];
    fallbacks: ModelTargetRow[];
  },
): Promise<void> {
  const { routes, fallbacks, ...config } = values;
  const [row] = await db
    .insert(modelConfigs)
    .values({ ...config, agentId, workspaceId: ctx.workspaceId })
    .onConflictDoUpdate({
      target: modelConfigs.agentId,
      set: { ...config, updatedAt: new Date() },
      // Never let a conflict rewrite another workspace's row.
      setWhere: eq(modelConfigs.workspaceId, ctx.workspaceId),
    })
    .returning({ id: modelConfigs.id });
  if (!row) throw new Error('Model config belongs to another workspace');

  await db.delete(modelRoutes).where(eq(modelRoutes.modelConfigId, row.id));
  await db.delete(modelFallbacks).where(eq(modelFallbacks.modelConfigId, row.id));
  if (routes.length > 0) {
    await db
      .insert(modelRoutes)
      .values(routes.map((route, priority) => ({ ...route, priority, modelConfigId: row.id })));
  }
  if (fallbacks.length > 0) {
    await db
      .insert(modelFallbacks)
      .values(fallbacks.map((fb, priority) => ({ ...fb, priority, modelConfigId: row.id })));
  }
}
