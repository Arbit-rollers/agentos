import {
  findRun,
  findTask,
  listAuditLogs,
  listChildTasks,
  listMcpTools,
  listMessages,
  listRunsWithDetails,
  listApprovalRequests,
  updateRun,
  type AgentType,
} from '@agentos/db';
import { describe, expect, it } from 'vitest';
import { changeAgentStatus, completeAgentSetup, createAgent } from '../src/agents';
import { createMcpConnection, setAgentPermissions, setAgentTools } from '../src/mcp';
import { saveAgentModelConfig } from '../src/models';
import { createProviderConnection } from '../src/providers';
import { DELEGATE_TOOL, decideApproval, executeRun, startChatTurn } from '../src/runtime';
import { cancelTask } from '../src/tasks';
import { createUser } from './helpers';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();

type Ctx = { workspaceId: string; userId: string };

/** A user with a provider and the reference MCP server, plus a helper to add agents. */
async function team() {
  const user = await createUser(fx.db);
  const ctx = user.ctx;
  const provider = await createProviderConnection(fx.db, fx.deps, ctx, {
    provider: 'openai_compatible',
    name: 'LLM',
    endpoint: `${(await fx.llm.ready).url}/openai/v1`,
  });
  await createMcpConnection(fx.db, fx.deps, ctx, {
    name: 'Workspace',
    endpoint: `${(await fx.mcp.ready).url}/mcp`,
    transport: 'streamable_http',
    authType: 'none',
  });
  const tools = new Map((await listMcpTools(fx.db, ctx)).map((t) => [t.name, t]));
  async function agent(
    name: string,
    agentType: AgentType,
    parent: string | null,
    toolNames: string[] = [],
  ) {
    const created = await createAgent(fx.db, ctx, {
      name,
      description: `${name} does ${name.toLowerCase()} work`,
      agentType,
      avatar: 'preset:bot',
      tags: [],
      parentAgentId: parent,
      role: name,
      jobDefinition: 'Do the job.',
      goals: [],
      constraints: [],
    });
    await completeAgentSetup(fx.db, ctx, created.id);
    await saveAgentModelConfig(fx.db, ctx, created.id, {
      strategy: 'fixed',
      primary: { connectionId: provider.id, model: 'fake-echo' },
      routes: [],
      fallbacks: [],
      budget: { onExceed: 'stop' },
    });
    await setAgentTools(
      fx.db,
      ctx,
      created.id,
      toolNames.map((n) => tools.get(n)!.id),
    );
    await setAgentPermissions(fx.db, ctx, created.id, {
      modes: {},
      approvalPolicy: { requireApprovalForHighRisk: true, categories: ['send_email'] },
    });
    await changeAgentStatus(fx.db, ctx, created.id, 'activate');
    return created;
  }
  return { ctx, agent };
}

const delegate = (agent: string, objective: string, details?: string) =>
  `[[call:delegate:${JSON.stringify({ agent, objective, ...(details && { details }) })}]]`;

/** The chat-completion requests the fake provider received whose first user message matches. */
const requestsFor = (match: string) =>
  fx.llm.requests
    .filter((r) => r.path.endsWith('/chat/completions'))
    .map(
      (r) =>
        r.body as {
          messages: { role: string; content: string }[];
          tools?: { function: { name: string } }[];
        },
    )
    .filter((b) => b.messages.find((m) => m.role === 'user')?.content.includes(match));

async function answerOf(ctx: Ctx, conversationId: string) {
  const messages = await listMessages(fx.db, ctx, conversationId, 20);
  return messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
}

