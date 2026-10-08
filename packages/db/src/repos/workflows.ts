import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import type { Executor } from '../client';
import {
  approvalRequests,
  users,
  workflowRunSteps,
  workflowRuns,
  workflowVersions,
  workflows,
  type WorkflowGraph,
} from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type Workflow = typeof workflows.$inferSelect;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type WorkflowRunStep = typeof workflowRunSteps.$inferSelect;
export type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeType } from '../schema/index';
export { WORKFLOW_NODE_TYPES } from '../schema/index';

// --- workflows & versions ------------------------------------------------------

export async function insertWorkflow(
  db: Executor,
  ctx: TenantContext,
  values: Pick<Workflow, 'name' | 'description'>,
): Promise<Workflow> {
  const [row] = await db
    .insert(workflows)
    .values({ ...values, workspaceId: ctx.workspaceId, createdBy: ctx.userId })
    .returning();
  return row!;
}

export async function listWorkflows(
  db: Executor,
  ctx: TenantContext,
): Promise<(Workflow & { version: number | null; creatorName: string })[]> {
  const rows = await db
    .select({
      workflow: workflows,
      version: workflowVersions.version,
      creatorName: users.displayName,
    })
    .from(workflows)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .innerJoin(users, eq(users.id, workflows.createdBy))
    .where(tenantScope(ctx, workflows))
    .orderBy(asc(workflows.name));
  return rows.map((r) => ({ ...r.workflow, version: r.version, creatorName: r.creatorName }));
}

export async function findWorkflow(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Workflow | undefined> {
  const [row] = await db
    .select()
    .from(workflows)
    .where(tenantScope(ctx, workflows, eq(workflows.id, id)))
    .limit(1);
  return row;
}

export async function updateWorkflow(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<Pick<Workflow, 'name' | 'description' | 'active' | 'currentVersionId'>>,
): Promise<Workflow | undefined> {
  const [row] = await db
    .update(workflows)
    .set({ ...values, updatedAt: new Date() })
    .where(tenantScope(ctx, workflows, eq(workflows.id, id)))
    .returning();
  return row;
}

export async function deleteWorkflow(db: Executor, ctx: TenantContext, id: string) {
  await db.delete(workflows).where(tenantScope(ctx, workflows, eq(workflows.id, id)));
}

/** Saves the graph as the next version number. */
export async function insertWorkflowVersion(
  db: Executor,
  ctx: TenantContext,
  workflowId: string,
  graph: WorkflowGraph,
): Promise<WorkflowVersion> {
  const [latest] = await db
    .select({ version: max(workflowVersions.version) })
    .from(workflowVersions)
    .where(tenantScope(ctx, workflowVersions, eq(workflowVersions.workflowId, workflowId)));
  const [row] = await db
    .insert(workflowVersions)
    .values({
      workspaceId: ctx.workspaceId,
      workflowId,
      version: (latest?.version ?? 0) + 1,
      graph,
      createdBy: ctx.userId,
    })
    .returning();
  return row!;
}

export async function findWorkflowVersion(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<WorkflowVersion | undefined> {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(tenantScope(ctx, workflowVersions, eq(workflowVersions.id, id)))
    .limit(1);
  return row;
}

export async function listWorkflowVersions(
  db: Executor,
  ctx: TenantContext,
  workflowId: string,
): Promise<(Pick<WorkflowVersion, 'id' | 'version' | 'createdAt'> & { creatorName: string })[]> {
  return db
    .select({
      id: workflowVersions.id,
      version: workflowVersions.version,
      createdAt: workflowVersions.createdAt,
      creatorName: users.displayName,
    })
    .from(workflowVersions)
    .innerJoin(users, eq(users.id, workflowVersions.createdBy))
    .where(tenantScope(ctx, workflowVersions, eq(workflowVersions.workflowId, workflowId)))
    .orderBy(desc(workflowVersions.version));
}

// --- runs & steps ------------------------------------------------------------

export async function insertWorkflowRun(
  db: Executor,
  ctx: TenantContext,
  values: Pick<WorkflowRun, 'workflowId' | 'versionId' | 'trigger' | 'input'>,
): Promise<WorkflowRun> {
  const [row] = await db
    .insert(workflowRuns)
    .values({ ...values, workspaceId: ctx.workspaceId, triggeredBy: ctx.userId })
    .returning();
  return row!;
}

export async function findWorkflowRun(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<WorkflowRun | undefined> {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(tenantScope(ctx, workflowRuns, eq(workflowRuns.id, id)))
    .limit(1);
  return row;
}

export async function updateWorkflowRun(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<Pick<WorkflowRun, 'status' | 'output' | 'error' | 'endedAt'>>,
): Promise<void> {
  await db
    .update(workflowRuns)
    .set(values)
    .where(tenantScope(ctx, workflowRuns, eq(workflowRuns.id, id)));
}

/** Moves a run to `status` only from one of `from` (claims it for one worker). */
export async function claimWorkflowRun(
  db: Executor,
  ctx: TenantContext,
  id: string,
  from: WorkflowRun['status'][],
): Promise<WorkflowRun | undefined> {
  const [row] = await db
    .update(workflowRuns)
    .set({ status: 'running' })
    .where(
      tenantScope(ctx, workflowRuns, eq(workflowRuns.id, id), inArray(workflowRuns.status, from)),
    )
    .returning();
  return row;
}

export async function listWorkflowRuns(
  db: Executor,
  ctx: TenantContext,
  workflowId: string,
  limit = 30,
): Promise<(WorkflowRun & { version: number; triggeredByName: string })[]> {
  const rows = await db
    .select({ run: workflowRuns, version: workflowVersions.version, name: users.displayName })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.versionId))
    .innerJoin(users, eq(users.id, workflowRuns.triggeredBy))
    .where(tenantScope(ctx, workflowRuns, eq(workflowRuns.workflowId, workflowId)))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.run, version: r.version, triggeredByName: r.name }));
}

