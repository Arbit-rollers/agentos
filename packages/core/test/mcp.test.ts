import { listAgentToolGrants, listAuditLogs, listMcpTools } from '@agentos/db';
import { FAKE_TOOLS, startFakeMcpServer } from '@agentos/mcp-gateway/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeAgentSetup, createAgent } from '../src/agents';
import { createSecretCipher } from '../src/crypto';
import { getDashboardSummary } from '../src/dashboard';
import {
  completeMcpAuthorization,
  createMcpConnection,
  executeAgentTool,
  refreshMcpConnection,
  removeMcpConnection,
  setAgentPermissions,
  setAgentTools,
  setMcpConnectionEnabled,
  updateToolDefaults,
  type McpDeps,
} from '../src/mcp';
import { createSecretStore } from '../src/secrets';
import { createUser, useTestDb } from './helpers';

const { db, sql } = useTestDb();
const fake = startFakeMcpServer();
let base = '';
beforeAll(async () => {
  base = (await fake.ready).url;
});
afterAll(() => fake.close());

const deps: McpDeps = {
  secrets: createSecretStore(db, createSecretCipher(Buffer.alloc(32, 5).toString('base64'))),
  appUrl: 'http://localhost:3000',
};

const NO_APPROVALS = { requireApprovalForHighRisk: false, categories: [] };

async function setup() {
  const user = await createUser(db);
  const { connection } = await createMcpConnection(db, deps, user.ctx, {
    name: 'Workspace',
    endpoint: `${base}/mcp`,
    transport: 'streamable_http',
    authType: 'none',
  });
  const tools = new Map((await listMcpTools(db, user.ctx)).map((t) => [t.name, t]));
  const newAgent = async (name: string) =>
    completeAgentSetup(
      db,
      user.ctx,
      (
        await createAgent(db, user.ctx, {
          name,
          description: 'd',
          agentType: 'specialist',
          avatar: 'preset:bot',
          tags: [],
          parentAgentId: null,
          role: 'r',
          jobDefinition: 'j',
          goals: [],
          constraints: [],
        })
      ).id,
    );
  return { ...user, connection, tools, newAgent };
}

