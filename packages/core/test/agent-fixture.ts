// Shared setup for runtime-level tests: fake model provider + reference MCP server, a user
// with an active agent, and an in-memory run queue drained like the worker would.
import { listMcpTools } from '@agentos/db';
import { startFakeMcpServer } from '@agentos/mcp-gateway/testing';
import { startFakeProvider } from '@agentos/model-gateway/testing';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { changeAgentStatus, completeAgentSetup, createAgent } from '../src/agents';
import { createSecretCipher } from '../src/crypto';
import { createMcpConnection, setAgentPermissions, setAgentTools } from '../src/mcp';
import { saveAgentModelConfig, type ModelConfigInput } from '../src/models';
import { createProviderConnection } from '../src/providers';
import { executeRun, type RunJob, type RuntimeDeps } from '../src/runtime';
import { createSecretStore } from '../src/secrets';
import { createUser, useTestDb } from './helpers';

export function useAgentFixture() {
  const { db, sql } = useTestDb();
  const llm = startFakeProvider();
  const mcp = startFakeMcpServer();
  const urls = { llm: '', mcp: '' };
  beforeAll(async () => {
    urls.llm = (await llm.ready).url;
    urls.mcp = (await mcp.ready).url;
  });
  afterAll(async () => {
    await llm.close();
    await mcp.close();
  });

  const queue: (RunJob & { delayMs: number })[] = [];
  // Each test starts with an empty queue (the database is reset by useTestDb).
  beforeEach(() => {
    queue.length = 0;
  });
  const deps: RuntimeDeps = {
    secrets: createSecretStore(db, createSecretCipher(Buffer.alloc(32, 7).toString('base64'))),
    appUrl: 'http://localhost:3000',
    enqueueRun: async (job, options) => void queue.push({ ...job, delayMs: options?.delayMs ?? 0 }),
  };

  /** Runs every queued job (delays are ignored), as the worker would. */
  async function drain(ctx: { workspaceId: string; userId: string }) {
    while (queue.length > 0) await executeRun(db, deps, ctx, queue.shift()!.runId);
  }

  async function setup(
    options: { model?: string; budget?: ModelConfigInput['budget']; tools?: string[] } = {},
  ) {
    const user = await createUser(db);
    const provider = await createProviderConnection(db, deps, user.ctx, {
      provider: 'openai_compatible',
      name: 'LLM',
      endpoint: `${urls.llm}/openai/v1`,
    });
    await createMcpConnection(db, deps, user.ctx, {
      name: 'Workspace',
      endpoint: `${urls.mcp}/mcp`,
      transport: 'streamable_http',
      authType: 'none',
    });
    const tools = new Map((await listMcpTools(db, user.ctx)).map((t) => [t.name, t]));
    const agent = await completeAgentSetup(
      db,
      user.ctx,
      (
        await createAgent(db, user.ctx, {
          name: 'Worker',
          description: 'd',
          agentType: 'specialist',
          avatar: 'preset:bot',
          tags: [],
          parentAgentId: null,
          role: 'Assistant',
          jobDefinition: 'Do tasks.',
          goals: [],
          constraints: [],
        })
      ).id,
    );
    await saveAgentModelConfig(db, user.ctx, agent.id, {
      strategy: 'fixed',
      primary: { connectionId: provider.id, model: options.model ?? 'fake-echo' },
      routes: [],
      fallbacks: [],
      budget: options.budget ?? { onExceed: 'stop' },
    });
    await setAgentTools(
      db,
      user.ctx,
      agent.id,
      (options.tools ?? ['search_documents', 'gmail_send']).map((n) => tools.get(n)!.id),
    );
    await setAgentPermissions(db, user.ctx, agent.id, {
      modes: {},
      approvalPolicy: { requireApprovalForHighRisk: true, categories: ['send_email'] },
    });
    await changeAgentStatus(db, user.ctx, agent.id, 'activate');
    return { ...user, agent, tools, provider };
  }

  return { db, sql, llm, mcp, queue, deps, drain, setup };
}
