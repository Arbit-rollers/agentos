import {
  WORKFLOW_NODE_TYPES,
  claimWorkflowRun,
  deleteWorkflow as deleteWorkflowRow,
  findAgent,
  findMcpConnection,
  findMcpTool,
  findProviderConnection,
  findTask,
  findWorkflow,
  findWorkflowRun,
  findWorkflowStepByTask,
  findWorkflowVersion,
  insertApprovalRequest,
  insertWorkflow,
  insertWorkflowRun,
  insertWorkflowVersion,
  listApprovalRequests,
  listPendingWorkflowApprovalIds,
  listSchedules,
  listWorkflowRunSteps,
  resolveApprovalRequest,
  updateWorkflow,
  updateWorkflowRun,
  upsertWorkflowStep,
  type Database,
  type TenantContext,
  type Workflow,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunStep,
} from '@agentos/db';
import { callTool, McpGatewayError } from '@agentos/mcp-gateway';
import { describeModel, invokeModel } from '@agentos/model-gateway';
import { z } from 'zod';
import { recordAudit } from './audit';
import { parse } from './auth';
import { AppError } from './errors';
import { accessFor } from './mcp';
import { requireCreatorOrAdmin } from './permissions';
import { adapterForConnection } from './providers';
import type { RuntimeDeps, WorkflowJob } from './runtime';
import { cancelTask, createTask } from './tasks';

export type { WorkflowJob };
export type WorkflowDeps = RuntimeDeps & Required<Pick<RuntimeDeps, 'enqueueWorkflow'>>;

export const WORKFLOW_LIMITS = {
  nodes: 50,
  outputChars: 20_000,
  delayMinutes: 7 * 24 * 60,
} as const;
const MAX_TEXT = 20_000;

// --- node configuration ---------------------------------------------------------

const template = z.string().max(MAX_TEXT);
const CONFIG = {
  agent: z.object({
    agentId: z.uuid({ error: 'agent_required' }),
    prompt: template.default('{{previous}}'),
  }),
  tool: z.object({
    toolId: z.uuid({ error: 'tool_required' }),
    /** String values are templates. */
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  model: z.object({
    connectionId: z.uuid({ error: 'provider_required' }),
    model: z.string().trim().min(1, { error: 'model_required' }).max(200),
    prompt: template.min(1, { error: 'prompt_required' }),
    system: template.optional(),
  }),
  condition: z.object({
    subject: template.default('{{previous}}'),
    operator: z.enum(['contains', 'not_contains', 'equals', 'matches', 'not_empty']),
    value: z.string().max(500).default(''),
  }),
  approval: z.object({ message: template.min(1, { error: 'message_required' }) }),
  transform: z.object({ template: template.min(1, { error: 'template_required' }) }),
  delay: z.object({ minutes: z.number().int().min(1).max(WORKFLOW_LIMITS.delayMinutes) }),
  output: z.object({ template: template.default('{{previous}}') }),
} as const;

type Config<T extends keyof typeof CONFIG> = z.output<(typeof CONFIG)[T]>;

// --- templates ------------------------------------------------------------------

export type TemplateScope = { input: string; previous: string; steps: Record<string, string> };

/**
 * Fills `{{input}}`, `{{previous}}` and `{{steps.<label>}}` (labels match ignoring case).
 * Unknown references become empty text; nothing else is evaluated.
 */
export function renderTemplate(text: string, scope: TemplateScope): string {
  const steps = new Map(Object.entries(scope.steps).map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    if (key === 'input') return scope.input;
    if (key === 'previous') return scope.previous;
    if (key.startsWith('steps.')) return steps.get(key.slice(6).toLowerCase()) ?? '';
    return '';
  });
}

function renderArguments(value: unknown, scope: TemplateScope): unknown {
  if (typeof value === 'string') return renderTemplate(value, scope);
  if (Array.isArray(value)) return value.map((v) => renderArguments(v, scope));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, renderArguments(v, scope)]),
    );
  return value;
}