describe('connections and discovery (PRD §8)', () => {
  it('discovers tools with classified defaults and exposes none to agents (AC 13, 14)', async () => {
    const { ctx, connection, tools, newAgent } = await setup();
    expect(connection).toMatchObject({
      status: 'connected',
      serverInfo: { name: 'fake-workspace' },
    });
    expect([...tools.keys()].sort()).toEqual([...FAKE_TOOLS].sort());
    expect(tools.get('search_documents')!.defaultPermission).toBe('AUTO_ALLOW');
    expect(tools.get('gmail_send')).toMatchObject({
      defaultPermission: 'APPROVAL_REQUIRED',
      riskCategory: 'send_email',
    });
    expect(tools.get('drive_delete')!.defaultPermission).toBe('BLOCKED');

    const agent = await newAgent('Fresh');
    expect(await listAgentToolGrants(db, ctx, agent.id)).toEqual([]);
    await expect(
      executeAgentTool(db, deps, ctx, {
        agentId: agent.id,
        toolId: tools.get('search_documents')!.id,
        args: { query: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED', details: { tool: ['not_granted'] } });
    expect((await getDashboardSummary(db, ctx)).mcpConnections.connected).toBe(1);
  });

  it('stores bearer tokens encrypted and marks bad credentials as errors', async () => {
    const { ctx } = await createUser(db);
    const good = await createMcpConnection(db, deps, ctx, {
      name: 'Secure',
      endpoint: `${base}/secure/mcp`,
      transport: 'streamable_http',
      authType: 'bearer',
      token: 'test-token',
    });
    expect(good.connection.status).toBe('connected');
    const bad = await createMcpConnection(db, deps, ctx, {
      name: 'Wrong',
      endpoint: `${base}/secure/mcp`,
      transport: 'streamable_http',
      authType: 'bearer',
      token: 'nope',
    });
    expect(bad.connection).toMatchObject({ status: 'error', lastError: 'auth' });
    const headers = await createMcpConnection(db, deps, ctx, {
      name: 'Headers',
      endpoint: `${base}/secure/mcp`,
      transport: 'streamable_http',
      authType: 'headers',
      headers: 'Authorization: Bearer test-token',
    });
    expect(headers.connection.status).toBe('connected');
    expect(
      JSON.stringify(await sql`select * from mcp_connections`) +
        JSON.stringify(await sql`select * from secrets`),
    ).not.toContain('test-token');
  });

  it('validates input', async () => {
    const { ctx } = await createUser(db);
    await expect(
      createMcpConnection(db, deps, ctx, {
        name: '',
        endpoint: 'ftp://x',
        transport: 'streamable_http',
        authType: 'bearer',
      }),
    ).rejects.toMatchObject({
      details: {
        name: ['mcp_name_required'],
        endpoint: ['invalid_endpoint'],
        token: ['token_required'],
      },
    });
    await expect(
      createMcpConnection(db, deps, ctx, {
        name: 'H',
        endpoint: `${base}/mcp`,
        transport: 'streamable_http',
        authType: 'headers',
        headers: 'Host: evil',
      }),
    ).rejects.toMatchObject({ details: { headers: ['invalid_headers'] } });
  });

  it('OAuth: returns an authorization URL, completes via the callback state, then discovers', async () => {
    const { ctx } = await createUser(db);
    const { connection, authorizationUrl } = await createMcpConnection(db, deps, ctx, {
      name: 'OAuth',
      endpoint: `${base}/oauth/mcp`,
      transport: 'streamable_http',
      authType: 'oauth',
    });
    expect(connection.status).toBe('needs_auth');
    expect(authorizationUrl).toContain('code_challenge=');

    const redirect = await fetch(authorizationUrl!, { redirect: 'manual' });
    const callback = new URL(redirect.headers.get('location')!);
    expect(callback.pathname).toBe('/api/mcp/oauth/callback');

    // The state only resolves inside the workspace that started the flow.
    const other = await createUser(db);
    await expect(
      completeMcpAuthorization(db, deps, other.ctx, {
        state: callback.searchParams.get('state')!,
        code: callback.searchParams.get('code')!,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const done = await completeMcpAuthorization(db, deps, ctx, {
      state: callback.searchParams.get('state')!,
      code: callback.searchParams.get('code')!,
    });
    expect(done).toMatchObject({ status: 'connected', oauthStateHash: null });
    expect((await listMcpTools(db, ctx, { connectionId: done.id })).length).toBe(FAKE_TOOLS.length);
    const secrets = JSON.stringify(await sql`select * from secrets`);
    expect(secrets).not.toContain('access_token');
  });

  it('works over legacy SSE', async () => {
    const { ctx } = await createUser(db);
    const { connection } = await createMcpConnection(db, deps, ctx, {
      name: 'SSE',
      endpoint: `${base}/sse`,
      transport: 'sse',
      authType: 'none',
    });
    expect(connection.status).toBe('connected');
  });
});

describe('per-agent permissions and enforcement (PRD §9, §10)', () => {
  it('tools are assigned per agent (AC 15)', async () => {
    const { ctx, tools, newAgent } = await setup();
    const researcher = await newAgent('Researcher');
    const writer = await newAgent('Writer');
    await setAgentTools(db, ctx, researcher.id, [tools.get('search_documents')!.id]);
    await setAgentPermissions(db, ctx, researcher.id, { modes: {}, approvalPolicy: NO_APPROVALS });

    const run = (agentId: string) =>
      executeAgentTool(db, deps, ctx, {
        agentId,
        toolId: tools.get('search_documents')!.id,
        args: { query: 'aviation' },
      });
    expect((await run(researcher.id)).result.text).toBe('results for aviation');
    await expect(run(writer.id)).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });
  });

  it('BLOCKED tools never reach the server; the refusal is audited (AC 16)', async () => {
    const { ctx, tools, newAgent } = await setup();
    const agent = await newAgent('Careful');
    await setAgentTools(db, ctx, agent.id, [tools.get('drive_delete')!.id]);
    fake.calls.length = 0;
    await expect(
      executeAgentTool(db, deps, ctx, {
        agentId: agent.id,
        toolId: tools.get('drive_delete')!.id,
        args: { id: '1' },
      }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED', details: { tool: ['blocked'] } });
    expect(fake.calls).toEqual([]);
    const log = (await listAuditLogs(db, ctx)).find((l) => l.action === 'tool.blocked');
    expect(log).toMatchObject({
      outcome: 'denied',
      agentId: agent.id,
      metadata: { tool: 'drive_delete', reason: 'blocked' },
    });
  });

  it('APPROVAL_REQUIRED tools pause before execution (AC 17)', async () => {
    const { ctx, tools, newAgent } = await setup();
    const agent = await newAgent('Mailer');
    await setAgentTools(db, ctx, agent.id, [tools.get('gmail_send')!.id]);
    fake.calls.length = 0;
    await expect(
      executeAgentTool(db, deps, ctx, {
        agentId: agent.id,
        toolId: tools.get('gmail_send')!.id,
        args: { to: 'a@b.c', body: 'hi' },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(fake.calls).toEqual([]);
  });

  it('agent modes can be stricter but never looser than the workspace default', async () => {
    const { ctx, tools, newAgent } = await setup();
    const agent = await newAgent('Strict');
    const search = tools.get('search_documents')!;
    const send = tools.get('gmail_send')!;
    await setAgentTools(db, ctx, agent.id, [search.id, send.id]);
    await expect(
      setAgentPermissions(db, ctx, agent.id, {
        modes: { [send.id]: 'AUTO_ALLOW' },
        approvalPolicy: NO_APPROVALS,
      }),
    ).rejects.toMatchObject({ details: { [send.id]: ['permission_looser_than_default'] } });
    await setAgentPermissions(db, ctx, agent.id, {
      modes: { [search.id]: 'BLOCKED' },
      approvalPolicy: NO_APPROVALS,
    });
    await expect(
      executeAgentTool(db, deps, ctx, {
        agentId: agent.id,
        toolId: search.id,
        args: { query: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });

    // Tightening the workspace default overrides an existing looser agent grant.
    const other = await newAgent('Other');
    await setAgentTools(db, ctx, other.id, [search.id]);
    await setAgentPermissions(db, ctx, other.id, { modes: {}, approvalPolicy: NO_APPROVALS });
    await updateToolDefaults(db, ctx, search.id, { defaultPermission: 'APPROVAL_REQUIRED' });
    await expect(
      executeAgentTool(db, deps, ctx, {
        agentId: other.id,
        toolId: search.id,
        args: { query: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('high-risk categories need approval when the agent policy says so', async () => {
    const { ctx, tools, newAgent } = await setup();
    const agent = await newAgent('Planner');
    const calendar = tools.get('calendar_create')!;
    await updateToolDefaults(db, ctx, calendar.id, { defaultPermission: 'AUTO_ALLOW' });
    await setAgentTools(db, ctx, agent.id, [calendar.id]);
    await setAgentPermissions(db, ctx, agent.id, {
      modes: { [calendar.id]: 'AUTO_ALLOW' },
      approvalPolicy: { requireApprovalForHighRisk: true, categories: ['calendar_write'] },
    });
    await expect(
      executeAgentTool(db, deps, ctx, {
        agentId: agent.id,
        toolId: calendar.id,
        args: { title: 'x' },
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
      details: { tool: ['high_risk_category'] },
    });
  });

  it('records tool-level failures as failures (AC 22)', async () => {
    const { ctx, tools, newAgent } = await setup();
    const agent = await newAgent('Flaky');
    const flaky = tools.get('flaky_tool')!;
    await updateToolDefaults(db, ctx, flaky.id, { defaultPermission: 'AUTO_ALLOW' });
    await setAgentTools(db, ctx, agent.id, [flaky.id]);
    const { result } = await executeAgentTool(db, deps, ctx, {
      agentId: agent.id,
      toolId: flaky.id,
      args: {},
    });
    expect(result.isError).toBe(true);
    expect((await listAuditLogs(db, ctx)).find((l) => l.action === 'tool.called')?.outcome).toBe(
      'failure',
    );
  });

  it('disabled connections and removed connections stop every call', async () => {
    const { ctx, connection, tools, newAgent } = await setup();
    const agent = await newAgent('A');
    const search = tools.get('search_documents')!;
    await setAgentTools(db, ctx, agent.id, [search.id]);
    await setAgentPermissions(db, ctx, agent.id, { modes: {}, approvalPolicy: NO_APPROVALS });
    await setMcpConnectionEnabled(db, ctx, connection.id, false);
    await expect(
      executeAgentTool(db, deps, ctx, {
        agentId: agent.id,
        toolId: search.id,
        args: { query: 'x' },
      }),
    ).rejects.toMatchObject({ details: { tool: ['connection_disabled'] } });
    await removeMcpConnection(db, deps, ctx, connection.id);
    expect(await listAgentToolGrants(db, ctx, agent.id)).toEqual([]);
  });

  it('refresh keeps workspace choices and marks vanished tools unavailable', async () => {
    const { ctx, connection, tools } = await setup();
    await updateToolDefaults(db, ctx, tools.get('read_document')!.id, {
      defaultPermission: 'BLOCKED',
    });
    await sql`update mcp_tools set name = 'old_tool' where id = ${tools.get('flaky_tool')!.id}`;
    await refreshMcpConnection(db, deps, ctx, connection.id);
    const after = new Map((await listMcpTools(db, ctx)).map((t) => [t.name, t]));
    expect(after.get('read_document')!.defaultPermission).toBe('BLOCKED');
    expect(after.get('old_tool')!.available).toBe(false);
    expect(after.get('flaky_tool')!.available).toBe(true);
  });
});

describe('tenant isolation (AC 2)', () => {
  it('another workspace cannot use, refresh, change or remove a connection or tool', async () => {
    const { connection, tools } = await setup();
    const other = await createUser(db);
    await expect(refreshMcpConnection(db, deps, other.ctx, connection.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(removeMcpConnection(db, deps, other.ctx, connection.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      updateToolDefaults(db, other.ctx, tools.get('drive_delete')!.id, {
        defaultPermission: 'AUTO_ALLOW',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const otherAgent = await createAgentFor(other.ctx);
    await expect(
      setAgentTools(db, other.ctx, otherAgent, [tools.get('search_documents')!.id]),
    ).rejects.toMatchObject({ details: { tools: ['unknown_tool'] } });
  });
});

async function createAgentFor(ctx: Parameters<typeof createAgent>[1]) {
  return (
    await createAgent(db, ctx, {
      name: 'X',
      description: 'd',
      agentType: 'specialist',
      avatar: 'preset:bot',
      tags: [],
      parentAgentId: null,
      role: 'r',
      jobDefinition: 'j',
      goals: [],
      constraints: [],
    })
  ).id;
}
