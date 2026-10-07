import {
  claimRun,
  findRun,
  findTask,
  listApprovalRequests,
  listRunsWithDetails,
  listTaskHistory,
  updateRun,
} from '@agentos/db';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { cancelTask, createTask, recoverStaleRuns, retryDelayMs, retryTask } from '../src/tasks';
import { useAgentFixture } from './agent-fixture';
import { createUser } from './helpers';

const { db, sql, mcp, queue, deps, drain, setup } = useAgentFixture();

const states = async (ctx: { workspaceId: string; userId: string }, id: string) =>
  (await listTaskHistory(db, ctx, id)).map((h) => h.state);

describe('manual tasks (PRD §14)', () => {
  it('runs a task to completion, stores the output and the state history', async () => {
    const s = await setup();
    const task = await createTask(db, deps, s.ctx, {
      agentId: s.agent.id,
      objective: 'Summarize trends',
      input: 'Focus on 2026',
    });
    await drain(s.ctx);
    const done = (await findTask(db, s.ctx, task.id))!;
    expect(done).toMatchObject({
      state: 'completed',
      origin: 'manual',
      output: expect.stringContaining('Task: Summarize trends'),
    });
    expect(done.output).toContain('Focus on 2026');
    expect(await states(s.ctx, task.id)).toEqual(['queued', 'running', 'completed']);
  });

  it('uses tools in task runs and pauses for approval like chat', async () => {
    const s = await setup();
    mcp.calls.length = 0;
    const task = await createTask(db, deps, s.ctx, {
      agentId: s.agent.id,
      objective: 'Send [[call:gmail_send:{"to":"a@b.c","body":"x"}]]',
    });
    await drain(s.ctx);
    expect((await findTask(db, s.ctx, task.id))!.state).toBe('waiting_for_approval');
    expect(mcp.calls).toEqual([]);
  });

  it('waits for dependencies, then starts; a failed dependency fails dependents', async () => {
    const s = await setup();
    const first = await createTask(db, deps, s.ctx, { agentId: s.agent.id, objective: 'Research' });
    const second = await createTask(db, deps, s.ctx, {
      agentId: s.agent.id,
      objective: 'Write script',
      dependsOn: [first.id],
    });
    expect(queue).toHaveLength(1); // only the first started
    await drain(s.ctx);
    expect((await findTask(db, s.ctx, second.id))!.state).toBe('completed');

    const broken = await setup({ model: 'fake-down' });
    const a = await createTask(db, deps, broken.ctx, { agentId: broken.agent.id, objective: 'A' });
    const b = await createTask(db, deps, broken.ctx, {
      agentId: broken.agent.id,
      objective: 'B',
      dependsOn: [a.id],
    });
    await drain(broken.ctx);
    expect(await findTask(db, broken.ctx, b.id)).toMatchObject({
      state: 'failed',
      error: 'dependency_failed',
    });
  });

  it('rejects dependencies from another workspace', async () => {
    const s = await setup();
    const other = await createUser(db);
    const foreign = await createTask(db, deps, s.ctx, { agentId: s.agent.id, objective: 'mine' });
    await expect(
      createTask(db, deps, other.ctx, {
        agentId: s.agent.id,
        objective: 'x',
        dependsOn: [foreign.id],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('retries and failures', () => {
  it('retries transient provider failures with growing delays, then fails with the error', async () => {
    const s = await setup({ model: 'fake-down' });
    const task = await createTask(db, deps, s.ctx, {
      agentId: s.agent.id,
      objective: 'Flaky provider',
      maxRetries: 2,
    });
    const delays: number[] = [];
    while (queue.length > 0) {
      const job = queue.shift()!;
      delays.push(job.delayMs);
      await (await import('../src/runtime')).executeRun(db, deps, s.ctx, job.runId);
    }
    expect(delays).toEqual([0, retryDelayMs(1), retryDelayMs(2)]);
    expect(await findTask(db, s.ctx, task.id)).toMatchObject({
      state: 'failed',
      error: 'provider_unavailable',
      attempt: 2,
    });
    const history = await listTaskHistory(db, s.ctx, task.id);
    expect(history.map((h) => h.note).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'retry_1:provider_unavailable',
        'retry_2:provider_unavailable',
        'provider_unavailable',
      ]),
    );
  });

  it('manual retry runs a failed task again', async () => {
    const s = await setup({ budget: { maxToolCalls: 0, onExceed: 'stop' } });
    const task = await createTask(db, deps, s.ctx, { agentId: s.agent.id, objective: 'x' });
    await drain(s.ctx);
    expect((await findTask(db, s.ctx, task.id))!.error).toBe('budget_max_tool_calls');
    await sql`update model_configs set budget_policy = '{"onExceed":"stop"}' where agent_id = ${s.agent.id}`;
    await retryTask(db, deps, s.ctx, task.id);
    await drain(s.ctx);
    expect(await findTask(db, s.ctx, task.id)).toMatchObject({
      state: 'completed',
      attempt: 1,
      error: null,
    });
  });
});

describe('cancellation', () => {
  it('cancels the run, rejects pending approvals, and refuses to cancel twice', async () => {
    const s = await setup();
    const task = await createTask(db, deps, s.ctx, {
      agentId: s.agent.id,
      objective: 'Send [[call:gmail_send:{"to":"a@b.c","body":"x"}]]',
    });
    await drain(s.ctx);
    await cancelTask(db, s.ctx, task.id);
    const [run] = await listRunsWithDetails(db, s.ctx, { taskId: task.id });
    expect(run!.status).toBe('cancelled');
    expect((await listApprovalRequests(db, s.ctx, { runIds: [run!.id] }))[0]).toMatchObject({
      status: 'rejected',
      note: 'task_cancelled',
    });
    expect((await findTask(db, s.ctx, task.id))!.state).toBe('cancelled');
    await expect(cancelTask(db, s.ctx, task.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('a cancelled queued run never executes', async () => {
    const s = await setup();
    const task = await createTask(db, deps, s.ctx, { agentId: s.agent.id, objective: 'never' });
    await cancelTask(db, s.ctx, task.id);
    await drain(s.ctx);
    const [run] = await listRunsWithDetails(db, s.ctx, { taskId: task.id });
    expect(run).toMatchObject({ status: 'cancelled', model: null });
  });
});

describe('crash recovery', () => {
  async function crashedRun(s: Awaited<ReturnType<typeof setup>>, recordedResult: boolean) {
    const task = await createTask(db, deps, s.ctx, {
      agentId: s.agent.id,
      objective: 'interrupted work',
    });
    queue.length = 0;
    const [run] = await listRunsWithDetails(db, s.ctx, { taskId: task.id });
    // The worker claimed the run, the model asked for a tool, then the process died.
    await claimRun(db, s.ctx, run!.id, ['queued']);
    const alias = 'workspace__search_documents';
    await updateRun(db, s.ctx, run!.id, {
      state: {
        messages: [
          { role: 'user', content: 'Task: interrupted work' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_dead', name: alias, arguments: { query: 'x' } }],
          },
        ],
        aliases: { [alias]: s.tools.get('search_documents')!.id },
        startedAt: new Date().toISOString(),
        modelCalls: 1,
        budgetOverrides: [],
      },
    });
    await sql`update runs set heartbeat_at = now() - interval '10 minutes' where id = ${run!.id}`;
    if (recordedResult) {
      await sql`insert into tool_calls (workspace_id, run_id, agent_id, tool_id, tool_name, provider_call_id, arguments, status, result, finished_at)
                values (${s.ctx.workspaceId}, ${run!.id}, ${s.agent.id}, ${s.tools.get('search_documents')!.id}, 'search_documents', 'call_dead', '{"query":"x"}', 'succeeded', 'results for x', now())`;
    }
    return { task, runId: run!.id };
  }

  it('re-queues runs whose worker died and reports cut-off tool calls as interrupted', async () => {
    const s = await setup();
    const { task, runId } = await crashedRun(s, false);
    expect(await recoverStaleRuns(db, deps)).toBeGreaterThanOrEqual(1);
    await drain(s.ctx);
    expect((await findRun(db, s.ctx, runId))!.status).toBe('completed');
    expect((await findTask(db, s.ctx, task.id))!.output).toContain('interrupted by a restart');
  });

  it('keeps results that were recorded before the crash', async () => {
    const s = await setup();
    const { task } = await crashedRun(s, true);
    await recoverStaleRuns(db, deps);
    await drain(s.ctx);
    expect((await findTask(db, s.ctx, task.id))!.output).toContain('results for x');
  });

  it('leaves runs with a fresh heartbeat alone', async () => {
    const s = await setup();
    const task = await createTask(db, deps, s.ctx, { agentId: s.agent.id, objective: 'busy' });
    queue.length = 0;
    const [run] = await listRunsWithDetails(db, s.ctx, { taskId: task.id });
    await claimRun(db, s.ctx, run!.id, ['queued']);
    await sql`update runs set heartbeat_at = now() where id = ${run!.id}`;
    await recoverStaleRuns(db, deps);
    expect(queue.filter((j) => j.runId === run!.id)).toHaveLength(0);
  });
});