export function evaluateCondition(config: Config<'condition'>, subject: string): boolean {
  const text = subject.trim();
  switch (config.operator) {
    case 'contains':
      return text.toLowerCase().includes(config.value.toLowerCase());
    case 'not_contains':
      return !text.toLowerCase().includes(config.value.toLowerCase());
    case 'equals':
      return text.toLowerCase() === config.value.trim().toLowerCase();
    case 'not_empty':
      return text.length > 0;
    case 'matches':
      try {
        return new RegExp(config.value, 'i').test(text);
      } catch {
        return false;
      }
  }
}

// --- validation -----------------------------------------------------------------

export type GraphIssue = { nodeId?: string; code: string };

const graphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        type: z.enum(WORKFLOW_NODE_TYPES),
        label: z.string().trim().max(60),
        position: z.object({ x: z.number(), y: z.number() }),
        config: z.record(z.string(), z.unknown()),
      }),
    )
    .max(WORKFLOW_LIMITS.nodes, { error: 'too_many_steps' }),
  edges: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        source: z.string(),
        target: z.string(),
        branch: z.enum(['true', 'false']).optional(),
      }),
    )
    .max(WORKFLOW_LIMITS.nodes * 3),
});

/** Parses the shape; throws VALIDATION for malformed graphs (not for incomplete ones). */
export function parseGraph(input: unknown): WorkflowGraph {
  return parse(graphSchema, input) as WorkflowGraph;
}

const incoming = (graph: WorkflowGraph, id: string) => graph.edges.filter((e) => e.target === id);
const outgoing = (graph: WorkflowGraph, id: string) => graph.edges.filter((e) => e.source === id);

/**
 * Checks a graph can run (PRD §16): one start step, no cycles, every step reachable, branches
 * only on conditions, unique labels, and every step's settings valid. Returns the problems.
 */
export async function validateWorkflowGraph(
  db: Database,
  ctx: TenantContext,
  graph: WorkflowGraph,
): Promise<GraphIssue[]> {
  const issues: GraphIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (graph.nodes.length === 0) return [{ code: 'workflow_empty' }];
  if (ids.size !== graph.nodes.length) issues.push({ code: 'duplicate_step_id' });
  const labels = new Map<string, string>();
  for (const node of graph.nodes) {
    const key = node.label.trim().toLowerCase();
    if (!key) issues.push({ nodeId: node.id, code: 'step_name_required' });
    else if (labels.has(key)) issues.push({ nodeId: node.id, code: 'step_name_taken' });
    labels.set(key, node.id);
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target)
      issues.push({ code: 'invalid_connection' });
  }
  const starts = graph.nodes.filter((n) => incoming(graph, n.id).length === 0);
  if (starts.length !== 1)
    issues.push({ code: starts.length === 0 ? 'no_start_step' : 'several_start_steps' });

  // Cycles (Kahn) and reachability from the start.
  const indegree = new Map(graph.nodes.map((n) => [n.id, incoming(graph, n.id).length]));
  const queue = graph.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const edge of outgoing(graph, id)) {
      indegree.set(edge.target, indegree.get(edge.target)! - 1);
      if (indegree.get(edge.target) === 0) queue.push(edge.target);
    }
  }
  if (visited !== graph.nodes.length) issues.push({ code: 'workflow_cycle' });
  if (starts.length === 1) {
    const reached = new Set<string>([starts[0]!.id]);
    const stack = [starts[0]!.id];
    while (stack.length > 0) {
      for (const next of outgoing(graph, stack.pop()!)) {
        if (reached.has(next.target)) continue;
        reached.add(next.target);
        stack.push(next.target);
      }
    }
    for (const node of graph.nodes)
      if (!reached.has(node.id)) issues.push({ nodeId: node.id, code: 'step_unreachable' });
  }

  for (const node of graph.nodes) {
    const out = outgoing(graph, node.id);
    if (node.type === 'condition') {
      const branches = out.map((e) => e.branch);
      if (
        branches.some((b) => !b) ||
        new Set(branches).size !== branches.length ||
        out.length === 0
      )
        issues.push({ nodeId: node.id, code: 'condition_branches' });
    } else if (out.some((e) => e.branch)) {
      issues.push({ nodeId: node.id, code: 'invalid_connection' });
    }
    if (node.type === 'output' && out.length > 0)
      issues.push({ nodeId: node.id, code: 'output_is_last' });

    const parsed = CONFIG[node.type].safeParse(node.config);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message;
      issues.push({
        nodeId: node.id,
        code: message && /^[a-z_]+$/.test(message) ? message : 'step_settings_invalid',
      });
      continue;
    }
    if (node.type === 'agent') {
      const agent = await findAgent(db, ctx, (parsed.data as Config<'agent'>).agentId);
      if (!agent || agent.status === 'archived')
        issues.push({ nodeId: node.id, code: 'agent_required' });
    }
    if (node.type === 'tool') {
      const tool = await findMcpTool(db, ctx, (parsed.data as Config<'tool'>).toolId);
      if (!tool || !tool.available) issues.push({ nodeId: node.id, code: 'tool_required' });
      else if (tool.defaultPermission === 'BLOCKED')
        issues.push({ nodeId: node.id, code: 'tool_blocked' });
    }
    if (node.type === 'model') {
      const connection = await findProviderConnection(
        db,
        ctx,
        (parsed.data as Config<'model'>).connectionId,
      );
      if (!connection) issues.push({ nodeId: node.id, code: 'provider_required' });
    }
  }
  return issues;
}

