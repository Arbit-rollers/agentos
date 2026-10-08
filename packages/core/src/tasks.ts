import {
  findAgent,
  findModelConfig,
  findRun,
  findTask,
  insertRun,
  insertTask,
  listChildTasks,
  listApprovalRequests,
  listDependentTasks,
  listRunsWithDetails,
  listStaleRuns,
  listTasksByIds,
  resolveApprovalRequest,
  updateRun,
  updateTaskState,
  type Database,
  type Task,
  type TenantContext,
} from '@agentos/db';
import { z } from 'zod';
import { recordAudit } from './audit';
import { recordTaskEpisode } from './memory';
import { parse } from './auth';
import { AppError } from './errors';
import { requireCreatorOrAdmin } from './permissions';
import { canAgentRun } from './models';
import type { RuntimeDeps } from './runtime';

/** Run failures worth retrying automatically: the provider was briefly unavailable. */
const TRANSIENT = new Set(['provider_unavailable', 'provider_rate_limit', 'provider_timeout']);
/** Delay before retry n (1-based): 30s, 2m, 8m… capped at 30 minutes. */
export const retryDelayMs = (attempt: number) => Math.min(30 * 60_000, 30_000 * 4 ** (attempt - 1));
export const ACTIVE: Task['state'][] = [
  'queued',
  'running',
  'waiting_for_agent',
  'waiting_for_approval',
];

const taskSchema = z.object({
  agentId: z.uuid({ error: 'agent_required' }),
  objective: z
    .string()
    .trim()
    .min(1, { error: 'objective_required' })
    .max(500, { error: 'objective_too_long' }),
  input: z.string().max(20_000, { error: 'input_too_long' }).default(''),
  priority: z.int().min(0).max(3).default(0),
  dueAt: z.coerce.date().optional(),
  dependsOn: z.array(z.uuid()).max(20).default([]),
  maxRetries: z.int().min(0).max(5, { error: 'too_many_retries' }).default(0),
});

export type TaskInput = z.input<typeof taskSchema>;

/** Queues a run for the task (PRD §14). */
async function startTaskRun(
  db: Database,
  deps: RuntimeDeps,
  ctx: TenantContext,
  task: Task,
  delayMs = 0,
) {
  const config = await findModelConfig(db, ctx, task.agentId);
  const run = await insertRun(db, ctx, {
    agentId: task.agentId,
    kind: 'task',
    status: 'queued',
    strategy: config?.strategy ?? null,
    taskCategory: 'general',
    taskId: task.id,
  });
  await deps.enqueueRun(
    { runId: run.id, workspaceId: ctx.workspaceId, userId: ctx.userId },
    { delayMs },
  );
  return run;
}

/**
 * Creates a task for an agent (Tasks → New Task, or a schedule firing). It starts at once
 * unless it waits on dependencies, which must be tasks of this workspace.
 */
export async function createTask(
  db: Database,
  deps: RuntimeDeps,
  ctx: TenantContext,
  input: TaskInput,
  origin:
    | { kind: 'manual' | 'schedule'; scheduleId?: string }
    | { kind: 'delegation'; parentTaskId: string; parentRunId: string }
    | { kind: 'workflow' } = { kind: 'manual' },
): Promise<Task> {
  const data = parse(taskSchema, input);
  const agent = await findAgent(db, ctx, data.agentId);
  if (!agent) throw new AppError('VALIDATION', 'Unknown agent', { agentId: ['agent_required'] });
  const dependencies = await listTasksByIds(db, ctx, [...new Set(data.dependsOn)]);
  if (dependencies.length !== new Set(data.dependsOn).size) {
    throw new AppError('VALIDATION', 'Unknown dependency', { dependsOn: ['unknown_task'] });
  }
  if (dependencies.some((d) => d.state === 'failed' || d.state === 'cancelled')) {
    throw new AppError('VALIDATION', 'Dependency failed', { dependsOn: ['dependency_failed'] });
  }

  const runnable =
    ['active', 'configured'].includes(agent.status) && (await canAgentRun(db, ctx, agent.id));
  const task = await insertTask(db, ctx, {
    agentId: agent.id,
    origin: origin.kind,
    createdBy: ctx.userId,
    ...((origin.kind === 'manual' || origin.kind === 'schedule') &&
      origin.scheduleId && { scheduleId: origin.scheduleId }),
    ...(origin.kind === 'delegation' && {
      parentTaskId: origin.parentTaskId,
      parentRunId: origin.parentRunId,
    }),
    objective: data.objective,
    input: data.input,
    priority: data.priority,
    ...(data.dueAt && { dueAt: data.dueAt }),
    dependsOn: dependencies.map((d) => d.id),
    maxRetries: data.maxRetries,
    state: 'queued',
  });
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: agent.id,
    action: 'task.created',
    targetType: 'task',
    targetId: task.id,
    outcome: 'success',
    metadata: {
      origin: origin.kind,
      ...((origin.kind === 'manual' || origin.kind === 'schedule') &&
        origin.scheduleId && { scheduleId: origin.scheduleId }),
      ...(origin.kind === 'delegation' && { parentTaskId: origin.parentTaskId }),
    },
  });

  // A schedule firing for an agent that can't run is recorded as a failed task, not lost.
  if (!runnable) {
    await updateTaskState(db, ctx, task.id, 'failed', { error: 'agent_not_runnable' });
    return (await findTask(db, ctx, task.id))!;
  }
  if (dependencies.every((d) => d.state === 'completed')) await startTaskRun(db, deps, ctx, task);
  return task;
}

