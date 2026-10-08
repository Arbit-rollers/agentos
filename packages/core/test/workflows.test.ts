import {
  addWorkspaceMember,
  findWorkflowRun,
  listApprovalRequests,
  listMcpTools,
  listProviderConnections,
  listWorkflowRunSteps,
  listWorkflowVersions,
  type WorkflowGraph,
  type WorkflowNode,
} from '@agentos/db';
import { describe, expect, it } from 'vitest';
import { updateToolDefaults } from '../src/mcp';
import { decideApproval } from '../src/runtime';
import { createSchedule, fireSchedule } from '../src/schedules';
import {
  cancelWorkflowRun,
  createWorkflow,
  evaluateCondition,
  renderTemplate,
  restoreWorkflowVersion,
  saveWorkflow,
  setWorkflowActive,
  startWorkflowRun,
  validateWorkflowGraph,
} from '../src/workflows';
import { createUser } from './helpers';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();
type Ctx = { workspaceId: string; userId: string };
const scheduler = { upsert: async () => {}, remove: async () => {}, list: async () => [] };

let y = 0;
const node = (
  id: string,
  type: WorkflowNode['type'],
  config: Record<string, unknown>,
  label = id,
): WorkflowNode => ({
  id,
  type,
  label,
  position: { x: 0, y: (y += 100) },
  config,
});
const edge = (source: string, target: string, branch?: 'true' | 'false') => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(branch && { branch }),
});
const chain = (...nodes: WorkflowNode[]): WorkflowGraph => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => edge(nodes[i]!.id, n.id)),
});

/** Creates, saves and (optionally) activates a workflow, then starts a run and drains it. */
async function execute(
  ctx: Ctx,
  graph: WorkflowGraph,
  input = 'aviation',
  options: { trigger?: 'test' | 'manual' } = {},
) {
  const workflow = await createWorkflow(fx.db, ctx, { name: 'Flow' });
  const saved = await saveWorkflow(fx.db, ctx, workflow.id, { name: 'Flow', graph });
  expect(saved.issues).toEqual([]);
  if (options.trigger === 'manual') await setWorkflowActive(fx.db, ctx, workflow.id, true);
  const started = await startWorkflowRun(fx.db, fx.deps, ctx, workflow.id, {
    input,
    trigger: options.trigger ?? 'test',
  });
  await fx.drain(ctx);
  const steps = await listWorkflowRunSteps(fx.db, ctx, [started.id]);
  return {
    workflow,
    run: (await findWorkflowRun(fx.db, ctx, started.id))!,
    step: (id: string) => steps.find((s) => s.nodeId === id),
  };
}

describe('workflow templates and conditions', () => {
  it('fills input, previous and named steps; nothing else', () => {
    expect(
      renderTemplate(
        '{{input}} / {{previous}} / {{ steps.research }} / {{steps.missing}} / {{constructor}}',
        {
          input: 'in',
          previous: 'prev',
          steps: { Research: 'found' },
        },
      ),
    ).toBe('in / prev / found /  / ');
  });
  it('evaluates conditions', () => {
    expect(evaluateCondition({ subject: '', operator: 'contains', value: 'OK' }, 'all ok')).toBe(
      true,
    );
    expect(evaluateCondition({ subject: '', operator: 'equals', value: ' yes ' }, 'YES')).toBe(
      true,
    );
    expect(evaluateCondition({ subject: '', operator: 'matches', value: '^\\d+$' }, '42')).toBe(
      true,
    );
    expect(evaluateCondition({ subject: '', operator: 'matches', value: '(' }, 'x')).toBe(false);
    expect(evaluateCondition({ subject: '', operator: 'not_empty', value: '' }, '  ')).toBe(false);
  });
});