async function requireValidGraph(db: Database, ctx: TenantContext, graph: WorkflowGraph) {
  const issues = await validateWorkflowGraph(db, ctx, graph);
  if (issues.length > 0)
    throw new AppError('VALIDATION', 'The workflow has problems', {
      graph: [...new Set(issues.map((i) => i.code))],
    });
}

// --- managing workflows ---------------------------------------------------------

const metaSchema = z.object({
  name: z.string().trim().min(1, { error: 'workflow_name_required' }).max(80),
  description: z.string().trim().max(1000).default(''),
});

const audit = (
  db: Database,
  ctx: TenantContext,
  action: string,
  workflow: Workflow,
  metadata = {},
) =>
  recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action,
    targetType: 'workflow',
    targetId: workflow.id,
    outcome: 'success',
    metadata: { name: workflow.name, ...metadata },
  });

async function requireWorkflow(db: Database, ctx: TenantContext, id: string, manage = true) {
  const workflow = await findWorkflow(db, ctx, id);
  if (!workflow) throw new AppError('NOT_FOUND', 'Workflow not found');
  if (manage) await requireCreatorOrAdmin(db, ctx, workflow.createdBy);
  return workflow;
}

/** Workflows → New (anyone): starts as version 1 with a single Output step. */
export async function createWorkflow(
  db: Database,
  ctx: TenantContext,
  input: { name: unknown; description?: unknown },
): Promise<Workflow> {
  const data = parse(metaSchema, input);
  const workflow = await insertWorkflow(db, ctx, data);
  const version = await insertWorkflowVersion(db, ctx, workflow.id, {
    nodes: [
      {
        id: 'output',
        type: 'output',
        label: 'Output',
        position: { x: 0, y: 0 },
        config: { template: '{{previous}}' },
      },
    ],
    edges: [],
  });
  const saved = (await updateWorkflow(db, ctx, workflow.id, { currentVersionId: version.id }))!;
  await audit(db, ctx, 'workflow.created', saved);
  return saved;
}

/**
 * Builder → Save: every save is a new version (PRD §16). An active workflow only accepts a
 * graph that can run; a draft may be saved incomplete.
 */
