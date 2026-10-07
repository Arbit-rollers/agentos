import {
  countAgentsByStatus,
  listAgents,
  listAuditLogs,
  listMcpConnections,
  countTasksByState,
  runStats,
  taskOutcomesByDay,
  type Agent,
  type AuditLog,
  type Database,
  type TenantContext,
} from '@agentos/db';

export type TaskOverviewDay = { date: string; completed: number; failed: number };

export type DashboardSummary = {
  agents: { active: number; paused: number; total: number };
  /** Non-archived agents for the dashboard strip, most useful first (active, paused, …). */
  agentList: Agent[];
  tasks: { running: number };
  mcpConnections: { connected: number };
  /** Share of finished runs in the last 7 days that succeeded; null until there are runs. */
  successRate: number | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  /** Oldest first, one entry per calendar day (UTC), always `days` long. */
  taskOverview: TaskOverviewDay[];
  recentActivity: AuditLog[];
};

function lastDays(now: Date, days: number): TaskOverviewDay[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return { date: date.toISOString().slice(0, 10), completed: 0, failed: 0 };
  });
}

const STRIP_ORDER: Agent['status'][] = ['active', 'paused', 'configured', 'draft'];

/** Data for the dashboard (PRD §4, Screen 1). */
export async function getDashboardSummary(
  db: Database,
  ctx: TenantContext,
  now = new Date(),
): Promise<DashboardSummary> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const overview = lastDays(now, 7);
  const [counts, agents, stats, mcp, taskStates, outcomes] = await Promise.all([
    countAgentsByStatus(db, ctx),
    listAgents(db, ctx, { statuses: STRIP_ORDER }),
    runStats(db, ctx, weekAgo),
    listMcpConnections(db, ctx),
    countTasksByState(db, ctx),
    taskOutcomesByDay(db, ctx, new Date(`${overview[0]!.date}T00:00:00Z`)),
  ]);
  for (const row of outcomes) {
    const day = overview.find((d) => d.date === row.day);
    if (day) Object.assign(day, { completed: row.completed, failed: row.failed });
  }
  const finished = stats.completed + stats.failed;
  return {
    agents: {
      active: counts.active,
      paused: counts.paused,
      total: counts.active + counts.paused + counts.configured + counts.draft,
    },
    agentList: agents.sort((a, b) => STRIP_ORDER.indexOf(a.status) - STRIP_ORDER.indexOf(b.status)),
    tasks: {
      running:
        (taskStates.queued ?? 0) +
        (taskStates.running ?? 0) +
        (taskStates.waiting_for_approval ?? 0),
    },
    mcpConnections: {
      connected: mcp.filter((c) => c.enabled && c.status === 'connected').length,
    },
    successRate: finished > 0 ? stats.completed / finished : null,
    usage: {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      costUsd: stats.costUsd,
    },
    taskOverview: overview,
    recentActivity: await listAuditLogs(db, ctx, { limit: 6 }),
  };
}
