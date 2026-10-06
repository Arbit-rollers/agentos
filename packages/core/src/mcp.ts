import { createHash, randomBytes } from 'node:crypto';
import {
  findAgent,
  findMcpConnection,
  findMcpConnectionByOAuthState,
  findMcpTool,
  insertMcpConnection,
  deleteMcpConnection,
  listAgentToolGrants,
  listMcpTools,
  replaceAgentToolSelection,
  setAgentToolMode,
  syncDiscoveredTools,
  updateAgent,
  updateMcpConnection,
  updateMcpTool,
  withTransaction,
  type Database,
  type McpConnection,
  type McpTool,
  type TenantContext,
} from '@agentos/db';
import {
  MCP_AUTH_TYPES,
  MCP_TRANSPORTS,
  McpGatewayError,
  StoredOAuthProvider,
  beginOAuth,
  callTool,
  completeOAuth,
  discover,
  type McpAccess,
  type OAuthState,
  type ToolResult,
} from '@agentos/mcp-gateway';
import {
  PERMISSION_MODES,
  RISK_CATEGORIES,
  allowedModes,
  defaultPermissionFor,
  evaluateToolCall,
  riskCategoryOf,
  type ApprovalPolicy,
  type PermissionMode,
  type RiskCategory,
} from '@agentos/policy';
import { z } from 'zod';
import { recordAudit } from './audit';
import { parse } from './auth';
import { AppError } from './errors';
import type { SecretStore } from './secrets';

export type McpDeps = {
  secrets: SecretStore;
  /** Public app URL; OAuth redirects come back to `${appUrl}/api/mcp/oauth/callback`. */
  appUrl: string;
};

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

const connectionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: 'mcp_name_required' })
      .max(80, { error: 'mcp_name_too_long' }),
    serverType: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,40}$/)
      .default('custom'),
    endpoint: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/i, { error: 'invalid_endpoint' }),
    transport: z.enum(MCP_TRANSPORTS),
    authType: z.enum(MCP_AUTH_TYPES),
    token: z.string().trim().max(4000).optional(),
    /** One `Name: value` per line. */
    headers: z.string().max(8000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.authType === 'bearer' && !value.token) {
      ctx.addIssue({ code: 'custom', path: ['token'], message: 'token_required' });
    }
    if (value.authType === 'headers') {
      const lines = (value.headers ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const bad = lines.some((line) => {
        const [name, ...rest] = line.split(':');
        return (
          !name ||
          !HEADER_NAME.test(name.trim()) ||
          FORBIDDEN_HEADERS.has(name.trim().toLowerCase()) ||
          rest.join(':').trim() === ''
        );
      });
      if (lines.length === 0 || bad)
        ctx.addIssue({ code: 'custom', path: ['headers'], message: 'invalid_headers' });
    }
  });

export type McpConnectionInput = z.input<typeof connectionSchema>;