export async function saveWorkflow(
  db: Database,
  ctx: TenantContext,
  id: string,
  input: { name: unknown; description?: unknown; graph: unknown },
): Promise<{ workflow: Workflow; version: number; issues: GraphIssue[] }> {
  const current = await requireWorkflow(db, ctx, id);
  const meta = parse(metaSchema, input);
  const graph = parseGraph(input.graph);
  const issues = await validateWorkflowGraph(db, ctx, graph);
  if (current.active && issues.length > 0)
    throw new AppError('VALIDATION', 'An active workflow must stay valid', {
      graph: [...new Set(issues.map((i) => i.code))],
    });
  const version = await insertWorkflowVersion(db, ctx, id, graph);
  const workflow = (await updateWorkflow(db, ctx, id, { ...meta, currentVersionId: version.id }))!;
  await audit(db, ctx, 'workflow.saved', workflow, {
    version: version.version,
    steps: graph.nodes.length,
  });
  return { workflow, version: version.version, issues };
}

/** Builder → Restore: makes an older version current again (as a new version). */
export async function restoreWorkflowVersion(
  db: Database,
  ctx: TenantContext,
  id: string,
  versionId: string,
) {
  const workflow = await requireWorkflow(db, ctx, id);
  const version = await findWorkflowVersion(db, ctx, versionId);
  if (!version || version.workflowId !== id) throw new AppError('NOT_FOUND', 'Version not found');
  return saveWorkflow(db, ctx, id, {
    name: workflow.name,
    description: workflow.description,
    graph: version.graph,
  });
}

/** Activate (only a valid workflow) or deactivate; its schedule follows. */
export async function setWorkflowActive(
  db: Database,
  ctx: TenantContext,
  id: string,
  active: boolean,
) {
  const workflow = await requireWorkflow(db, ctx, id);
  if (active) {
    const version = await findWorkflowVersion(db, ctx, workflow.currentVersionId!);
    await requireValidGraph(db, ctx, version!.graph);
  }
  const updated = (await updateWorkflow(db, ctx, id, { active }))!;
  await audit(db, ctx, active ? 'workflow.activated' : 'workflow.deactivated', updated);
  return updated;
}

export async function deleteWorkflow(db: Database, ctx: TenantContext, id: string) {
  const workflow = await requireWorkflow(db, ctx, id);
  await deleteWorkflowRow(db, ctx, id);
  await audit(db, ctx, 'workflow.deleted', workflow);
}

/** The schedules that start this workflow. */
export const workflowSchedules = async (db: Database, ctx: TenantContext, workflowId: string) =>
  (await listSchedules(db, ctx)).filter((s) => s.workflowId === workflowId);

// --- running ----------------------------------------------------------------------

/**
 * Starts a run of the current version. `test` runs work on drafts; `manual` and `schedule`
 * runs need the workflow to be active. The run acts for `ctx.userId`.
 */
export async function startWorkflowRun(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  id: string,
  input: { input?: string; trigger: 'test' | 'manual' | 'schedule' },
): Promise<WorkflowRun> {
  const workflow = await requireWorkflow(db, ctx, id, input.trigger !== 'schedule');
  if (input.trigger !== 'test' && !workflow.active)
    throw new AppError('INVALID_TRANSITION', 'Activate the workflow first', {
      workflow: ['workflow_inactive'],
    });
  const version = (await findWorkflowVersion(db, ctx, workflow.currentVersionId!))!;
  await requireValidGraph(db, ctx, version.graph);
  const run = await insertWorkflowRun(db, ctx, {
    workflowId: id,
    versionId: version.id,
    trigger: input.trigger,
    input: (input.input ?? '').slice(0, MAX_TEXT),
  });
  await audit(db, ctx, 'workflow.run_started', workflow, {
    runId: run.id,
    trigger: input.trigger,
    version: version.version,
  });
  await deps.enqueueWorkflow({ runId: run.id, workspaceId: ctx.workspaceId, userId: ctx.userId });
  return run;
}

