import {
  findRun,
  listApprovalRequests,
  listAuditLogs,
  listMcpTools,
  listMessages,
  listRunsWithDetails,
  listTasks,
} from '@agentos/db';
import { startFakeMcpServer } from '@agentos/mcp-gateway/testing';
import { startFakeProvider } from '@agentos/model-gateway/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeAgentStatus,
  completeAgentSetup,
  createAgent,
  updatePersonality,
} from '../src/agents';
import { createSecretCipher } from '../src/crypto';
import { getDashboardSummary } from '../src/dashboard';
import {
  createMcpConnection,
  setAgentPermissions,
  setAgentTools,
  updateToolDefaults,
} from '../src/mcp';
import { saveAgentModelConfig, type ModelConfigInput } from '../src/models';
import { createProviderConnection } from '../src/providers';
import {
  decideApproval,
  executeRun,
  startChatTurn,
  type RunJob,
  type RuntimeDeps,
} from '../src/runtime';
import { createSecretStore } from '../src/secrets';
import { createUser, useTestDb } from './helpers';

const { db } = useTestDb();
const llm = startFakeProvider();
const mcp = startFakeMcpServer();
let llmUrl = '';
let mcpUrl = '';
beforeAll(async () => {
  llmUrl = (await llm.ready).url;
  mcpUrl = (await mcp.ready).url;
});
afterAll(async () => {
  await llm.close();
  await mcp.close();
});

const queue: RunJob[] = [];
const deps: RuntimeDeps = {
  secrets: createSecretStore(db, createSecretCipher(Buffer.alloc(32, 7).toString('base64'))),
  appUrl: 'http://localhost:3000',
  enqueueRun: async (job) => void queue.push(job),
};

