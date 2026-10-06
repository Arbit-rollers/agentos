import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { runEvents, runs } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;

export async function insertRun(
  db: Executor,
  ctx: TenantContext,
  values: Pick<Run, 'agentId' | 'kind' | 'strategy' | 'taskCategory'>,
): Promise<Run> {
  const [row] = await db
    .insert(runs)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  return row!;
}

export async function finishRun(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<
      Run,
      'status' | 'provider' | 'model' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'error'
    >
  >,
): Promise<void> {
  await db
    .update(runs)
    .set({ ...values, endedAt: new Date() })
    .where(tenantScope(ctx, runs, eq(runs.id, id)));
}

export async function insertRunEvent(
  db: Executor,
  ctx: TenantContext,
  runId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(runEvents).values({ runId, workspaceId: ctx.workspaceId, type, payload });
}

export async function listAgentRuns(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  limit = 10,
): Promise<(Run & { events: RunEvent[] })[]> {
  const rows = await db
    .select()
    .from(runs)
    .where(tenantScope(ctx, runs, eq(runs.agentId, agentId)))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const events = await db
    .select()
    .from(runEvents)
    .where(
      tenantScope(
        ctx,
        runEvents,
        inArray(
          runEvents.runId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(runEvents.createdAt);
  return rows.map((run) => ({ ...run, events: events.filter((e) => e.runId === run.id) }));
}

/** Finished-run counts, tokens and estimated cost since `since` (dashboard, PRD §4). */
export async function runStats(db: Executor, ctx: TenantContext, since: Date) {
  const [row] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${runs.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
      inputTokens: sql<number>`coalesce(sum(${runs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${runs.outputTokens}), 0)::int`,
      costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)::float`,
    })
    .from(runs)
    .where(tenantScope(ctx, runs, and(gte(runs.startedAt, since))));
  return row ?? { completed: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}