type StepState = WorkflowRunStep | undefined;

/** Outputs of finished steps, by label, for templates. */
function scopeFor(
  graph: WorkflowGraph,
  steps: Map<string, WorkflowRunStep>,
  run: WorkflowRun,
  node: WorkflowNode,
): TemplateScope {
  const byLabel: Record<string, string> = {};
  for (const n of graph.nodes) {
    const step = steps.get(n.id);
    if (step?.status === 'completed') byLabel[n.label] = step.output ?? '';
  }
  const previous = incoming(graph, node.id)
    .filter((e) => edgeActive(e, steps))
    .map((e) => steps.get(e.source)?.output ?? '')
    .filter(Boolean)
    .join('\n\n');
  return {
    input: run.input,
    previous: incoming(graph, node.id).length === 0 ? run.input : previous,
    steps: byLabel,
  };
}

/** An edge carries flow when its source completed and, for conditions, took this branch. */
function edgeActive(edge: WorkflowEdge, steps: Map<string, WorkflowRunStep>) {
  const source = steps.get(edge.source);
  if (source?.status !== 'completed') return false;
  return !edge.branch || source.output === edge.branch;
}

const settled = (step: StepState) => step?.status === 'completed' || step?.status === 'skipped';

/**
 * Worker: moves a run forward as far as it can — runs every ready step, re-checks the ones it
 * waits on (agent tasks, approvals, delays) — then finishes it or leaves it waiting.
 * Safe to call repeatedly; a run being advanced elsewhere makes this throw `busy` so the
 * job is retried rather than lost.
 */
export async function advanceWorkflowRun(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  runId: string,
  now = new Date(),
): Promise<WorkflowRun | undefined> {
  const run = await claimWorkflowRun(db, ctx, runId, ['queued', 'waiting']);
  if (!run) {
    const current = await findWorkflowRun(db, ctx, runId);
    if (current?.status === 'running') throw new Error('busy');
    return current;
  }
  const version = (await findWorkflowVersion(db, ctx, run.versionId))!;
  const graph = version.graph;
  const steps = new Map((await listWorkflowRunSteps(db, ctx, [run.id])).map((s) => [s.nodeId, s]));
  const save = async (
    node: WorkflowNode,
    values: Partial<WorkflowRunStep> & { status: WorkflowRunStep['status'] },
  ) => {
    const step = await upsertWorkflowStep(db, ctx, {
      runId: run.id,
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      ...values,
      ...((values.status === 'completed' ||
        values.status === 'failed' ||
        values.status === 'skipped') && { endedAt: now }),
    } as Parameters<typeof upsertWorkflowStep>[2]);
    steps.set(node.id, step);
    return step;
  };

  try {
    // 1. Re-check what we were waiting on.
    for (const node of graph.nodes) {
      const step = steps.get(node.id);
      if (step?.status === 'waiting')
        await checkWaiting(db, deps, ctx, run, graph, node, step, steps, save, now);
    }
    // 2. Run every step that is ready, until nothing changes.
    for (let progressed = true; progressed;) {
      progressed = false;
      for (const node of graph.nodes) {
        if (steps.has(node.id)) continue;
        const inbound = incoming(graph, node.id);
        if (!inbound.every((e) => settled(steps.get(e.source)))) continue;
        progressed = true;
        if (inbound.length > 0 && !inbound.some((e) => edgeActive(e, steps))) {
          await save(node, { status: 'skipped' });
          continue;
        }
        await runStep(db, deps, ctx, run, graph, node, steps, save, now);
      }
    }
  } catch (error) {
    await updateWorkflowRun(db, ctx, run.id, {
      status: 'failed',
      error: 'internal_error',
      endedAt: now,
    });
    throw error;
  }

  // 3. Finish, fail or wait.
  const all = [...steps.values()];
  const failed = all.find((s) => s.status === 'failed');
  if (failed) {
    await stopWaitingWork(db, deps, ctx, run.id, all);
    await updateWorkflowRun(db, ctx, run.id, {
      status: 'failed',
      error: failed.error ?? 'step_failed',
      endedAt: now,
    });
  } else if (all.some((s) => s.status === 'waiting')) {
    await updateWorkflowRun(db, ctx, run.id, { status: 'waiting' });
  } else {
    const outputs = graph.nodes.filter(
      (n) => n.type === 'output' && steps.get(n.id)?.status === 'completed',
    );
    const last =
      outputs.length > 0
        ? outputs
        : graph.nodes.filter(
            (n) => steps.get(n.id)?.status === 'completed' && outgoing(graph, n.id).length === 0,
          );
    await updateWorkflowRun(db, ctx, run.id, {
      status: 'completed',
      output: last
        .map((n) => steps.get(n.id)!.output ?? '')
        .join('\n\n')
        .slice(0, WORKFLOW_LIMITS.outputChars),
      endedAt: now,
    });
  }
  return findWorkflowRun(db, ctx, run.id);
}