function parseHeaders(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(':');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

const hashState = (state: string) => createHash('sha256').update(state).digest('hex');

function oauthProvider(deps: McpDeps, ctx: TenantContext, connection: McpConnection, state = '') {
  if (!connection.secretId) throw new AppError('MCP_UNAVAILABLE', 'Missing OAuth state');
  const secretId = connection.secretId;
  return new StoredOAuthProvider(
    {
      load: async () => JSON.parse(await deps.secrets.reveal(ctx, secretId)) as OAuthState,
      save: (next) => deps.secrets.replace(ctx, secretId, JSON.stringify(next)),
    },
    `${deps.appUrl.replace(/\/+$/, '')}/api/mcp/oauth/callback`,
    state,
  );
}

/** Builds gateway access for a connection, decrypting credentials only for this call. */
async function accessFor(
  deps: McpDeps,
  ctx: TenantContext,
  connection: McpConnection,
): Promise<McpAccess> {
  const base = { endpoint: connection.endpoint, transport: connection.transport };
  const secret = async () =>
    connection.secretId ? deps.secrets.reveal(ctx, connection.secretId) : '';
  switch (connection.authType) {
    case 'none':
      return { ...base, auth: { type: 'none' } };
    case 'bearer':
      return { ...base, auth: { type: 'bearer', token: await secret() } };
    case 'headers':
      return {
        ...base,
        auth: { type: 'headers', headers: JSON.parse(await secret()) as Record<string, string> },
      };
    case 'oauth':
      return { ...base, auth: { type: 'oauth', provider: oauthProvider(deps, ctx, connection) } };
  }
}

async function requireConnection(db: Database, ctx: TenantContext, id: string) {
  const connection = await findMcpConnection(db, ctx, id);
  if (!connection) throw new AppError('NOT_FOUND', 'MCP connection not found');
  return connection;
}

/**
 * Connects to the server, then stores what it offers (PRD §8.3). New tools get a classified
 * workspace default; nothing is granted to any agent (PRD §9: connecting exposes nothing).
 */
export async function refreshMcpConnection(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
): Promise<McpConnection> {
  const connection = await requireConnection(db, ctx, id);
  try {
    const found = await discover(await accessFor(deps, ctx, connection));
    await syncDiscoveredTools(
      db,
      ctx,
      id,
      found.tools.map((tool) => ({
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations as Record<string, boolean>,
        riskCategory: riskCategoryOf(tool.name, tool.description),
        defaultPermission: defaultPermissionFor(tool.name, tool.annotations),
      })),
    );
    return (await updateMcpConnection(db, ctx, id, {
      status: 'connected',
      serverInfo: found.server,
      resources: found.resources,
      lastCheckedAt: new Date(),
      lastError: null,
    }))!;
  } catch (error) {
    if (!(error instanceof McpGatewayError)) throw error;
    return (await updateMcpConnection(db, ctx, id, {
      status: error.kind === 'auth' && connection.authType === 'oauth' ? 'needs_auth' : 'error',
      lastCheckedAt: new Date(),
      lastError: error.kind,
    }))!;
  }
}

/**
 * Starts OAuth for a connection. Returns the URL to send the browser to, or null when
 * stored tokens still work. The random `state` binds the callback to this workspace.
 */
export async function startMcpAuthorization(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
): Promise<string | null> {
  const connection = await requireConnection(db, ctx, id);
  if (connection.authType !== 'oauth') throw new AppError('VALIDATION', 'Not an OAuth connection');
  const state = randomBytes(24).toString('base64url');
  await updateMcpConnection(db, ctx, id, {
    oauthStateHash: hashState(state),
    status: 'needs_auth',
  });
  try {
    const result = await beginOAuth(
      oauthProvider(deps, ctx, connection, state),
      connection.endpoint,
    );
    if (result.status === 'redirect') return result.url;
  } catch (error) {
    if (!(error instanceof McpGatewayError)) throw error;
    await updateMcpConnection(db, ctx, id, {
      status: 'error',
      lastError: 'auth',
      oauthStateHash: null,
    });
    throw new AppError('MCP_UNAVAILABLE', 'Could not start authorization', {
      endpoint: ['mcp_auth'],
    });
  }
  await updateMcpConnection(db, ctx, id, { oauthStateHash: null });
  await refreshMcpConnection(db, deps, ctx, id);
  return null;
}

/** OAuth callback: exchanges the code, then discovers tools. `state` must match this workspace. */
export async function completeMcpAuthorization(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  input: { state: string; code: string },
): Promise<McpConnection> {
  const connection = await findMcpConnectionByOAuthState(db, ctx, hashState(input.state));
  if (!connection) throw new AppError('NOT_FOUND', 'Unknown or expired authorization');
  await updateMcpConnection(db, ctx, connection.id, { oauthStateHash: null });
  try {
    await completeOAuth(
      oauthProvider(deps, ctx, connection, input.state),
      connection.endpoint,
      input.code,
    );
  } catch (error) {
    if (!(error instanceof McpGatewayError)) throw error;
    await updateMcpConnection(db, ctx, connection.id, { status: 'needs_auth', lastError: 'auth' });
    throw new AppError('MCP_UNAVAILABLE', 'Authorization failed', { endpoint: ['mcp_auth'] });
  }
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'mcp.authorized',
    targetType: 'mcp_connection',
    targetId: connection.id,
    outcome: 'success',
  });
  return refreshMcpConnection(db, deps, ctx, connection.id);
}

/**
 * MCP Hub → Connect (PRD §8.2). Credentials go to the secret store. OAuth connections
 * return the authorization URL to send the browser to.
 */
