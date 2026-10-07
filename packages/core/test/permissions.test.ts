import { addWorkspaceMember, listApprovalRequests, listMcpTools } from '@agentos/db';
import { describe, expect, it } from 'vitest';
import {
  changeAgentStatus,
  completeAgentSetup,
  createAgent,
  updateAgentBasics,
} from '../src/agents';
import { createKnowledgeSource, setEmbeddingSetting, type KnowledgeDeps } from '../src/knowledge';
import {
  createMcpConnection,
  setAgentTools,
  setMcpConnectionEnabled,
  updateToolDefaults,
} from '../src/mcp';
import { createProviderConnection } from '../src/providers';
import { decideApproval, startChatTurn } from '../src/runtime';
import { createSchedule, setScheduleActive } from '../src/schedules';
import { cancelTask, createTask } from '../src/tasks';
import { changeMemberRole } from '../src/team';
import { createUser } from './helpers';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();
const kdeps: KnowledgeDeps = { ...fx.deps, enqueueKnowledge: async () => {} };
const scheduler = { upsert: async () => {}, remove: async () => {}, list: async () => [] };
const forbidden = { code: 'FORBIDDEN' };

async function workspaceWithMember() {
  const owner = await fx.setup();
  const joined = async () => {
    const user = await createUser(fx.db);
    await addWorkspaceMember(fx.db, {
      workspaceId: owner.ctx.workspaceId,
      userId: user.ctx.userId,
      role: 'member',
    });
    return { workspaceId: owner.ctx.workspaceId, userId: user.ctx.userId };
  };
  return { owner, member: await joined(), other: await joined() };
}

const basics = (name: string) => ({
  name,
  description: 'd',
  agentType: 'specialist' as const,
  avatar: 'preset:bot',
  tags: [],
  parentAgentId: null,
  role: 'Helper',
  jobDefinition: 'Help.',
  goals: [],
  constraints: [],
});

describe('workspace roles (v0.4.3)', () => {
  it('members cannot change workspace setup: providers, MCP servers, embeddings, shared knowledge', async () => {
    const { owner, member } = await workspaceWithMember();
    const url = (await fx.llm.ready).url;
    await expect(
      createProviderConnection(fx.db, fx.deps, member, {
        provider: 'openai_compatible',
        name: 'X',
        endpoint: `${url}/openai/v1`,
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      createMcpConnection(fx.db, fx.deps, member, {
        name: 'X',
        endpoint: `${(await fx.mcp.ready).url}/mcp`,
        transport: 'streamable_http',
        authType: 'none',
      }),
    ).rejects.toMatchObject(forbidden);
    const [connectionTool] = await listMcpTools(fx.db, owner.ctx);
    await expect(
      setMcpConnectionEnabled(fx.db, member, connectionTool!.connectionId, false),
    ).rejects.toMatchObject(forbidden);
    await expect(
      updateToolDefaults(fx.db, member, connectionTool!.id, { enabled: false }),
    ).rejects.toMatchObject(forbidden);
    await expect(setEmbeddingSetting(fx.db, kdeps, member, null)).rejects.toMatchObject(forbidden);
    await expect(
      createKnowledgeSource(fx.db, kdeps, member, {
        scope: 'workspace',
        type: 'note',
        name: 'N',
        text: 'x',
      }),
    ).rejects.toMatchObject(forbidden);
    // Private knowledge is theirs to add.
    await expect(
      createKnowledgeSource(fx.db, kdeps, member, {
        scope: 'user',
        type: 'note',
        name: 'Mine',
        text: 'x',
      }),
    ).resolves.toMatchObject({ scope: 'user' });
    // Promoted to admin, they can.
    await changeMemberRole(fx.db, owner.ctx, member.userId, 'admin');
    await expect(
      setMcpConnectionEnabled(fx.db, member, connectionTool!.connectionId, false),
    ).resolves.toBeUndefined();
  });

  it('members create agents and manage their own, not anyone else’s', async () => {
    const { owner, member } = await workspaceWithMember();
    const mine = await createAgent(fx.db, member, basics('Mine'));
    await expect(
      updateAgentBasics(fx.db, member, mine.id, { ...basics('Mine v2') }),
    ).resolves.toMatchObject({ name: 'Mine v2' });
    await expect(completeAgentSetup(fx.db, member, mine.id)).resolves.toBeDefined();
    await expect(
      createKnowledgeSource(fx.db, kdeps, member, {
        scope: 'agent',
        agentId: mine.id,
        type: 'note',
        name: 'A',
        text: 'x',
      }),
    ).resolves.toBeDefined();

    await expect(
      updateAgentBasics(fx.db, member, owner.agent.id, basics('Hijacked')),
    ).rejects.toMatchObject(forbidden);
    await expect(changeAgentStatus(fx.db, member, owner.agent.id, 'pause')).rejects.toMatchObject(
      forbidden,
    );
    await expect(setAgentTools(fx.db, member, owner.agent.id, [])).rejects.toMatchObject(forbidden);
    await expect(
      createKnowledgeSource(fx.db, kdeps, member, {
        scope: 'agent',
        agentId: owner.agent.id,
        type: 'note',
        name: 'A',
        text: 'x',
      }),
    ).rejects.toMatchObject(forbidden);
    // Admins manage any agent.
    await expect(changeAgentStatus(fx.db, owner.ctx, mine.id, 'archive')).resolves.toBeDefined();
  });

  it('tasks and schedules: their creator or an admin', async () => {
    const { owner, member, other } = await workspaceWithMember();
    const task = await createTask(fx.db, fx.deps, member, {
      agentId: owner.agent.id,
      objective: 'Wait [[call:gmail_send:{"to":"a@example.com","body":"x"}]]',
    });
    await fx.drain(member);
    await expect(cancelTask(fx.db, other, task.id)).rejects.toMatchObject(forbidden);
    await expect(cancelTask(fx.db, member, task.id)).resolves.toBeUndefined();

    const schedule = await createSchedule(fx.db, { ...fx.deps, scheduler }, member, {
      agentId: owner.agent.id,
      name: 'S',
      objective: 'o',
      kind: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
    });
    await expect(
      setScheduleActive(fx.db, { ...fx.deps, scheduler }, other, schedule.id, false),
    ).rejects.toMatchObject(forbidden);
    await expect(
      setScheduleActive(fx.db, { ...fx.deps, scheduler }, owner.ctx, schedule.id, false),
    ).resolves.toBeUndefined();
  });

  it('approvals: the person the run works for, or an admin', async () => {
    const { owner, member, other } = await workspaceWithMember();
    await startChatTurn(fx.db, fx.deps, member, owner.agent.id, {
      message: 'Send [[call:gmail_send:{"to":"team@example.com","body":"x"}]]',
    });
    await fx.drain(member);
    const [approval] = await listApprovalRequests(fx.db, owner.ctx, { status: 'pending' });
    await expect(
      decideApproval(fx.db, fx.deps, other, approval!.id, { decision: 'approve' }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      decideApproval(fx.db, fx.deps, member, approval!.id, { decision: 'reject' }),
    ).resolves.toBeUndefined();

    await startChatTurn(fx.db, fx.deps, member, owner.agent.id, {
      message: 'Again [[call:gmail_send:{"to":"team@example.com","body":"y"}]]',
    });
    await fx.drain(member);
    const [second] = await listApprovalRequests(fx.db, owner.ctx, { status: 'pending' });
    await expect(
      decideApproval(fx.db, fx.deps, owner.ctx, second!.id, { decision: 'approve' }),
    ).resolves.toBeUndefined();
  });
});