type Save = (
  node: WorkflowNode,
  values: Partial<WorkflowRunStep> & { status: WorkflowRunStep['status'] },
) => Promise<WorkflowRunStep>;

async function runStep(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  run: WorkflowRun,
  graph: WorkflowGraph,
  node: WorkflowNode,
  steps: Map<string, WorkflowRunStep>,
  save: Save,
  now: Date,
) {
  const scope = scopeFor(graph, steps, run, node);
  const fail = (error: string, input?: string) =>
    save(node, { status: 'failed', error, ...(input !== undefined && { input }) });
  const done = (output: string, input?: string) =>
    save(node, {
      status: 'completed',
      output: output.slice(0, MAX_TEXT),
      ...(input !== undefined && { input: input.slice(0, MAX_TEXT) }),
    });
  switch (node.type) {
    case 'transform':
    case 'output': {
      const config = CONFIG[node.type].parse(node.config);
      const text = renderTemplate(config.template, scope);
      return done(text, scope.previous);
    }
    case 'condition': {
      const config = CONFIG.condition.parse(node.config);
      const subject = renderTemplate(config.subject, scope);
      return done(String(evaluateCondition(config, subject)), subject);
    }
    case 'model': {
      const config = CONFIG.model.parse(node.config);
      const prompt = renderTemplate(config.prompt, scope);
      const connection = await findProviderConnection(db, ctx, config.connectionId);
      if (!connection) return fail('provider_required', prompt);
      try {
        const target = {
          connectionId: connection.id,
          provider: connection.provider,
          model: config.model,
        };
        const outcome = await invokeModel(
          {
            plan: { strategy: 'fixed', primary: target, routes: [], fallbacks: [] },
            category: 'general',
            request: {
              ...(config.system && { system: renderTemplate(config.system, scope) }),
              messages: [{ role: 'user', content: prompt }],
            },
          },
          {
            adapterFor: () => adapterForConnection(deps, ctx, connection),
            capabilitiesFor: (t) =>
              describeModel(
                t.provider,
                t.model,
                connection.models.find((m) => m.id === t.model),
              ),
            onEvent: () => undefined,
          },
        );
        return done(outcome.result.text, prompt);
      } catch {
        return fail('model_call_failed', prompt);
      }
    }
    case 'tool': {
      const config = CONFIG.tool.parse(node.config);
      const args = renderArguments(config.arguments, scope) as Record<string, unknown>;
      const input = JSON.stringify(args);
      const tool = await findMcpTool(db, ctx, config.toolId);
      const connection = tool && (await findMcpConnection(db, ctx, tool.connectionId));
      if (!tool || !connection || !tool.enabled || !tool.available || !connection.enabled)
        return fail('tool_unavailable', input);
      if (tool.defaultPermission === 'BLOCKED') return fail('tool_blocked', input);
      if (tool.defaultPermission === 'APPROVAL_REQUIRED') {
        const approval = await insertApprovalRequest(db, ctx, {
          agentId: null,
          runId: null,
          workflowRunId: run.id,
          workflowStepId: node.id,
          taskId: null,
          toolCallId: null,
          kind: 'workflow_tool',
          payload: { tool: tool.name, server: connection.name, arguments: args, step: node.label },
          risk: tool.riskCategory ?? 'approval_required',
          reason: 'workspace_default',
          estimatedCostUsd: null,
        });
        return save(node, { status: 'waiting', input, approvalId: approval.id });
      }
      return executeToolStep(db, deps, ctx, node, config.toolId, args, save);
    }
    case 'agent': {
      const config = CONFIG.agent.parse(node.config);
      const prompt = renderTemplate(config.prompt, scope);
      try {
        const task = await createTask(
          db,
          deps,
          ctx,
          { agentId: config.agentId, objective: node.label, input: prompt, maxRetries: 1 },
          { kind: 'workflow' },
        );
        if (task.state === 'failed') return fail(task.error ?? 'agent_not_runnable', prompt);
        return save(node, { status: 'waiting', input: prompt, taskId: task.id });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        return fail('agent_required', prompt);
      }
    }
    case 'approval': {
      const config = CONFIG.approval.parse(node.config);
      const message = renderTemplate(config.message, scope);
      const approval = await insertApprovalRequest(db, ctx, {
        agentId: null,
        runId: null,
        workflowRunId: run.id,
        workflowStepId: node.id,
        taskId: null,
        toolCallId: null,
        kind: 'workflow_approval',
        payload: { message, step: node.label, previous: scope.previous.slice(0, 4000) },
        risk: 'human_approval',
        reason: 'workflow_approval',
        estimatedCostUsd: null,
      });
      return save(node, { status: 'waiting', input: message, approvalId: approval.id });
    }
    case 'delay': {
      const config = CONFIG.delay.parse(node.config);
      const resumeAt = new Date(now.getTime() + config.minutes * 60_000);
      await deps.enqueueWorkflow(
        { runId: run.id, workspaceId: ctx.workspaceId, userId: ctx.userId },
        { delayMs: config.minutes * 60_000 },
      );
      return save(node, { status: 'waiting', input: scope.previous, resumeAt });
    }
  }
}