describe('workflow validation', () => {
  it('reports what keeps a graph from running', async () => {
    const { ctx } = await fx.setup();
    const codes = async (graph: WorkflowGraph) =>
      (await validateWorkflowGraph(fx.db, ctx, graph)).map((i) => i.code);
    expect(await codes({ nodes: [], edges: [] })).toEqual(['workflow_empty']);
    const a = node('a', 'transform', { template: 'x' }, 'A');
    const b = node('b', 'transform', { template: 'y' }, 'B');
    expect(await codes({ nodes: [a, b], edges: [edge('a', 'b'), edge('b', 'a')] })).toEqual(
      expect.arrayContaining(['no_start_step', 'workflow_cycle']),
    );
    expect(await codes({ nodes: [a, b], edges: [] })).toContain('several_start_steps');
    expect(await codes(chain(a, node('c', 'transform', { template: 'z' }, 'a')))).toContain(
      'step_name_taken',
    );
    const cond = node('c', 'condition', { operator: 'contains', value: 'x' }, 'Check');
    expect(await codes(chain(a, cond, b))).toContain('condition_branches');
    expect(await codes(chain(node('o', 'output', {}, 'Out'), b))).toContain('output_is_last');
    expect(
      await codes(
        chain(a, node('g', 'agent', { agentId: '00000000-0000-4000-8000-000000000000' }, 'Agent')),
      ),
    ).toContain('agent_required');
    expect(await codes(chain(a, node('d', 'delay', { minutes: 0 }, 'Wait')))).toContain(
      'step_settings_invalid',
    );
  });
});