/** Fails `task` and, transitively, every queued task waiting on it. */
async function failTask(db: Database, ctx: TenantContext, task: Task, error: string) {
  await updateTaskState(db, ctx, task.id, 'failed', { error });
  for (const dependent of await listDependentTasks(db, ctx, task.id)) {
    await failTask(db, ctx, dependent, 'dependency_failed');
  }
}

/**
 * Called by the runtime when a task's run finishes (PRD §14 lifecycle): completes the task
 * and starts dependents that are now unblocked, or retries a transient failure, or fails it.
 */
export async function onTaskRunFinished(
  db: Database,
  deps: RuntimeDeps,
  ctx: TenantContext,
  taskId: string,
  outcome: { status: 'completed'; output: string } | { status: 'failed'; error: string },
  runId: string | null = null,
) {
  const task = await findTask(db, ctx, taskId);
  if (!task || task.state === 'cancelled') return;
  // Episodic memory is best effort: it must never change how the task ends.
  const remember = (
    result: 'completed' | 'failed',
    fields: { output: string | null; error: string | null },
  ) => recordTaskEpisode(db, deps, ctx, { ...task, ...fields }, runId, result).catch(() => null);

  if (outcome.status === 'completed') {
    await updateTaskState(db, ctx, task.id, 'completed', { output: outcome.output, error: null });
    await remember('completed', { output: outcome.output, error: null });
    await resumeDelegatingRun(db, deps, ctx, task.parentRunId);
    await wakeWorkflow(db, deps, ctx, task);
    for (const dependent of await listDependentTasks(db, ctx, task.id)) {
      const blockers = await listTasksByIds(db, ctx, dependent.dependsOn);
      if (blockers.every((b) => b.state === 'completed'))
        await startTaskRun(db, deps, ctx, dependent);
    }
    return;
  }

  if (task.origin !== 'chat' && TRANSIENT.has(outcome.error) && task.attempt < task.maxRetries) {
    const attempt = task.attempt + 1;
    await updateTaskState(db, ctx, task.id, 'queued', {
      attempt,
      note: `retry_${attempt}:${outcome.error}`,
    });
    await startTaskRun(db, deps, ctx, task, retryDelayMs(attempt));
    return;
  }
  await failTask(db, ctx, task, outcome.error);
  await remember('failed', { output: null, error: outcome.error });
  await resumeDelegatingRun(db, deps, ctx, task.parentRunId);
  await wakeWorkflow(db, deps, ctx, task);
}

/** A task given by a workflow step wakes its run when it ends (v0.5). */
async function wakeWorkflow(db: Database, deps: RuntimeDeps, ctx: TenantContext, task: Task) {
  if (task.origin !== 'workflow' || !deps.enqueueWorkflow) return;
  const { onWorkflowTaskFinished } = await import('./workflows');
  await onWorkflowTaskFinished(db, deps as never, ctx, task.id);
}

/**
 * A run waiting on delegated tasks goes back on the queue once none of them is still active
 * (PRD §15). Called when a child finishes and by the parent itself right after it starts
 * waiting, so a child that finished first is never missed; a duplicate job is harmless
 * because runs are claimed atomically.
 */
export async function resumeDelegatingRun(
  db: Database,
  deps: RuntimeDeps,
  ctx: TenantContext,
  runId: string | null,
): Promise<boolean> {
  if (!runId) return false;
  const run = await findRun(db, ctx, runId);
  if (!run || run.status !== 'waiting_agents' || !run.taskId) return false;
  const children = (await listChildTasks(db, ctx, run.taskId)).filter(
    (t) => t.parentRunId === runId,
  );
  if (children.some((child) => ACTIVE.includes(child.state))) return false;
  await updateRun(db, ctx, run.id, { status: 'queued' });
  await updateTaskState(db, ctx, run.taskId, 'queued', { note: 'delegations_finished' });
  await deps.enqueueRun({ runId: run.id, workspaceId: ctx.workspaceId, userId: ctx.userId });
  return true;
}