async function executeToolStep(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  node: WorkflowNode,
  toolId: string,
  args: Record<string, unknown>,
  save: Save,
) {
  const input = JSON.stringify(args);
  const tool = await findMcpTool(db, ctx, toolId);
  const connection = tool && (await findMcpConnection(db, ctx, tool.connectionId));
  if (!tool || !connection)
    return save(node, { status: 'failed', error: 'tool_unavailable', input });
  try {
    const result = await callTool(await accessFor(db, deps, ctx, connection), tool.name, args);
    await recordAudit(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      targetType: 'mcp_tool',
      targetId: tool.id,
      action: 'tool.called',
      outcome: result.isError ? 'failure' : 'success',
      metadata: { tool: tool.name, connection: connection.name, workflowStep: node.label },
    });
    return result.isError
      ? save(node, {
          status: 'failed',
          error: 'tool_error',
          input,
          output: result.text.slice(0, MAX_TEXT),
        })
      : save(node, { status: 'completed', input, output: result.text.slice(0, MAX_TEXT) });
  } catch (error) {
    if (error instanceof AppError && error.code === 'MCP_NEEDS_USER_AUTH')
      return save(node, { status: 'failed', error: 'mcp_needs_user_auth', input });
    if (!(error instanceof McpGatewayError)) throw error;
    return save(node, { status: 'failed', error: `mcp_${error.kind}`, input });
  }
}