describe('running workflows (PRD §16, AC 25)', () => {
  it('runs transform → agent → condition branches → output, skipping the branch not taken', async () => {
    const { ctx, agent } = await fx.setup();
    const graph: WorkflowGraph = {
      nodes: [
        node('topic', 'transform', { template: 'Topic: {{input}}' }, 'Topic'),
        node(
          'research',
          'agent',
          { agentId: agent.id, prompt: 'Research {{previous}}' },
          'Research',
        ),
        node(
          'check',
          'condition',
          { subject: '{{steps.Research}}', operator: 'contains', value: 'aviation' },
          'Check',
        ),
        node('yes', 'output', { template: 'OK: {{steps.Research}}' }, 'Yes'),
        node('no', 'output', { template: 'NO' }, 'No'),
      ],
      edges: [
        edge('topic', 'research'),
        edge('research', 'check'),
        edge('check', 'yes', 'true'),
        edge('check', 'no', 'false'),
      ],
    };
    const { run, step } = await execute(ctx, graph);
    expect(run.status).toBe('completed');
    expect(run.output).toBe('OK: echo: Task: Research\n\nDetails:\nResearch Topic: aviation');
    expect(step('research')).toMatchObject({
      status: 'completed',
      input: 'Research Topic: aviation',
    });
    expect(step('check')!.output).toBe('true');
    expect(step('no')!.status).toBe('skipped');
  });

  it('calls an allowed tool and a model directly', async () => {
    const { ctx, tools } = await fx.setup();
    const [connection] = await listProviderConnections(fx.db, ctx);
    const { run } = await execute(
      ctx,
      chain(
        node(
          'search',
          'tool',
          { toolId: tools.get('search_documents')!.id, arguments: { query: '{{input}}' } },
          'Search',
        ),
        node(
          'ask',
          'model',
          { connectionId: connection!.id, model: 'fake-echo', prompt: 'Summarise {{previous}}' },
          'Ask',
        ),
      ),
    );
    expect(run).toMatchObject({
      status: 'completed',
      output: 'echo: Summarise results for aviation',
    });
  });

  it('waits for a person at an approval step; approve continues, reject fails the run', async () => {
    const { ctx } = await fx.setup();
    const graph = chain(
      node('draft', 'transform', { template: 'Draft about {{input}}' }, 'Draft'),
      node('ok', 'approval', { message: 'Publish this? {{previous}}' }, 'Review'),
      node('out', 'output', { template: 'Published: {{previous}}' }, 'Out'),
    );
    const first = await execute(ctx, graph);
    expect(first.run.status).toBe('waiting');
    const [approval] = await listApprovalRequests(fx.db, ctx, { status: 'pending' });
    expect(approval).toMatchObject({
      kind: 'workflow_approval',
      agentName: 'Flow',
      payload: { message: 'Publish this? Draft about aviation' },
    });
    await decideApproval(fx.db, fx.deps, ctx, approval!.id, { decision: 'approve' });
    await fx.drain(ctx);
    expect(await findWorkflowRun(fx.db, ctx, first.run.id)).toMatchObject({
      status: 'completed',
      output: 'Published: Draft about aviation',
    });

    const second = await execute(ctx, graph);
    const [next] = await listApprovalRequests(fx.db, ctx, { status: 'pending' });
    await decideApproval(fx.db, fx.deps, ctx, next!.id, { decision: 'reject' });
    await fx.drain(ctx);
    expect(await findWorkflowRun(fx.db, ctx, second.run.id)).toMatchObject({
      status: 'failed',
      error: 'approval_rejected',
    });
  });

  it('an approval-required tool asks first and runs with the approved (edited) arguments', async () => {
    const { ctx, tools } = await fx.setup();
    const { run } = await execute(
      ctx,
      chain(
        node(
          'send',
          'tool',
          {
            toolId: tools.get('gmail_send')!.id,
            arguments: { to: 'a@example.com', body: '{{input}}' },
          },
          'Send',
        ),
      ),
    );
    expect(run.status).toBe('waiting');
    const [approval] = await listApprovalRequests(fx.db, ctx, { status: 'pending' });
    expect(approval).toMatchObject({
      kind: 'workflow_tool',
      payload: { tool: 'gmail_send', arguments: { to: 'a@example.com', body: 'aviation' } },
    });
    await decideApproval(fx.db, fx.deps, ctx, approval!.id, {
      decision: 'approve',
      editedArguments: { to: 'boss@example.com', body: 'aviation' },
    });
    await fx.drain(ctx);
    expect(await findWorkflowRun(fx.db, ctx, run.id)).toMatchObject({
      status: 'completed',
      output: 'sent to boss@example.com',
    });
  });

  it('a delay waits on the worker until its time', async () => {
    const { ctx } = await fx.setup();
    const { run } = await execute(
      ctx,
      chain(node('wait', 'delay', { minutes: 60 }, 'Wait'), node('out', 'output', {}, 'Out')),
    );
    expect(run.status).toBe('waiting');
    await fx.drain(ctx, { delays: true, now: new Date(Date.now() + 61 * 60_000) });
    expect(await findWorkflowRun(fx.db, ctx, run.id)).toMatchObject({
      status: 'completed',
      output: 'aviation',
    });
  });

  it('a failing step fails the run; cancelling stops waiting work', async () => {
    const { ctx, tools } = await fx.setup();
    const [flaky] = (await listMcpTools(fx.db, ctx)).filter((t) => t.name === 'flaky_tool');
    await updateToolDefaults(fx.db, ctx, flaky!.id, { defaultPermission: 'AUTO_ALLOW' });
    const failed = await execute(
      ctx,
      chain(
        node('f', 'tool', { toolId: flaky!.id, arguments: {} }, 'Flaky'),
        node('out', 'output', {}, 'Out'),
      ),
    );
    expect(failed.run).toMatchObject({ status: 'failed', error: 'tool_error' });
    expect(failed.step('out')).toBeUndefined();

    const waiting = await execute(
      ctx,
      chain(
        node(
          'send',
          'tool',
          { toolId: tools.get('gmail_send')!.id, arguments: { to: 'a@example.com', body: 'x' } },
          'Send',
        ),
      ),
    );
    await cancelWorkflowRun(fx.db, fx.deps, ctx, waiting.run.id);
    expect(await findWorkflowRun(fx.db, ctx, waiting.run.id)).toMatchObject({
      status: 'cancelled',
    });
    expect(await listApprovalRequests(fx.db, ctx, { status: 'pending' })).toHaveLength(0);
  });
});

