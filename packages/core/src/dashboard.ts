import {
  countAgentsByStatus,
  listAgents,
  listAuditLogs,
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
  /** Share of finished runs that succeeded; null until there are runs. */
  successRate: number | null;
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

/**
 * Data for the dashboard (PRD §4, Screen 1). Tasks, MCP connections and runs don't exist
 * yet; their counts are wired in as those tables land (M5, M6) and are zero until then.
 */
export async function getDashboardSummary(
  db: Database,
  ctx: TenantContext,
  now = new Date(),
): Promise<DashboardSummary> {
  const [counts, agents] = await Promise.all([
    countAgentsByStatus(db, ctx),
    listAgents(db, ctx, { statuses: STRIP_ORDER }),
  ]);
  return {
    agents: {
      active: counts.active,
      paused: counts.paused,
      total: counts.active + counts.paused + counts.configured + counts.draft,
    },
    agentList: agents.sort((a, b) => STRIP_ORDER.indexOf(a.status) - STRIP_ORDER.indexOf(b.status)),
    tasks: { running: 0 },
    mcpConnections: { connected: 0 },
    successRate: null,
    taskOverview: lastDays(now, 7),
    recentActivity: await listAuditLogs(db, ctx, { limit: 6 }),
  };
}