/** A waiting step: has its task / approval / delay finished? */
async function checkWaiting(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  run: WorkflowRun,
  graph: WorkflowGraph,
  node: WorkflowNode,
  step: WorkflowRunStep,
  steps: Map<string, WorkflowRunStep>,
  save: Save,
  now: Date,
) {
  if (step.taskId) {
    const task = await findTask(db, ctx, step.taskId);
    if (task?.state === 'completed')
      await save(node, { status: 'completed', output: (task.output ?? '').slice(0, MAX_TEXT) });
    else if (task?.state === 'failed' || task?.state === 'cancelled' || !task)
      await save(node, { status: 'failed', error: task?.error ?? task?.state ?? 'task_missing' });
    return;
  }
  if (step.approvalId) {
    const [approval] = (await listApprovalRequests(db, ctx, { workflowRunIds: [run.id] })).filter(
      (a) => a.id === step.approvalId,
    );
    if (!approval || approval.status === 'pending') return;
    if (approval.status === 'rejected')
      return void (await save(node, { status: 'failed', error: 'approval_rejected' }));
    if (node.type === 'tool') {
      const config = CONFIG.tool.parse(node.config);
      const args =
        approval.editedArguments ?? (approval.payload.arguments as Record<string, unknown>) ?? {};
      return void (await executeToolStep(db, deps, ctx, node, config.toolId, args, save));
    }
    // Human approval passes the previous output along.
    return void (await save(node, {
      status: 'completed',
      output: scopeFor(graph, steps, run, node).previous,
    }));
  }
  if (step.resumeAt && step.resumeAt <= now)
    await save(node, { status: 'completed', output: step.input ?? '' });
}

/** A failed or cancelled run stops what it started: agent tasks and pending approvals. */
async function stopWaitingWork(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  runId: string,
  steps: WorkflowRunStep[],
) {
  for (const step of steps) {
    if (step.status !== 'waiting') continue;
    if (step.taskId)
      await cancelTask(db, ctx, step.taskId, { note: 'parent_cancelled' }).catch(() => undefined);
  }
  for (const id of await listPendingWorkflowApprovalIds(db, ctx, runId)) {
    await resolveApprovalRequest(db, ctx, id, {
      status: 'rejected',
      approverUserId: ctx.userId,
      editedArguments: null,
      note: 'workflow_stopped',
    });
  }
  void deps;
}

/** Runs → Cancel: the run's creator or an admin. */
export async function cancelWorkflowRun(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  runId: string,
) {
  const run = await findWorkflowRun(db, ctx, runId);
  if (!run) throw new AppError('NOT_FOUND', 'Run not found');
  await requireCreatorOrAdmin(db, ctx, run.triggeredBy);
  if (!['queued', 'running', 'waiting'].includes(run.status))
    throw new AppError('INVALID_TRANSITION', 'Run is not active');
  const steps = await listWorkflowRunSteps(db, ctx, [runId]);
  await stopWaitingWork(db, deps, ctx, runId, steps);
  await updateWorkflowRun(db, ctx, runId, { status: 'cancelled', endedAt: new Date() });
}

/** Called when an agent task finishes: wakes the workflow run that gave it, if any. */
export async function onWorkflowTaskFinished(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  taskId: string,
) {
  const step = await findWorkflowStepByTask(db, ctx, taskId);
  if (step?.status !== 'waiting') return;
  await deps.enqueueWorkflow({
    runId: step.runId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  });
}

/** Called when a workflow approval is decided: wakes the run. */
export async function onWorkflowApprovalDecided(
  db: Database,
  deps: WorkflowDeps,
  ctx: TenantContext,
  workflowRunId: string,
) {
  const run = await findWorkflowRun(db, ctx, workflowRunId);
  if (!run || !['waiting', 'queued'].includes(run.status)) return;
  await deps.enqueueWorkflow({
    runId: run.id,
    workspaceId: ctx.workspaceId,
    userId: run.triggeredBy,
  });
}