/**
 * Cancels a task: its runs stop at the next step, pending approvals are rejected, and work it
 * delegated is cancelled too. Cancelling a delegated task lets its parent continue without it.
 */
export async function cancelTask(
  db: Database,
  ctx: TenantContext,
  taskId: string,
  options: { deps?: RuntimeDeps; note?: string } = {},
) {
  const task = await findTask(db, ctx, taskId);
  if (!task) throw new AppError('NOT_FOUND', 'Task not found');
  // Cascades from a cancelled parent were already authorized there.
  if (options.note !== 'parent_cancelled') await requireCreatorOrAdmin(db, ctx, task.createdBy);
  if (!ACTIVE.includes(task.state)) throw new AppError('INVALID_TRANSITION', 'Task is not active');
  await updateTaskState(db, ctx, task.id, 'cancelled', {
    note: options.note ?? 'cancelled_by_user',
  });
  for (const child of await listChildTasks(db, ctx, task.id)) {
    if (ACTIVE.includes(child.state))
      await cancelTask(db, ctx, child.id, { note: 'parent_cancelled' });
  }
  const runs = await listRunsWithDetails(db, ctx, { taskId, limit: 50 });
  for (const run of runs) {
    if (['queued', 'running', 'waiting_approval', 'waiting_agents'].includes(run.status)) {
      await updateRun(db, ctx, run.id, { status: 'cancelled', endedAt: new Date() });
    }
  }
  for (const approval of await listApprovalRequests(db, ctx, {
    runIds: runs.map((r) => r.id),
    status: 'pending',
  })) {
    await resolveApprovalRequest(db, ctx, approval.id, {
      status: 'rejected',
      approverUserId: ctx.userId,
      editedArguments: null,
      note: 'task_cancelled',
    });
  }
  for (const dependent of await listDependentTasks(db, ctx, task.id))
    await failTask(db, ctx, dependent, 'dependency_failed');
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: task.agentId,
    action: 'task.cancelled',
    targetType: 'task',
    targetId: task.id,
    outcome: 'success',
  });
  if (options.deps && options.note !== 'parent_cancelled')
    await resumeDelegatingRun(db, options.deps, ctx, task.parentRunId);
}

/** Runs a failed or cancelled task again as a new attempt. */
export async function retryTask(
  db: Database,
  deps: RuntimeDeps,
  ctx: TenantContext,
  taskId: string,
) {
  const task = await findTask(db, ctx, taskId);
  if (!task) throw new AppError('NOT_FOUND', 'Task not found');
  await requireCreatorOrAdmin(db, ctx, task.createdBy);
  if (task.state !== 'failed' && task.state !== 'cancelled')
    throw new AppError('INVALID_TRANSITION', 'Only failed or cancelled tasks can be retried');
  const agent = await findAgent(db, ctx, task.agentId);
  if (
    !agent ||
    !['active', 'configured'].includes(agent.status) ||
    !(await canAgentRun(db, ctx, agent.id))
  ) {
    throw new AppError('AGENT_NOT_RUNNABLE', 'This agent cannot run right now');
  }
  await updateTaskState(db, ctx, task.id, 'queued', {
    attempt: task.attempt + 1,
    error: null,
    note: 'manual_retry',
  });
  await startTaskRun(db, deps, ctx, task);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: task.agentId,
    action: 'task.retried',
    targetType: 'task',
    targetId: task.id,
    outcome: 'success',
  });
}

/**
 * Worker recovery job: runs whose worker died (no heartbeat for `staleMs`) go back on the
 * queue. They resume from their saved state; the runtime repairs any tool step that was cut
 * off, so nothing is reported as done unless it is recorded as done.
 */
export async function recoverStaleRuns(
  db: Database,
  deps: RuntimeDeps,
  staleMs = 2 * 60_000,
  now = new Date(),
) {
  const stale = await listStaleRuns(db, new Date(now.getTime() - staleMs));
  for (const run of stale) {
    const ctx = { workspaceId: run.workspaceId, userId: (await ownerOf(db, run)) ?? '' };
    const current = await findRun(db, ctx, run.id);
    if (current?.status !== 'running') continue;
    await updateRun(db, ctx, run.id, { status: 'queued' });
    await deps.enqueueRun({ runId: run.id, workspaceId: run.workspaceId, userId: ctx.userId });
  }
  return stale.length;
}

async function ownerOf(db: Database, run: { workspaceId: string; agentId: string }) {
  const agent = await findAgent(db, { workspaceId: run.workspaceId, userId: '' }, run.agentId);
  return agent?.ownerUserId;
}
