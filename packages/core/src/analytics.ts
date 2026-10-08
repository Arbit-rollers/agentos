import {
  analyticsApprovals,
  analyticsByAgent,
  analyticsByDay,
  analyticsByModel,
  analyticsByTool,
  analyticsByWorkflow,
  analyticsTotals,
  findUserById,
  type AgentStats,
  type AnalyticsDay,
  type AnalyticsTotals,
  type ApprovalStats,
  type Database,
  type ModelStats,
  type TenantContext,
  type ToolStats,
  type WorkflowStats,
} from '@agentos/db';
import { dayIn, isValidTimezone, startOfDayIn } from './time';

/** Ranges the Analytics page offers, in days. */
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export type AnalyticsReport = {
  range: AnalyticsRange;
  timezone: string;
  totals: AnalyticsTotals;
  /** One entry per calendar day of the range, oldest first, including days without runs. */
  days: AnalyticsDay[];
  agents: AgentStats[];
  models: ModelStats[];
  tools: ToolStats[];
  approvals: ApprovalStats;
  workflows: WorkflowStats[];
};

/**
 * Workspace analytics for the last `range` days (PRD Phase 8): tokens, cost by agent / model /
 * provider, success rates, tool use, approvals and workflows. Days follow the person's timezone.
 */
export async function getAnalytics(
  db: Database,
  ctx: TenantContext,
  range: AnalyticsRange,
  now: Date = new Date(),
): Promise<AnalyticsReport> {
  const stored = (await findUserById(db, ctx.userId))?.timezone;
  const timezone = stored && isValidTimezone(stored) ? stored : 'UTC';

  // The window starts at local midnight `range - 1` days ago, so today counts as one full day.
  const today = dayIn(now, timezone);
  const labels: string[] = [];
  const cursor = new Date(`${today}T12:00:00Z`);
  for (let i = range - 1; i >= 0; i--) {
    labels.push(new Date(cursor.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const since = startOfDayIn(labels[0]!, timezone);

  const [totals, byDay, agents, models, tools, approvals, workflows] = await Promise.all([
    analyticsTotals(db, ctx, since),
    analyticsByDay(db, ctx, since, timezone),
    analyticsByAgent(db, ctx, since),
    analyticsByModel(db, ctx, since),
    analyticsByTool(db, ctx, since),
    analyticsApprovals(db, ctx, since),
    analyticsByWorkflow(db, ctx, since),
  ]);
  const found = new Map(byDay.map((d) => [d.day, d]));
  const days = labels.map((day) => found.get(day) ?? { day, completed: 0, failed: 0, costUsd: 0 });

  return { range, timezone, totals, days, agents, models, tools, approvals, workflows };
}