describe('versions, activation, schedules and permissions', () => {
  it('every save is a version; only valid workflows activate; manual runs need activation', async () => {
    const { ctx } = await fx.setup();
    const workflow = await createWorkflow(fx.db, ctx, { name: 'Weekly' });
    const good = chain(node('out', 'output', { template: 'v2' }, 'Out'));
    await saveWorkflow(fx.db, ctx, workflow.id, { name: 'Weekly', graph: good });
    const draft = await saveWorkflow(fx.db, ctx, workflow.id, {
      name: 'Weekly',
      graph: { nodes: [], edges: [] },
    });
    expect(draft).toMatchObject({ version: 3, issues: [{ code: 'workflow_empty' }] });
    await expect(setWorkflowActive(fx.db, ctx, workflow.id, true)).rejects.toMatchObject({
      details: { graph: ['workflow_empty'] },
    });
    await expect(
      startWorkflowRun(fx.db, fx.deps, ctx, workflow.id, { trigger: 'manual' }),
    ).rejects.toMatchObject({
      details: { workflow: ['workflow_inactive'] },
    });

    const versions = await listWorkflowVersions(fx.db, ctx, workflow.id);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    const restored = await restoreWorkflowVersion(fx.db, ctx, workflow.id, versions[1]!.id);
    expect(restored.version).toBe(4);
    await setWorkflowActive(fx.db, ctx, workflow.id, true);
    // An active workflow can't be saved broken.
    await expect(
      saveWorkflow(fx.db, ctx, workflow.id, { name: 'Weekly', graph: { nodes: [], edges: [] } }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const done = await execute(ctx, good, 'x', { trigger: 'manual' });
    expect(done.run).toMatchObject({ status: 'completed', output: 'v2', trigger: 'manual' });
  });

  it('a schedule starts an active workflow as its creator, and skips an inactive one', async () => {
    const { ctx } = await fx.setup();
    const workflow = await createWorkflow(fx.db, ctx, { name: 'Daily digest' });
    await saveWorkflow(fx.db, ctx, workflow.id, {
      name: 'Daily digest',
      graph: chain(node('out', 'output', { template: 'Digest {{input}}' }, 'Out')),
    });
    const schedule = await createSchedule(fx.db, { ...fx.deps, scheduler }, ctx, {
      workflowId: workflow.id,
      name: 'Every morning',
      input: 'news',
      kind: 'recurring',
      cron: '0 8 * * *',
      timezone: 'UTC',
    });
    expect(await fireSchedule(fx.db, { ...fx.deps, scheduler }, ctx, schedule.id)).toBeNull();
    await setWorkflowActive(fx.db, ctx, workflow.id, true);
    const started = await fireSchedule(fx.db, { ...fx.deps, scheduler }, ctx, schedule.id);
    await fx.drain(ctx);
    expect(await findWorkflowRun(fx.db, ctx, (started as { id: string }).id)).toMatchObject({
      status: 'completed',
      trigger: 'schedule',
      triggeredBy: ctx.userId,
      output: 'Digest news',
    });
  });

  it("members can't change or run someone else's workflow", async () => {
    const { ctx } = await fx.setup();
    const other = await createUser(fx.db);
    await addWorkspaceMember(fx.db, {
      workspaceId: ctx.workspaceId,
      userId: other.ctx.userId,
      role: 'member',
    });
    const member = { workspaceId: ctx.workspaceId, userId: other.ctx.userId };
    const workflow = await createWorkflow(fx.db, ctx, { name: 'Mine' });
    await expect(
      saveWorkflow(fx.db, member, workflow.id, { name: 'X', graph: { nodes: [], edges: [] } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      startWorkflowRun(fx.db, fx.deps, member, workflow.id, { trigger: 'test' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createWorkflow(fx.db, member, { name: 'Theirs' })).resolves.toMatchObject({
      createdBy: member.userId,
    });
  });
});
