import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import {
  agents,
  approvalRequests,
  conversations,
  messages,
  runEvents,
  runs,
  tasks,
  toolCalls,
} from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';
import type { Run, RunEvent } from './runs';

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskState = Task['state'];
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;

// --- conversations & messages -------------------------------------------------

export async function createConversation(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  title: string,
) {
  const [row] = await db
    .insert(conversations)
    .values({ workspaceId: ctx.workspaceId, agentId, userId: ctx.userId, title })
    .returning();
  return row!;
}

export async function findConversation(db: Executor, ctx: TenantContext, id: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(tenantScope(ctx, conversations, eq(conversations.id, id)))
    .limit(1);
  return row;
}

/** The caller's most recent conversation with the agent. */
export async function latestConversation(db: Executor, ctx: TenantContext, agentId: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      tenantScope(
        ctx,
        conversations,
        and(eq(conversations.agentId, agentId), eq(conversations.userId, ctx.userId)),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return row;
}

export async function insertMessage(
  db: Executor,
  ctx: TenantContext,
  values: Pick<Message, 'conversationId' | 'role' | 'content' | 'runId'>,
): Promise<Message> {
  const [row] = await db
    .insert(messages)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(tenantScope(ctx, conversations, eq(conversations.id, values.conversationId)));
  return row!;
}

/** Oldest first; the last `limit` messages. */
export async function listMessages(
  db: Executor,
  ctx: TenantContext,
  conversationId: string,
  limit = 50,
) {
  const rows = await db
    .select()
    .from(messages)
    .where(tenantScope(ctx, messages, eq(messages.conversationId, conversationId)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

// --- tasks ---------------------------------------------------------------------

export async function insertTask(
  db: Executor,
  ctx: TenantContext,
  values: Pick<Task, 'agentId' | 'origin' | 'objective'> & Partial<Pick<Task, 'state' | 'budget'>>,
): Promise<Task> {
  const [row] = await db
    .insert(tasks)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  return row!;
}

export async function updateTaskState(
  db: Executor,
  ctx: TenantContext,
  id: string,
  state: TaskState,
) {
  const terminal = state === 'completed' || state === 'failed' || state === 'cancelled';
  await db
    .update(tasks)
    .set({ state, updatedAt: new Date(), ...(terminal && { completedAt: new Date() }) })
    .where(tenantScope(ctx, tasks, eq(tasks.id, id)));
}

export async function listTasks(
  db: Executor,
  ctx: TenantContext,
  options: { agentId?: string; limit?: number } = {},
): Promise<(Task & { agentName: string })[]> {
  const rows = await db
    .select({ task: tasks, agentName: agents.name })
    .from(tasks)
    .innerJoin(agents, eq(agents.id, tasks.agentId))
    .where(
      tenantScope(ctx, tasks, options.agentId ? eq(tasks.agentId, options.agentId) : undefined),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(options.limit ?? 50);
  return rows.map((r) => ({ ...r.task, agentName: r.agentName }));
}

export async function countTasksByState(
  db: Executor,
  ctx: TenantContext,
): Promise<Partial<Record<TaskState, number>>> {
  const rows = await db
    .select({ state: tasks.state, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(tenantScope(ctx, tasks))
    .groupBy(tasks.state);
  return Object.fromEntries(rows.map((r) => [r.state, r.count]));
}

/** Completed / failed tasks per UTC day since `since` (dashboard chart). */
export async function taskOutcomesByDay(db: Executor, ctx: TenantContext, since: Date) {
  return db
    .select({
      day: sql<string>`to_char(${tasks.completedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      completed: sql<number>`count(*) filter (where ${tasks.state} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${tasks.state} = 'failed')::int`,
    })
    .from(tasks)
    .where(tenantScope(ctx, tasks, gte(tasks.completedAt, since)))
    .groupBy(sql`1`);
}

// --- runs ------------------------------------------------------------------------

export async function findRun(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Run | undefined> {
  const [row] = await db
    .select()
    .from(runs)
    .where(tenantScope(ctx, runs, eq(runs.id, id)))
    .limit(1);
  return row;
}

/**
 * Atomically moves a run from one of `from` to `running`. Returns undefined when another
 * worker already took it (or it was cancelled), so a run never executes twice at once.
 */
export async function claimRun(
  db: Executor,
  ctx: TenantContext,
  id: string,
  from: Run['status'][],
) {
  const [row] = await db
    .update(runs)
    .set({ status: 'running' })
    .where(tenantScope(ctx, runs, and(eq(runs.id, id), inArray(runs.status, from))))
    .returning();
  return row;
}

export async function updateRun(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<Run, 'status' | 'state' | 'provider' | 'model' | 'error' | 'toolCallCount' | 'endedAt'>
  >,
): Promise<void> {
  await db
    .update(runs)
    .set(values)
    .where(tenantScope(ctx, runs, eq(runs.id, id)));
}

/** Adds one model call's usage to the run's totals. */
export async function addRunUsage(
  db: Executor,
  ctx: TenantContext,
  id: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null },
): Promise<void> {
  await db
    .update(runs)
    .set({
      inputTokens: sql`${runs.inputTokens} + ${usage.inputTokens}`,
      outputTokens: sql`${runs.outputTokens} + ${usage.outputTokens}`,
      ...(usage.costUsd !== null && {
        costUsd: sql`coalesce(${runs.costUsd}, 0) + ${usage.costUsd}`,
      }),
    })
    .where(tenantScope(ctx, runs, eq(runs.id, id)));
}

/** Estimated spend of an agent's runs since `since` (daily budget, PRD §18). */
export async function agentSpendSince(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  since: Date,
) {
  const [row] = await db
    .select({ cost: sql<number>`coalesce(sum(${runs.costUsd}), 0)::float` })
    .from(runs)
    .where(tenantScope(ctx, runs, and(eq(runs.agentId, agentId), gte(runs.startedAt, since))));
  return row?.cost ?? 0;
}

export type RunWithDetails = Run & {
  agentName: string;
  events: RunEvent[];
  toolCalls: ToolCallRow[];
};

/** Runs with events and tool calls, newest first (Logs page, PRD §22). */
export async function listRunsWithDetails(
  db: Executor,
  ctx: TenantContext,
  options: { agentId?: string; status?: Run['status']; limit?: number } = {},
): Promise<RunWithDetails[]> {
  const rows = await db
    .select({ run: runs, agentName: agents.name })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(
      tenantScope(
        ctx,
        runs,
        and(
          options.agentId ? eq(runs.agentId, options.agentId) : undefined,
          options.status ? eq(runs.status, options.status) : undefined,
        ),
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(options.limit ?? 30);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.run.id);
  const [events, calls] = await Promise.all([
    db
      .select()
      .from(runEvents)
      .where(tenantScope(ctx, runEvents, inArray(runEvents.runId, ids)))
      .orderBy(asc(runEvents.createdAt)),
    db
      .select()
      .from(toolCalls)
      .where(tenantScope(ctx, toolCalls, inArray(toolCalls.runId, ids)))
      .orderBy(asc(toolCalls.createdAt)),
  ]);
  return rows.map(({ run, agentName }) => ({
    ...run,
    agentName,
    events: events.filter((e) => e.runId === run.id),
    toolCalls: calls.filter((c) => c.runId === run.id),
  }));
}

/** Events after `afterId` (by creation order) for live updates. */
export async function listRunEventsAfter(
  db: Executor,
  ctx: TenantContext,
  runId: string,
  after: Date | null,
) {
  return db
    .select()
    .from(runEvents)
    .where(
      tenantScope(
        ctx,
        runEvents,
        and(eq(runEvents.runId, runId), after ? sql`${runEvents.createdAt} > ${after}` : undefined),
      ),
    )
    .orderBy(asc(runEvents.createdAt));
}

// --- tool calls -------------------------------------------------------------------

export async function insertToolCall(
  db: Executor,
  ctx: TenantContext,
  values: Omit<typeof toolCalls.$inferInsert, 'id' | 'workspaceId' | 'createdAt'>,
): Promise<ToolCallRow> {
  const [row] = await db
    .insert(toolCalls)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  return row!;
}

export async function updateToolCall(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<ToolCallRow, 'status' | 'result' | 'arguments' | 'decisionReason' | 'finishedAt'>
  >,
) {
  await db
    .update(toolCalls)
    .set(values)
    .where(tenantScope(ctx, toolCalls, eq(toolCalls.id, id)));
}

export async function findToolCall(db: Executor, ctx: TenantContext, id: string) {
  const [row] = await db
    .select()
    .from(toolCalls)
    .where(tenantScope(ctx, toolCalls, eq(toolCalls.id, id)))
    .limit(1);
  return row;
}

export async function listToolCallsForRuns(db: Executor, ctx: TenantContext, runIds: string[]) {
  if (runIds.length === 0) return [];
  return db
    .select()
    .from(toolCalls)
    .where(tenantScope(ctx, toolCalls, inArray(toolCalls.runId, runIds)))
    .orderBy(asc(toolCalls.createdAt));
}

// --- approvals --------------------------------------------------------------------

export async function insertApprovalRequest(
  db: Executor,
  ctx: TenantContext,
  values: Omit<
    typeof approvalRequests.$inferInsert,
    'id' | 'workspaceId' | 'requestedAt' | 'status'
  >,
): Promise<ApprovalRequest> {
  const [row] = await db
    .insert(approvalRequests)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning();
  return row!;
}

export async function findApprovalRequest(db: Executor, ctx: TenantContext, id: string) {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(tenantScope(ctx, approvalRequests, eq(approvalRequests.id, id)))
    .limit(1);
  return row;
}

export async function listApprovalRequests(
  db: Executor,
  ctx: TenantContext,
  options: { status?: ApprovalRequest['status']; runIds?: string[]; limit?: number } = {},
): Promise<(ApprovalRequest & { agentName: string })[]> {
  if (options.runIds?.length === 0) return [];
  const rows = await db
    .select({ approval: approvalRequests, agentName: agents.name })
    .from(approvalRequests)
    .innerJoin(agents, eq(agents.id, approvalRequests.agentId))
    .where(
      tenantScope(
        ctx,
        approvalRequests,
        and(
          options.status ? eq(approvalRequests.status, options.status) : undefined,
          options.runIds ? inArray(approvalRequests.runId, options.runIds) : undefined,
        ),
      ),
    )
    .orderBy(desc(approvalRequests.requestedAt))
    .limit(options.limit ?? 100);
  return rows.map((r) => ({ ...r.approval, agentName: r.agentName }));
}

/** Records a decision only if the request is still pending; returns undefined otherwise. */
export async function resolveApprovalRequest(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Pick<ApprovalRequest, 'status' | 'approverUserId' | 'editedArguments' | 'note'>,
) {
  const [row] = await db
    .update(approvalRequests)
    .set({ ...values, resolvedAt: new Date() })
    .where(
      tenantScope(
        ctx,
        approvalRequests,
        and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'pending')),
      ),
    )
    .returning();
  return row;
}
