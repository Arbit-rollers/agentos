import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import {
  agents,
  approvalRequests,
  mcpConnections,
  mcpTools,
  runEvents,
  runs,
  toolCalls,
  workflowRuns,
  workflows,
} from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

// Analytics (PRD §22 Observability, Phase 8): workspace-wide aggregates over a time window.
// Every query is tenant-scoped; nothing here reveals message or tool content.

const seconds = sql<number>`coalesce(avg(extract(epoch from (${runs.endedAt} - ${runs.startedAt}))) filter (where ${runs.endedAt} is not null), 0)::float`;

export type AnalyticsTotals = {
  runs: number;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Runs whose model has no known price (their cost isn't in costUsd). */
  unpricedRuns: number;
  avgSeconds: number;
};

export async function analyticsTotals(
  db: Executor,
  ctx: TenantContext,
  since: Date,
): Promise<AnalyticsTotals> {
  const [row] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${runs.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
      inputTokens: sql<number>`coalesce(sum(${runs.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${runs.outputTokens}), 0)::bigint`,
      costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)::float`,
      unpricedRuns: sql<number>`count(*) filter (where ${runs.costUsd} is null and ${runs.model} is not null)::int`,
      avgSeconds: seconds,
    })
    .from(runs)
    .where(tenantScope(ctx, runs, gte(runs.startedAt, since)));
  return {
    runs: Number(row?.runs ?? 0),
    completed: Number(row?.completed ?? 0),
    failed: Number(row?.failed ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    costUsd: Number(row?.costUsd ?? 0),
    unpricedRuns: Number(row?.unpricedRuns ?? 0),
    avgSeconds: Number(row?.avgSeconds ?? 0),
  };
}

export type AnalyticsDay = { day: string; completed: number; failed: number; costUsd: number };

/** Runs and cost per calendar day in `timezone` (days with no runs are absent). */
export async function analyticsByDay(
  db: Executor,
  ctx: TenantContext,
  since: Date,
  timezone: string,
): Promise<AnalyticsDay[]> {
  const day = sql<string>`to_char(${runs.startedAt} at time zone ${timezone}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      completed: sql<number>`count(*) filter (where ${runs.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
      costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)::float`,
    })
    .from(runs)
    .where(tenantScope(ctx, runs, gte(runs.startedAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) }));
}

export type AgentStats = {
  agentId: string;
  name: string;
  runs: number;
  completed: number;
  failed: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgSeconds: number;
};

export async function analyticsByAgent(
  db: Executor,
  ctx: TenantContext,
  since: Date,
): Promise<AgentStats[]> {
  const rows = await db
    .select({
      agentId: runs.agentId,
      name: agents.name,
      runs: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${runs.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
      toolCalls: sql<number>`coalesce(sum(${runs.toolCallCount}), 0)::int`,
      inputTokens: sql<number>`coalesce(sum(${runs.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${runs.outputTokens}), 0)::bigint`,
      costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)::float`,
      avgSeconds: seconds,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(tenantScope(ctx, runs, gte(runs.startedAt, since)))
    .groupBy(runs.agentId, agents.name)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({
    ...r,
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    costUsd: Number(r.costUsd),
  }));
}

export type ModelStats = {
  provider: string;
  model: string;
  runs: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Times this model failed and the run moved on to a fallback. */
  fallbacksFrom: number;
};

/** Per served model (the one that answered), plus how often each model needed a fallback. */
export async function analyticsByModel(
  db: Executor,
  ctx: TenantContext,
  since: Date,
): Promise<ModelStats[]> {
  const served = await db
    .select({
      provider: sql<string>`${runs.provider}::text`,
      model: runs.model,
      runs: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
      inputTokens: sql<number>`coalesce(sum(${runs.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${runs.outputTokens}), 0)::bigint`,
      costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)::float`,
    })
    .from(runs)
    .where(tenantScope(ctx, runs, gte(runs.startedAt, since), sql`${runs.model} is not null`))
    .groupBy(runs.provider, runs.model);
  const fallbacks = await db
    .select({
      provider: sql<string>`${runEvents.payload}->'from'->>'provider'`,
      model: sql<string>`${runEvents.payload}->'from'->>'model'`,
      count: sql<number>`count(*)::int`,
    })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.workspaceId, ctx.workspaceId),
        eq(runEvents.type, 'model.fallback'),
        gte(runEvents.createdAt, since),
      ),
    )
    .groupBy(sql`1`, sql`2`);
  const key = (provider: string, model: string) => `${provider}\u0000${model}`;
  const byKey = new Map<string, ModelStats>();
  for (const r of served) {
    byKey.set(key(r.provider, r.model!), {
      provider: r.provider,
      model: r.model!,
      runs: r.runs,
      failed: r.failed,
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: Number(r.costUsd),
      fallbacksFrom: 0,
    });
  }
  for (const f of fallbacks) {
    if (!f.provider || !f.model) continue;
    const k = key(f.provider, f.model);
    const entry = byKey.get(k) ?? {
      provider: f.provider,
      model: f.model,
      runs: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      fallbacksFrom: 0,
    };
    entry.fallbacksFrom += f.count;
    byKey.set(k, entry);
  }
  return [...byKey.values()].sort((a, b) => b.runs - a.runs || b.fallbacksFrom - a.fallbacksFrom);
}