export async function createMcpConnection(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  input: McpConnectionInput,
): Promise<{ connection: McpConnection; authorizationUrl: string | null }> {
  const data = parse(connectionSchema, input);
  const secretValue =
    data.authType === 'bearer'
      ? { kind: 'mcp:bearer', value: data.token! }
      : data.authType === 'headers'
        ? { kind: 'mcp:headers', value: JSON.stringify(parseHeaders(data.headers!)) }
        : data.authType === 'oauth'
          ? { kind: 'mcp:oauth', value: '{}' }
          : null;
  const secretId = secretValue
    ? await deps.secrets.create(ctx, secretValue.kind, secretValue.value)
    : null;

  const connection = await insertMcpConnection(db, ctx, {
    name: data.name,
    serverType: data.serverType,
    transport: data.transport,
    endpoint: data.endpoint,
    authType: data.authType,
    secretId,
  });
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'mcp.connected',
    targetType: 'mcp_connection',
    targetId: connection.id,
    outcome: 'success',
    metadata: {
      name: data.name,
      serverType: data.serverType,
      transport: data.transport,
      authType: data.authType,
    },
  });

  if (data.authType === 'oauth') {
    const authorizationUrl = await startMcpAuthorization(db, deps, ctx, connection.id);
    return { connection: (await findMcpConnection(db, ctx, connection.id))!, authorizationUrl };
  }
  return {
    connection: await refreshMcpConnection(db, deps, ctx, connection.id),
    authorizationUrl: null,
  };
}

export async function setMcpConnectionEnabled(
  db: Database,
  ctx: TenantContext,
  id: string,
  enabled: boolean,
) {
  await requireConnection(db, ctx, id);
  await updateMcpConnection(db, ctx, id, { enabled });
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: enabled ? 'mcp.enabled' : 'mcp.disabled',
    targetType: 'mcp_connection',
    targetId: id,
    outcome: 'success',
  });
}

/** Disconnect: removes the connection, its tools, every agent grant on them, and the secret. */
export async function removeMcpConnection(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
) {
  const connection = await requireConnection(db, ctx, id);
  await deleteMcpConnection(db, ctx, id);
  if (connection.secretId) await deps.secrets.remove(ctx, connection.secretId);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'mcp.removed',
    targetType: 'mcp_connection',
    targetId: id,
    outcome: 'success',
    metadata: { name: connection.name },
  });
}

/** Workspace-level default for a tool (Screen 3 Tools tab). Agents are capped by it. */
export async function updateToolDefaults(
  db: Database,
  ctx: TenantContext,
  toolId: string,
  input: { defaultPermission?: PermissionMode; enabled?: boolean },
): Promise<McpTool> {
  const tool = await findMcpTool(db, ctx, toolId);
  if (!tool) throw new AppError('NOT_FOUND', 'Tool not found');
  if (input.defaultPermission && !PERMISSION_MODES.includes(input.defaultPermission)) {
    throw new AppError('VALIDATION', 'Invalid mode', { defaultPermission: ['invalid_permission'] });
  }
  const updated = await updateMcpTool(db, ctx, toolId, input);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'mcp.tool_defaults_changed',
    targetType: 'mcp_tool',
    targetId: toolId,
    outcome: 'success',
    metadata: {
      tool: tool.name,
      before: { defaultPermission: tool.defaultPermission, enabled: tool.enabled },
      after: { defaultPermission: updated!.defaultPermission, enabled: updated!.enabled },
    },
  });
  return updated!;
}

async function requireEditableAgent(db: Database, ctx: TenantContext, agentId: string) {
  const agent = await findAgent(db, ctx, agentId);
  if (!agent) throw new AppError('NOT_FOUND', 'Agent not found');
  if (agent.status === 'archived')
    throw new AppError('INVALID_TRANSITION', 'Restore the agent before editing it');
  return agent;
}

/**
 * Wizard step 3 (Screen 5): which tools the agent gets. New tools start at the workspace
 * default; tools it keeps keep their mode. Tools must belong to this workspace.
 */
export async function setAgentTools(
  db: Database,
  ctx: TenantContext,
  agentId: string,
  toolIds: string[],
) {
  await requireEditableAgent(db, ctx, agentId);
  const workspaceTools = new Map((await listMcpTools(db, ctx)).map((t) => [t.id, t]));
  const unique = [...new Set(toolIds)];
  if (unique.some((id) => !workspaceTools.has(id))) {
    throw new AppError('VALIDATION', 'Unknown tool', { tools: ['unknown_tool'] });
  }
  const before = new Set((await listAgentToolGrants(db, ctx, agentId)).map((g) => g.tool.name));
  const selected = unique.map((id) => workspaceTools.get(id)!);
  await withTransaction(db, async (tx) => {
    await replaceAgentToolSelection(tx, ctx, agentId, selected);
    const after = new Set(selected.map((t) => t.name));
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      agentId,
      action: 'agent.tools_changed',
      targetType: 'agent',
      targetId: agentId,
      outcome: 'success',
      metadata: {
        added: [...after].filter((n) => !before.has(n)),
        removed: [...before].filter((n) => !after.has(n)),
      },
    });
  });
}

const approvalSchema = z.object({
  requireApprovalForHighRisk: z.boolean(),
  categories: z.array(z.enum(RISK_CATEGORIES)).max(RISK_CATEGORIES.length),
});