/** Runs every queued job, as the worker would. */
async function drain(ctx: { workspaceId: string; userId: string }) {
  while (queue.length > 0) {
    const job = queue.shift()!;
    await executeRun(db, deps, ctx, job.runId);
  }
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup(
  options: {
    provider?: 'openai' | 'anthropic';
    budget?: ModelConfigInput['budget'];
    tools?: string[];
  } = {},
) {
  const user = await createUser(db);
  const anthropic = options.provider === 'anthropic';
  const provider = await createProviderConnection(db, deps, user.ctx, {
    provider: anthropic ? 'anthropic' : 'openai_compatible',
    name: 'LLM',
    endpoint: anthropic ? `${llmUrl}/anthropic` : `${llmUrl}/openai/v1`,
    apiKey: 'sk-test-key-for-runtime-0000000000',
  });
  await createMcpConnection(db, deps, user.ctx, {
    name: 'Workspace',
    endpoint: `${mcpUrl}/mcp`,
    transport: 'streamable_http',
    authType: 'none',
  });
  const tools = new Map((await listMcpTools(db, user.ctx)).map((t) => [t.name, t]));
  const agent = await completeAgentSetup(
    db,
    user.ctx,
    (
      await createAgent(db, user.ctx, {
        name: 'Runner',
        description: 'd',
        agentType: 'specialist',
        avatar: 'preset:bot',
        tags: [],
        parentAgentId: null,
        role: 'Research assistant',
        jobDefinition: 'Find information.',
        goals: [],
        constraints: [],
      })
    ).id,
  );
  await saveAgentModelConfig(db, user.ctx, agent.id, {
    strategy: 'fixed',
    primary: { connectionId: provider.id, model: anthropic ? 'claude-opus-5-5' : 'fake-echo' },
    routes: [],
    fallbacks: [],
    budget: options.budget ?? { onExceed: 'stop' },
  });
  const grant = options.tools ?? ['search_documents', 'gmail_send', 'flaky_tool'];
  await updateToolDefaults(db, user.ctx, tools.get('flaky_tool')!.id, {
    defaultPermission: 'AUTO_ALLOW',
  });
  await setAgentTools(
    db,
    user.ctx,
    agent.id,
    grant.map((n) => tools.get(n)!.id),
  );
  await setAgentPermissions(db, user.ctx, agent.id, {
    modes: {},
    approvalPolicy: { requireApprovalForHighRisk: true, categories: ['send_email'] },
  });
  await changeAgentStatus(db, user.ctx, agent.id, 'activate');
  return { ...user, agent, tools };
}

async function chat(s: Setup, message: string, conversationId?: string) {
  const turn = await startChatTurn(db, deps, s.ctx, s.agent.id, {
    message,
    ...(conversationId && { conversationId }),
  });
  await drain(s.ctx);
  return { ...turn, run: (await findRun(db, s.ctx, turn.runId))! };
}

const lastAssistant = async (s: Setup, conversationId: string) =>
  (await listMessages(db, s.ctx, conversationId)).filter((m) => m.role === 'assistant').at(-1)
    ?.content;

describe('chat without tools', () => {
  it('answers, saves the conversation and completes the task', async () => {
    const s = await setup();
    const { conversationId, run, taskId } = await chat(s, 'hello there');
    expect(run).toMatchObject({
      status: 'completed',
      model: 'fake-echo',
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(await lastAssistant(s, conversationId)).toBe('echo: hello there');
    expect((await listTasks(db, s.ctx)).find((t) => t.id === taskId)?.state).toBe('completed');

    // The next turn sees the history.
    const second = await chat(s, 'and again', conversationId);
    expect(second.conversationId).toBe(conversationId);
    expect((await listMessages(db, s.ctx, conversationId)).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('paused agents cannot chat', async () => {
    const s = await setup();
    await changeAgentStatus(db, s.ctx, s.agent.id, 'pause');
    await expect(
      startChatTurn(db, deps, s.ctx, s.agent.id, { message: 'hi' }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_RUNNABLE' });
  });
});

describe.each(['openai', 'anthropic'] as const)('tool loop (%s adapter)', (provider) => {
  it('calls an allowed tool, treats its output as untrusted, and answers', async () => {
    const s = await setup({ provider });
    mcp.calls.length = 0;
    const { conversationId, run } = await chat(s, 'find [[call:search:{"query":"aviation"}]]');
    expect(run.status).toBe('completed');
    expect(mcp.calls).toEqual([
      { name: 'search_documents', args: { query: 'aviation' }, path: '/mcp' },
    ]);
    expect(await lastAssistant(s, conversationId)).toContain('results for aviation');
    expect(await lastAssistant(s, conversationId)).toContain('trust="untrusted"');

    const [details] = await listRunsWithDetails(db, s.ctx, { agentId: s.agent.id });
    expect(details!.toolCalls).toEqual([
      expect.objectContaining({
        toolName: 'search_documents',
        status: 'succeeded',
        connectionName: 'Workspace',
      }),
    ]);
    expect(details!.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['model.selected', 'tool.call', 'tool.result', 'run.completed']),
    );
  });
});

describe('approvals (PRD §10)', () => {
  it('APPROVAL_REQUIRED pauses before execution, then runs once approved (AC 17, 18)', async () => {
    const s = await setup();
    mcp.calls.length = 0;
    const { run, conversationId, taskId } = await chat(
      s,
      'mail [[call:gmail_send:{"to":"a@b.c","body":"hi"}]]',
    );
    expect(run.status).toBe('waiting_approval');
    expect(mcp.calls).toEqual([]);
    expect((await listTasks(db, s.ctx)).find((t) => t.id === taskId)?.state).toBe(
      'waiting_for_approval',
    );
    const [approval] = await listApprovalRequests(db, s.ctx, { status: 'pending' });
    expect(approval).toMatchObject({
      kind: 'tool_call',
      risk: 'send_email',
      payload: { tool: 'gmail_send', server: 'Workspace', arguments: { to: 'a@b.c', body: 'hi' } },
    });

    await decideApproval(db, deps, s.ctx, approval!.id, {
      decision: 'approve',
      editedArguments: { to: 'boss@b.c', body: 'hi' },
    });
    await drain(s.ctx);
    expect(mcp.calls).toEqual([
      { name: 'gmail_send', args: { to: 'boss@b.c', body: 'hi' }, path: '/mcp' },
    ]);
    expect((await findRun(db, s.ctx, run.id))!.status).toBe('completed');
    expect(await lastAssistant(s, conversationId)).toContain('sent to boss@b.c');

    const audit = (await listAuditLogs(db, s.ctx)).find((l) => l.action === 'approval.decided');
    expect(audit).toMatchObject({
      actorUserId: s.ctx.userId,
      metadata: { decision: 'edited_and_approved', tool: 'gmail_send' },
    });
    await expect(
      decideApproval(db, deps, s.ctx, approval!.id, { decision: 'reject' }),
    ).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  it('rejected actions never run; the model is told and the run completes', async () => {
    const s = await setup();
    mcp.calls.length = 0;
    const { run, conversationId } = await chat(
      s,
      'mail [[call:gmail_send:{"to":"a@b.c","body":"hi"}]]',
    );
    const [approval] = await listApprovalRequests(db, s.ctx, { status: 'pending' });
    await decideApproval(db, deps, s.ctx, approval!.id, { decision: 'reject', note: 'not now' });
    await drain(s.ctx);
    expect(mcp.calls).toEqual([]);
    expect((await findRun(db, s.ctx, run.id))!.status).toBe('completed');
    expect(await lastAssistant(s, conversationId)).toContain('rejected this action');
  });

  it('edited arguments must match the tool schema; other workspaces cannot decide', async () => {
    const s = await setup();
    await chat(s, 'mail [[call:gmail_send:{"to":"a@b.c","body":"hi"}]]');
    const [approval] = await listApprovalRequests(db, s.ctx, { status: 'pending' });
    await expect(
      decideApproval(db, deps, s.ctx, approval!.id, {
        decision: 'approve',
        editedArguments: { to: 5 },
      }),
    ).rejects.toMatchObject({
      details: { editedArguments: ['invalid_arguments'] },
    });
    const other = await createUser(db);
    await expect(
      decideApproval(db, deps, other.ctx, approval!.id, { decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('guardrails', () => {
  it('rejects invalid arguments and unknown tools without executing anything', async () => {
    const s = await setup();
    mcp.calls.length = 0;
    const { run } = await chat(s, 'bad [[call:search:{"wrong":1}]]');
    expect(run.status).toBe('completed');
    expect(mcp.calls).toEqual([]);
    const [details] = await listRunsWithDetails(db, s.ctx, { agentId: s.agent.id });
    expect(details!.toolCalls[0]).toMatchObject({
      status: 'failed',
      decisionReason: 'invalid_arguments',
    });
  });

  it('blocked tools are never offered to the model', async () => {
    const s = await setup({ tools: ['search_documents', 'drive_delete'] });
    llm.requests.length = 0;
    await chat(s, 'hello');
    const offered = (
      llm.requests.at(-1)!.body as { tools?: { function: { name: string } }[] }
    ).tools!.map((t) => t.function.name);
    expect(offered).toEqual(['workspace__search_documents']);
  });

  it('tool failures are recorded as failures and reported to the model (AC 22)', async () => {
    const s = await setup();
    const { conversationId } = await chat(s, 'go [[call:flaky:{}]]');
    const [details] = await listRunsWithDetails(db, s.ctx, { agentId: s.agent.id });
    expect(details!.toolCalls[0]).toMatchObject({
      toolName: 'flaky_tool',
      status: 'failed',
      result: 'upstream API error',
    });
    expect(await lastAssistant(s, conversationId)).toContain('Error:');
  });

  it('the provider API key never appears in what the model receives (AC 12)', async () => {
    const s = await setup();
    llm.requests.length = 0;
    await chat(s, 'find [[call:search:{"query":"x"}]]');
    expect(JSON.stringify(llm.requests.map((r) => r.body))).not.toContain(
      'sk-test-key-for-runtime',
    );
  });

  it('a run executes at most once even if its job is delivered twice', async () => {
    const s = await setup();
    const turn = await startChatTurn(db, deps, s.ctx, s.agent.id, { message: 'once' });
    queue.length = 0;
    await executeRun(db, deps, s.ctx, turn.runId);
    await executeRun(db, deps, s.ctx, turn.runId);
    expect(
      (await listMessages(db, s.ctx, turn.conversationId)).filter((m) => m.role === 'assistant'),
    ).toHaveLength(1);
  });
});

describe('budgets (PRD §18, AC 24)', () => {
  it('stops when the tool-call limit is reached', async () => {
    const s = await setup({ budget: { maxToolCalls: 1, onExceed: 'stop' } });
    const { run } = await chat(s, 'find [[call:search:{"query":"x"}]]');
    expect(run).toMatchObject({ status: 'failed', error: 'budget_max_tool_calls' });
  });

  it('asks for approval when configured, then continues', async () => {
    const s = await setup({ budget: { maxToolCalls: 1, onExceed: 'request_approval' } });
    const { run } = await chat(s, 'find [[call:search:{"query":"x"}]]');
    expect(run.status).toBe('waiting_approval');
    const [approval] = await listApprovalRequests(db, s.ctx, { status: 'pending' });
    expect(approval).toMatchObject({
      kind: 'budget',
      payload: { kind: 'max_tool_calls', limit: 1 },
    });
    await decideApproval(db, deps, s.ctx, approval!.id, { decision: 'approve' });
    await drain(s.ctx);
    expect((await findRun(db, s.ctx, run.id))!.status).toBe('completed');
  });

  it('enforces per-task cost using published prices', async () => {
    // claude-opus-5-5 at $4/$20 per MTok: one fake call (100 in, 20 out) costs $0.0008.
    // With room for one call, the second exceeds the limit.
    const s = await setup({
      provider: 'anthropic',
      budget: { perTaskUsd: 0.025, onExceed: 'stop' },
    });
    await chat(s, 'warm up');
    llm.requests.length = 0;
    const tight = await setup({
      provider: 'anthropic',
      budget: { perTaskUsd: 0.0005, onExceed: 'stop' },
    });
    const { run } = await chat(tight, 'find [[call:search:{"query":"x"}]]');
    // The estimate for the first call (up to 1,000 output tokens) already exceeds $0.0005,
    // so no model is called at all.
    expect(run).toMatchObject({ status: 'failed', error: 'budget_per_task' });
    expect(llm.requests.filter((r) => r.path.includes('/messages'))).toHaveLength(0);

    const ok = await chat(s, 'hello');
    expect(ok.run).toMatchObject({ status: 'completed' });
    expect(ok.run.costUsd).toBeCloseTo(0.0008);
  });
});

describe('dashboard', () => {
  it('counts waiting tasks as running work and charts finished tasks', async () => {
    const s = await setup();
    await chat(s, 'hi');
    await chat(s, 'mail [[call:gmail_send:{"to":"a@b.c","body":"hi"}]]');
    const summary = await getDashboardSummary(db, s.ctx);
    expect(summary.tasks.running).toBe(1);
    expect(summary.taskOverview.at(-1)!.completed).toBe(1);
    expect(summary.successRate).toBe(1);
  });
});

describe('personality reaches the runtime context (AC 5)', () => {
  it('opposite personalities send different directives to the model', async () => {
    const s = await setup();
    await updatePersonality(db, s.ctx, s.agent.id, { traits: { concise: 95, skeptical: 95 } });
    llm.requests.length = 0;
    await chat(s, 'hi');
    const terse = (llm.requests.at(-1)!.body as { messages: { role: string; content: string }[] })
      .messages[0]!.content;
    await updatePersonality(db, s.ctx, s.agent.id, {
      traits: { concise: 5, detailed: 95, skeptical: 5 },
    });
    await chat(s, 'hi');
    const verbose = (llm.requests.at(-1)!.body as { messages: { role: string; content: string }[] })
      .messages[0]!.content;
    expect(terse).toContain('Keep responses short');
    expect(terse).toContain('Verify claims');
    expect(verbose).toContain('Be thorough');
    expect(verbose).toContain('Take provided information at face value');
  });
});