export type ToolStats = {
  toolName: string;
  server: string | null;
  calls: number;
  succeeded: number;
  failed: number;
  blocked: number;
  needingApproval: number;
};

export async function analyticsByTool(
  db: Executor,
  ctx: TenantContext,
  since: Date,
): Promise<ToolStats[]> {
  const rows = await db
    .select({
      toolName: toolCalls.toolName,
      server: sql<string | null>`coalesce(${mcpConnections.name}, ${toolCalls.connectionName})`,
      calls: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${toolCalls.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${toolCalls.status} = 'failed')::int`,
      blocked: sql<number>`count(*) filter (where ${toolCalls.status} = 'blocked')::int`,
      // Calls a person had to approve (or reject) before they could run.
      needingApproval: sql<number>`count(*) filter (where exists (select 1 from ${approvalRequests} where ${approvalRequests.toolCallId} = ${toolCalls.id}))::int`,
    })
    .from(toolCalls)
    .leftJoin(mcpTools, eq(mcpTools.id, toolCalls.toolId))
    .leftJoin(mcpConnections, eq(mcpConnections.id, mcpTools.connectionId))
    .where(tenantScope(ctx, toolCalls, gte(toolCalls.createdAt, since)))
    .groupBy(toolCalls.toolName, sql`2`)
    .orderBy(desc(sql`count(*)`))
    .limit(50);
  return rows;
}

export type ApprovalStats = {
  pending: number;
  approved: number;
  rejected: number;
  medianMinutes: number | null;
};

export async function analyticsApprovals(
  db: Executor,
  ctx: TenantContext,
  since: Date,
): Promise<ApprovalStats> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${approvalRequests.status} = 'pending')::int`,
      approved: sql<number>`count(*) filter (where ${approvalRequests.status} = 'approved')::int`,
      rejected: sql<number>`count(*) filter (where ${approvalRequests.status} = 'rejected')::int`,
      medianMinutes: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${approvalRequests.resolvedAt} - ${approvalRequests.requestedAt})) / 60) filter (where ${approvalRequests.resolvedAt} is not null)`,
    })
    .from(approvalRequests)
    .where(tenantScope(ctx, approvalRequests, gte(approvalRequests.requestedAt, since)));
  return {
    pending: row?.pending ?? 0,
    approved: row?.approved ?? 0,
    rejected: row?.rejected ?? 0,
    medianMinutes:
      row?.medianMinutes === null || row?.medianMinutes === undefined
        ? null
        : Number(row.medianMinutes),
  };
}

export type WorkflowStats = {
  workflowId: string;
  name: string;
  runs: number;
  completed: number;
  failed: number;
  avgSeconds: number;
};

export async function analyticsByWorkflow(
  db: Executor,
  ctx: TenantContext,
  since: Date,
): Promise<WorkflowStats[]> {
  const rows = await db
    .select({
      workflowId: workflowRuns.workflowId,
      name: workflows.name,
      runs: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${workflowRuns.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${workflowRuns.status} = 'failed')::int`,
      avgSeconds: sql<number>`coalesce(avg(extract(epoch from (${workflowRuns.endedAt} - ${workflowRuns.startedAt}))) filter (where ${workflowRuns.endedAt} is not null), 0)::float`,
    })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(tenantScope(ctx, workflowRuns, gte(workflowRuns.startedAt, since)))
    .groupBy(workflowRuns.workflowId, workflows.name)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ ...r, avgSeconds: Number(r.avgSeconds) }));
}