/**
 * Wizard step 4 (Screen 6): per-tool modes and the agent's high-risk approval policy.
 * A mode can never be looser than the workspace default (PRD §9).
 */
export async function setAgentPermissions(
  db: Database,
  ctx: TenantContext,
  agentId: string,
  input: { modes: Record<string, PermissionMode>; approvalPolicy: ApprovalPolicy },
) {
  const agent = await requireEditableAgent(db, ctx, agentId);
  const policy = parse(approvalSchema, input.approvalPolicy);
  const grants = new Map((await listAgentToolGrants(db, ctx, agentId)).map((g) => [g.tool.id, g]));
  const changes: Record<string, [string, string]> = {};

  for (const [toolId, mode] of Object.entries(input.modes)) {
    const grant = grants.get(toolId);
    if (!grant)
      throw new AppError('VALIDATION', 'Tool not granted', { [toolId]: ['tool_not_granted'] });
    if (!allowedModes(grant.tool.defaultPermission).includes(mode)) {
      throw new AppError('VALIDATION', 'Looser than the workspace default', {
        [toolId]: ['permission_looser_than_default'],
      });
    }
    if (grant.permissionMode !== mode) changes[grant.tool.name] = [grant.permissionMode, mode];
  }

  await withTransaction(db, async (tx) => {
    for (const [toolId, mode] of Object.entries(input.modes))
      await setAgentToolMode(tx, ctx, agentId, toolId, mode);
    await updateAgent(tx, ctx, agentId, { approvalPolicy: policy });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      agentId,
      action: 'agent.permissions_changed',
      targetType: 'agent',
      targetId: agentId,
      outcome: 'success',
      metadata: {
        changes,
        approvalPolicy: { before: agent.approvalPolicy, after: policy },
      },
    });
  });
}

export type ToolCallOutcome = { result: ToolResult };

/**
 * The only path from an agent to an MCP tool (PRD §21). Policy is evaluated server-side on
 * every call; blocked calls are refused and audited, approval-required calls are refused
 * until the approval system lands (M6), and tool errors are recorded as failures (AC 22).
 */
export async function executeAgentTool(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  input: { agentId: string; toolId: string; args: Record<string, unknown> },
): Promise<ToolCallOutcome> {
  const agent = await findAgent(db, ctx, input.agentId);
  if (!agent) throw new AppError('NOT_FOUND', 'Agent not found');
  const tool = await findMcpTool(db, ctx, input.toolId);
  if (!tool) throw new AppError('NOT_FOUND', 'Tool not found');
  const connection = await requireConnection(db, ctx, tool.connectionId);
  const grant = (await listAgentToolGrants(db, ctx, agent.id)).find((g) => g.tool.id === tool.id);

  const { decision, reason } = evaluateToolCall(
    {
      enabled: tool.enabled && tool.available && agent.status !== 'archived',
      connectionEnabled: connection.enabled,
      workspaceDefault: tool.defaultPermission,
      riskCategory: (tool.riskCategory as RiskCategory | null) ?? null,
    },
    grant?.permissionMode,
    agent.approvalPolicy as ApprovalPolicy,
  );
  const audit = {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: agent.id,
    targetType: 'mcp_tool',
    targetId: tool.id,
    metadata: { tool: tool.name, connection: connection.name, reason },
  };

  if (decision === 'BLOCK') {
    await recordAudit(db, { ...audit, action: 'tool.blocked', outcome: 'denied' });
    throw new AppError('TOOL_BLOCKED', 'This tool is blocked for this agent', { tool: [reason] });
  }
  if (decision === 'REQUIRE_APPROVAL') {
    await recordAudit(db, { ...audit, action: 'tool.approval_required', outcome: 'denied' });
    throw new AppError('APPROVAL_REQUIRED', 'This tool call needs approval', { tool: [reason] });
  }

  try {
    const result = await callTool(await accessFor(deps, ctx, connection), tool.name, input.args);
    await recordAudit(db, {
      ...audit,
      action: 'tool.called',
      outcome: result.isError ? 'failure' : 'success',
      metadata: { ...audit.metadata, arguments: input.args },
    });
    return { result };
  } catch (error) {
    if (!(error instanceof McpGatewayError)) throw error;
    await recordAudit(db, {
      ...audit,
      action: 'tool.called',
      outcome: 'failure',
      metadata: { ...audit.metadata, error: error.kind },
    });
    throw new AppError('MCP_UNAVAILABLE', 'The MCP server call failed', {
      tool: [`mcp_${error.kind}`],
    });
  }
}