export async function listWorkflowRunSteps(
  db: Executor,
  ctx: TenantContext,
  runIds: string[],
): Promise<WorkflowRunStep[]> {
  if (runIds.length === 0) return [];
  return db
    .select()
    .from(workflowRunSteps)
    .where(tenantScope(ctx, workflowRunSteps, inArray(workflowRunSteps.runId, runIds)))
    .orderBy(asc(workflowRunSteps.startedAt));
}

/** Creates or updates the step row for a node in a run. */
export async function upsertWorkflowStep(
  db: Executor,
  ctx: TenantContext,
  values: Pick<WorkflowRunStep, 'runId' | 'nodeId' | 'nodeType' | 'label' | 'status'> &
    Partial<
      Pick<
        WorkflowRunStep,
        'input' | 'output' | 'error' | 'taskId' | 'approvalId' | 'resumeAt' | 'endedAt'
      >
    >,
): Promise<WorkflowRunStep> {
  const { runId, nodeId, ...rest } = values;
  const [row] = await db
    .insert(workflowRunSteps)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .onConflictDoUpdate({ target: [workflowRunSteps.runId, workflowRunSteps.nodeId], set: rest })
    .returning();
  void runId;
  void nodeId;
  return row!;
}

/** The workflow step waiting on an agent task, if any (resumes the run when it finishes). */
export async function findWorkflowStepByTask(
  db: Executor,
  ctx: TenantContext,
  taskId: string,
): Promise<WorkflowRunStep | undefined> {
  const [row] = await db
    .select()
    .from(workflowRunSteps)
    .where(tenantScope(ctx, workflowRunSteps, eq(workflowRunSteps.taskId, taskId)))
    .limit(1);
  return row;
}

/** Pending approvals of a run (cancelled with it). */
export async function listPendingWorkflowApprovalIds(
  db: Executor,
  ctx: TenantContext,
  workflowRunId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      tenantScope(
        ctx,
        approvalRequests,
        and(
          eq(approvalRequests.workflowRunId, workflowRunId),
          eq(approvalRequests.status, 'pending'),
        ),
      ),
    );
  return rows.map((r) => r.id);
}