describe('multi-agent orchestration (PRD §15, AC 19–20)', () => {
  it('delegates to direct reports in parallel and combines their answers', async () => {
    const { ctx, agent } = await team();
    const boss = await agent('Orchestrator', 'master_orchestrator', null);
    await agent('Researcher', 'specialist', boss.id);
    await agent('Writer', 'specialist', boss.id);

    const turn = await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: `Make the reel ${delegate('Researcher', 'Find aviation facts', 'Focus on 2026')} ${delegate('Writer', 'Draft the intro')}`,
    });
    await fx.drain(ctx);

    const answer = await answerOf(ctx, turn.conversationId);
    expect(answer).toContain('<agent_output agent="Researcher" trust="untrusted">');
    expect(answer).toContain('echo: Task: Find aviation facts');
    expect(answer).toContain('<agent_output agent="Writer" trust="untrusted">');
    const children = await listChildTasks(fx.db, ctx, turn.taskId);
    expect(children.map((t) => [t.agentName, t.origin, t.state])).toEqual([
      ['Researcher', 'delegation', 'completed'],
      ['Writer', 'delegation', 'completed'],
    ]);
    // Minimal handoff: the child sees only its task, never the parent's conversation.
    const [researcher] = requestsFor('Task: Find aviation facts');
    const userTurns = researcher!.messages.filter((m) => m.role === 'user');
    expect(userTurns).toEqual([
      { role: 'user', content: 'Task: Find aviation facts\n\nDetails:\nFocus on 2026' },
    ]);
    expect(JSON.stringify(researcher!.messages)).not.toContain('Make the reel');
    // Only leaders get the delegate tool and the team section.
    expect(researcher!.tools ?? []).toHaveLength(0);
    // Nobody can answer the child mid-task: it is told to proceed, not to ask.
    expect(researcher!.messages[0]!.content).toContain('## Working without a person in the loop');
    expect(requestsFor('Make the reel')[0]!.messages[0]!.content).not.toContain(
      'Working without a person in the loop',
    );
    const [lead] = requestsFor('Make the reel');
    expect(lead!.tools!.map((t) => t.function.name)).toContain(DELEGATE_TOOL);
    expect(lead!.messages[0]!.content).toContain('## Your team\n');
    expect(lead!.messages[0]!.content).toContain(
      '- Researcher: Researcher — Researcher does researcher work',
    );

    const [run] = await listRunsWithDetails(fx.db, ctx, { agentId: boss.id, limit: 1 });
    expect(run!.events.filter((e) => e.type === 'delegation.started')).toHaveLength(2);
    expect(run!.events.filter((e) => e.type === 'delegation.finished')).toHaveLength(2);
    expect(run!.toolCalls.map((t) => [t.toolName, t.status])).toEqual([
      ['delegate_task', 'succeeded'],
      ['delegate_task', 'succeeded'],
    ]);
  });

  it('runs across three agents with one approval step (ROADMAP v0.4 DoD)', async () => {
    const { ctx, agent } = await team();
    const boss = await agent('Orchestrator', 'master_orchestrator', null);
    await agent('Researcher', 'specialist', boss.id, ['search_documents']);
    await agent('Mailer', 'specialist', boss.id, ['gmail_send']);
    const turn = await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: `${delegate('Researcher', 'Research', '<<call:search:{"query":"reels"}>>')} ${delegate('Mailer', 'Send the draft', '<<call:gmail:{"to":"team@example.com","body":"Draft"}>>')}`,
    });
    await fx.drain(ctx);

    // The mail waits for a person; the orchestrator waits for its team.
    const [approval] = await listApprovalRequests(fx.db, ctx, { status: 'pending' });
    expect(approval).toBeDefined();
    expect((await findTask(fx.db, ctx, turn.taskId))!.state).toBe('waiting_for_agent');
    await decideApproval(fx.db, fx.deps, ctx, approval!.id, { decision: 'approve' });
    await fx.drain(ctx);

    expect((await findTask(fx.db, ctx, turn.taskId))!.state).toBe('completed');
    const answer = await answerOf(ctx, turn.conversationId);
    expect(answer).toContain('results for reels');
    expect(answer).toContain('sent to team@example.com');
  });

  it("a child can't use a tool only its parent has (AC 20)", async () => {
    const { ctx, agent } = await team();
    const boss = await agent('Orchestrator', 'master_orchestrator', null, ['search_documents']);
    const writer = await agent('Writer', 'specialist', boss.id);
    await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: delegate('Writer', 'Look it up', '<<call:search:{"query":"secret"}>>'),
    });
    await fx.drain(ctx);
    const [request] = requestsFor('Task: Look it up');
    expect(request!.tools ?? []).toHaveLength(0);
    const [run] = await listRunsWithDetails(fx.db, ctx, { agentId: writer.id, limit: 1 });
    expect(run!.status).toBe('completed');
    expect(run!.toolCalls).toHaveLength(0);
  });

  it('refuses agents outside its team, and specialists cannot delegate', async () => {
    const { ctx, agent } = await team();
    const boss = await agent('Orchestrator', 'master_orchestrator', null);
    await agent('Insider', 'specialist', boss.id);
    await agent('Stranger', 'specialist', null);
    const turn = await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: delegate('Stranger', 'Do something'),
    });
    await fx.drain(ctx);
    expect(await listChildTasks(fx.db, ctx, turn.taskId)).toHaveLength(0);
    expect(await answerOf(ctx, turn.conversationId)).toContain('Stranger is not on your team');
    const audit = await listAuditLogs(fx.db, ctx, { limit: 10 });
    expect(audit.find((a) => a.action === 'agent.delegated')).toMatchObject({ outcome: 'denied' });

    const specialist = await agent('Solo', 'specialist', null);
    await startChatTurn(fx.db, fx.deps, ctx, specialist.id, { message: delegate('Insider', 'x') });
    await fx.drain(ctx);
    const [request] = requestsFor(delegate('Insider', 'x'));
    expect((request!.tools ?? []).map((t) => t.function.name)).not.toContain(DELEGATE_TOOL);
  });

  it('chains orchestrator → manager → specialist', async () => {
    const { ctx, agent } = await team();
    const boss = await agent('Orchestrator', 'master_orchestrator', null);
    const manager = await agent('Content Director', 'manager', boss.id);
    await agent('Script Writer', 'specialist', manager.id);
    const turn = await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: delegate(
        'Content Director',
        'Produce the script',
        '<<call:delegate:{"agent":"Script Writer","objective":"Write scene one"}>>',
      ),
    });
    await fx.drain(ctx);
    const answer = await answerOf(ctx, turn.conversationId);
    expect(answer).toContain('agent="Content Director"');
    expect(answer).toContain('Script Writer');
    expect(answer).toContain('echo: Task: Write scene one');
    const [managerTask] = await listChildTasks(fx.db, ctx, turn.taskId);
    const [writerTask] = await listChildTasks(fx.db, ctx, managerTask!.id);
    expect(writerTask).toMatchObject({ agentName: 'Script Writer', state: 'completed' });
  });

  it('cancelling the parent cancels delegated work; cancelling a child lets the parent go on', async () => {
    const { ctx, agent } = await team();
    const boss = await agent('Orchestrator', 'master_orchestrator', null);
    await agent('Mailer', 'specialist', boss.id, ['gmail_send']);
    await agent('Writer', 'specialist', boss.id);
    const mail = delegate('Mailer', 'Send', '<<call:gmail:{"to":"a@example.com","body":"x"}>>');

    const first = await startChatTurn(fx.db, fx.deps, ctx, boss.id, { message: `${mail}` });
    await fx.drain(ctx);
    await cancelTask(fx.db, ctx, first.taskId, { deps: fx.deps });
    const [child] = await listChildTasks(fx.db, ctx, first.taskId);
    expect(child!.state).toBe('cancelled');
    expect(await listApprovalRequests(fx.db, ctx, { status: 'pending' })).toHaveLength(0);

    const second = await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: `${mail} ${delegate('Writer', 'Write')}`,
    });
    await fx.drain(ctx);
    const children = await listChildTasks(fx.db, ctx, second.taskId);
    await cancelTask(fx.db, ctx, children.find((t) => t.agentName === 'Mailer')!.id, {
      deps: fx.deps,
    });
    await fx.drain(ctx);
    expect((await findTask(fx.db, ctx, second.taskId))!.state).toBe('completed');
    expect(await answerOf(ctx, second.conversationId)).toContain("Mailer's task was cancelled");
  });

  it('after a crash mid-delegation, the resumed run waits for the child instead of calling it interrupted', async () => {
    const { ctx, agent } = await team();
    const boss = await agent('Orchestrator', 'master_orchestrator', null);
    await agent('Writer', 'specialist', boss.id);
    const turn = await startChatTurn(fx.db, fx.deps, ctx, boss.id, {
      message: delegate('Writer', 'Write'),
    });
    // Run only the parent's first step: it delegates and starts waiting.
    const parentJob = fx.queue.shift()!;
    await executeRun(fx.db, fx.deps, ctx, parentJob.runId);
    // Simulate a worker that died before saving the wait: no pending tools, back on the queue.
    const run = (await findRun(fx.db, ctx, turn.runId))!;
    const state = run.state as { pendingTools?: unknown };
    delete state.pendingTools;
    await updateRun(fx.db, ctx, run.id, {
      status: 'queued',
      state: state as Record<string, unknown>,
    });
    await executeRun(fx.db, fx.deps, ctx, run.id);
    expect((await findRun(fx.db, ctx, run.id))!.status).toBe('waiting_agents');

    await fx.drain(ctx);
    expect((await findTask(fx.db, ctx, turn.taskId))!.state).toBe('completed');
    const answer = await answerOf(ctx, turn.conversationId);
    expect(answer).toContain('echo: Task: Write');
    expect(answer).not.toContain('interrupted');
  });
});
