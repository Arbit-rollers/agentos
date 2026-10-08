import { createHash, randomBytes } from 'node:crypto';
import {
  findAgent,
  findMcpConnection,
  findMcpConnectionByOAuthState,
  findMyMcpCredential,
  findMyMcpCredentialByOAuthState,
  upsertMyMcpCredential,
  deleteMyMcpCredential,
  deleteMcpCredentialsForConnection,
  listMcpCredentialSecretIds,
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
import { requireAgentManager, requireWorkspaceAdmin } from './permissions';
import type { SecretStore } from './secrets';

export type McpDeps = {
  secrets: SecretStore;
  /** Public app URL; OAuth redirects come back to `${appUrl}/api/mcp/oauth/callback`. */
  appUrl: string;
  /** AgentOS's own Google OAuth client, offered to tenants for Google Workspace (optional). */
  googleClient?: { id: string; secret: string };
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
    /** Per-user: each member connects their own account (OAuth or token). */
    credentialMode: z.enum(['shared', 'per_user']).default('shared'),
    /** OAuth client registered beforehand, for servers without dynamic registration. */
    // An email here is browser autofill, never an OAuth client ID.
    oauthClientId: z
      .string()
      .trim()
      .max(500)
      .refine((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { error: 'client_id_is_email' })
      .optional(),
    oauthClientSecret: z.string().trim().max(500).optional(),
    oauthScopes: z.string().trim().max(2000).optional(),
    oauthParams: z.record(z.string(), z.string().max(200)).default({}),
  })
  .superRefine((value, ctx) => {
    if (value.authType === 'bearer' && !value.token && value.credentialMode === 'shared') {
      ctx.addIssue({ code: 'custom', path: ['token'], message: 'token_required' });
    }
    if (
      value.credentialMode === 'per_user' &&
      value.authType !== 'oauth' &&
      value.authType !== 'bearer'
    ) {
      ctx.addIssue({ code: 'custom', path: ['credentialMode'], message: 'per_user_needs_signin' });
    }
    if (value.oauthClientSecret && !value.oauthClientId) {
      ctx.addIssue({ code: 'custom', path: ['oauthClientId'], message: 'client_id_required' });
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

const perUser = (connection: McpConnection) => connection.credentialMode === 'per_user';

const oauthOptions = (connection: McpConnection) => ({
  ...(connection.oauthScopes && { scope: connection.oauthScopes }),
  params: connection.oauthParams,
});

const redirectUrl = (deps: McpDeps) => `${deps.appUrl.replace(/\/+$/, '')}/api/mcp/oauth/callback`;

/**
 * OAuth client for a connection. Shared connections keep everything in the connection's
 * secret. Per-user connections keep only the client registration there (one app for the
 * whole workspace) and each member's tokens in that member's own secret.
 */
function oauthProvider(
  deps: McpDeps,
  ctx: TenantContext,
  connection: McpConnection,
  state = '',
  userSecretId?: string,
) {
  if (!connection.secretId) throw new AppError('MCP_UNAVAILABLE', 'Missing OAuth state');
  const connectionSecret = connection.secretId;
  const read = async (id: string) => JSON.parse(await deps.secrets.reveal(ctx, id)) as OAuthState;
  const store = userSecretId
    ? {
        load: async () => ({
          clientInformation: (await read(connectionSecret)).clientInformation,
          ...(await read(userSecretId)),
        }),
        save: async ({ clientInformation, ...own }: OAuthState) => {
          const shared = await read(connectionSecret);
          if (JSON.stringify(shared.clientInformation) !== JSON.stringify(clientInformation))
            await deps.secrets.replace(
              ctx,
              connectionSecret,
              JSON.stringify({ clientInformation }),
            );
          await deps.secrets.replace(ctx, userSecretId, JSON.stringify(own));
        },
      }
    : {
        load: () => read(connectionSecret),
        save: (next: OAuthState) =>
          deps.secrets.replace(ctx, connectionSecret, JSON.stringify(next)),
      };
  return new StoredOAuthProvider(store, redirectUrl(deps), state, oauthOptions(connection));
}

/**
 * Builds gateway access for a connection, decrypting credentials only for this call. For a
 * per-user connection these are the caller's own credentials (`ctx.userId`): a run acting for
 * someone uses that person's account and never falls back to anyone else's.
 */
export async function accessFor(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  connection: McpConnection,
): Promise<McpAccess> {
  const base = { endpoint: connection.endpoint, transport: connection.transport };
  if (perUser(connection)) {
    const mine = await findMyMcpCredential(db, ctx, connection.id);
    if (!mine?.secretId || mine.status !== 'connected')
      throw new AppError('MCP_NEEDS_USER_AUTH', 'Connect your account first', {
        connection: ['mcp_needs_user_auth'],
      });
    if (connection.authType === 'bearer')
      return {
        ...base,
        auth: { type: 'bearer', token: await deps.secrets.reveal(ctx, mine.secretId) },
      };
    return {
      ...base,
      auth: { type: 'oauth', provider: oauthProvider(deps, ctx, connection, '', mine.secretId) },
    };
  }
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
 * A per-user connection discovers with the caller's own account.
 */
export async function refreshMcpConnection(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
): Promise<McpConnection> {
  const connection = await requireConnection(db, ctx, id);
  try {
    const found = await discover(await accessFor(db, deps, ctx, connection));
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
    // Nobody has connected an account yet: nothing to discover with, not a failure.
    if (error instanceof AppError && error.code === 'MCP_NEEDS_USER_AUTH') {
      return (await updateMcpConnection(db, ctx, id, {
        status: connection.status === 'connected' ? 'connected' : 'needs_auth',
        lastCheckedAt: new Date(),
      }))!;
    }
    if (!(error instanceof McpGatewayError)) throw error;
    if (error.kind === 'auth' && perUser(connection))
      await upsertMyMcpCredential(db, ctx, id, { status: 'needs_auth' });
    return (await updateMcpConnection(db, ctx, id, {
      status:
        error.kind === 'auth' && (connection.authType === 'oauth' || perUser(connection))
          ? 'needs_auth'
          : 'error',
      lastCheckedAt: new Date(),
      // The server wants sign-in but the connection has none: say so (OpenArt, Google…).
      lastError:
        error.kind === 'auth' && connection.authType === 'none' ? 'auth_required' : error.kind,
    }))!;
  }
}

/**
 * Starts OAuth for a connection: the shared sign-in, or the caller's own for a per-user
 * connection. Returns the URL to send the browser to, or null when stored tokens still work.
 * The random `state` binds the callback to this workspace (and, per user, to this person).
 */
export async function startMcpAuthorization(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
): Promise<string | null> {
  const connection = await requireConnection(db, ctx, id);
  if (connection.authType !== 'oauth') throw new AppError('VALIDATION', 'Not an OAuth connection');
  // Anyone connects their own account; the shared sign-in is the admins'.
  if (!perUser(connection)) await requireWorkspaceAdmin(db, ctx);
  const state = randomBytes(24).toString('base64url');
  let userSecretId: string | undefined;
  if (perUser(connection)) {
    const mine = await findMyMcpCredential(db, ctx, id);
    userSecretId = mine?.secretId ?? (await deps.secrets.create(ctx, 'mcp:oauth-user', '{}'));
    await upsertMyMcpCredential(db, ctx, id, {
      secretId: userSecretId,
      oauthStateHash: hashState(state),
      ...(!mine && { status: 'needs_auth' }),
    });
  } else {
    await updateMcpConnection(db, ctx, id, {
      oauthStateHash: hashState(state),
      status: 'needs_auth',
    });
  }
  const clearState = () =>
    perUser(connection)
      ? upsertMyMcpCredential(db, ctx, id, { oauthStateHash: null })
      : updateMcpConnection(db, ctx, id, { oauthStateHash: null });
  try {
    const result = await beginOAuth(
      oauthProvider(deps, ctx, connection, state, userSecretId),
      connection.endpoint,
    );
    if (result.status === 'redirect') return result.url;
  } catch (error) {
    if (!(error instanceof McpGatewayError)) throw error;
    await clearState();
    if (!perUser(connection))
      await updateMcpConnection(db, ctx, id, { status: 'error', lastError: 'auth' });
    throw new AppError('MCP_UNAVAILABLE', 'Could not start authorization', {
      endpoint: ['mcp_auth'],
    });
  }
  await clearState();
  if (perUser(connection))
    await upsertMyMcpCredential(db, ctx, id, { status: 'connected', connectedAt: new Date() });
  await refreshMcpConnection(db, deps, ctx, id);
  return null;
}

/**
 * OAuth callback: exchanges the code, then discovers tools. `state` must belong to this
 * workspace, and for a per-user connection to the signed-in person.
 */
export async function completeMcpAuthorization(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  input: { state: string; code: string },
): Promise<McpConnection> {
  const stateHash = hashState(input.state);
  const mine = await findMyMcpCredentialByOAuthState(db, ctx, stateHash);
  const connection = mine
    ? await findMcpConnection(db, ctx, mine.connectionId)
    : await findMcpConnectionByOAuthState(db, ctx, stateHash);
  if (!connection) throw new AppError('NOT_FOUND', 'Unknown or expired authorization');
  if (mine) await upsertMyMcpCredential(db, ctx, connection.id, { oauthStateHash: null });
  else await updateMcpConnection(db, ctx, connection.id, { oauthStateHash: null });
  try {
    await completeOAuth(
      oauthProvider(deps, ctx, connection, input.state, mine?.secretId ?? undefined),
      connection.endpoint,
      input.code,
    );
  } catch (error) {
    if (!(error instanceof McpGatewayError)) throw error;
    if (mine) await upsertMyMcpCredential(db, ctx, connection.id, { status: 'needs_auth' });
    else
      await updateMcpConnection(db, ctx, connection.id, {
        status: 'needs_auth',
        lastError: 'auth',
      });
    throw new AppError('MCP_UNAVAILABLE', 'Authorization failed', { endpoint: ['mcp_auth'] });
  }
  if (mine)
    await upsertMyMcpCredential(db, ctx, connection.id, {
      status: 'connected',
      connectedAt: new Date(),
    });
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: mine ? 'mcp.user_connected' : 'mcp.authorized',
    targetType: 'mcp_connection',
    targetId: connection.id,
    outcome: 'success',
  });
  return refreshMcpConnection(db, deps, ctx, connection.id);
}

/** Per-user bearer connections: saves (or replaces) the caller's own token. */
export async function setMyMcpToken(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
  token: string,
): Promise<McpConnection> {
  const connection = await requireConnection(db, ctx, id);
  if (!perUser(connection) || connection.authType !== 'bearer')
    throw new AppError('VALIDATION', 'Not a per-user token connection');
  const value = token.trim();
  if (!value || value.length > 4000)
    throw new AppError('VALIDATION', 'Token required', { token: ['token_required'] });
  const mine = await findMyMcpCredential(db, ctx, id);
  const secretId = mine?.secretId
    ? (await deps.secrets.replace(ctx, mine.secretId, value), mine.secretId)
    : await deps.secrets.create(ctx, 'mcp:bearer-user', value);
  await upsertMyMcpCredential(db, ctx, id, {
    secretId,
    status: 'connected',
    connectedAt: new Date(),
  });
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'mcp.user_connected',
    targetType: 'mcp_connection',
    targetId: id,
    outcome: 'success',
  });
  return refreshMcpConnection(db, deps, ctx, id);
}

/** Disconnect my account: deletes the caller's own tokens; agents acting for them lose access. */
export async function disconnectMyMcpAccount(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
): Promise<void> {
  await requireConnection(db, ctx, id);
  const removed = await deleteMyMcpCredential(db, ctx, id);
  if (removed?.secretId) await deps.secrets.remove(ctx, removed.secretId);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'mcp.user_disconnected',
    targetType: 'mcp_connection',
    targetId: id,
    outcome: 'success',
  });
}

/** What the connection's own secret holds for its sign-in method. */
function connectionSecretFor(data: z.output<typeof connectionSchema>) {
  switch (data.authType) {
    case 'bearer':
      return data.credentialMode === 'per_user' ? null : { kind: 'mcp:bearer', value: data.token! };
    case 'headers':
      return { kind: 'mcp:headers', value: JSON.stringify(parseHeaders(data.headers!)) };
    case 'oauth':
      // A client registered beforehand (e.g. Google) is stored as the client information the
      // SDK would otherwise obtain by dynamic registration.
      return {
        kind: 'mcp:oauth',
        value: JSON.stringify(
          data.oauthClientId
            ? {
                clientInformation: {
                  client_id: data.oauthClientId,
                  ...(data.oauthClientSecret && { client_secret: data.oauthClientSecret }),
                },
              }
            : {},
        ),
      };
    case 'none':
      return null;
  }
}

/** After a connection's sign-in method is set: start OAuth, store the admin's token, or test. */
async function finishSetup(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  connection: McpConnection,
  data: z.output<typeof connectionSchema>,
): Promise<{ connection: McpConnection; authorizationUrl: string | null }> {
  if (data.authType === 'oauth') {
    const authorizationUrl = await startMcpAuthorization(db, deps, ctx, connection.id);
    return { connection: (await findMcpConnection(db, ctx, connection.id))!, authorizationUrl };
  }
  if (data.authType === 'bearer' && data.credentialMode === 'per_user') {
    if (data.token)
      return {
        connection: await setMyMcpToken(db, deps, ctx, connection.id, data.token),
        authorizationUrl: null,
      };
    return {
      connection: (await updateMcpConnection(db, ctx, connection.id, { status: 'needs_auth' }))!,
      authorizationUrl: null,
    };
  }
  return {
    connection: await refreshMcpConnection(db, deps, ctx, connection.id),
    authorizationUrl: null,
  };
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
  await requireWorkspaceAdmin(db, ctx);
  const data = parse(connectionSchema, input);
  const secretValue = connectionSecretFor(data);
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
    credentialMode: data.credentialMode,
    oauthScopes: data.oauthScopes ?? null,
    oauthParams: data.oauthParams,
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
      credentialMode: data.credentialMode,
    },
  });
  return finishSetup(db, deps, ctx, connection, data);
}

/**
 * MCP Hub → connection → Sign-in method: changes how AgentOS authenticates without removing
 * the connection (its tools and agent grants stay). Old credentials, including every
 * member's own, are deleted.
 */
export async function updateMcpConnectionAuth(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
  input: Omit<McpConnectionInput, 'name' | 'serverType' | 'endpoint' | 'transport'>,
): Promise<{ connection: McpConnection; authorizationUrl: string | null }> {
  await requireWorkspaceAdmin(db, ctx);
  const current = await requireConnection(db, ctx, id);
  const data = parse(connectionSchema, {
    ...input,
    name: current.name,
    serverType: current.serverType,
    endpoint: current.endpoint,
    transport: current.transport,
  });
  const oldSecrets = [
    ...(current.secretId ? [current.secretId] : []),
    ...(await listMcpCredentialSecretIds(db, ctx, id)),
  ];
  await deleteMcpCredentialsForConnection(db, ctx, id);
  const secretValue = connectionSecretFor(data);
  const secretId = secretValue
    ? await deps.secrets.create(ctx, secretValue.kind, secretValue.value)
    : null;
  const connection = (await updateMcpConnection(db, ctx, id, {
    authType: data.authType,
    credentialMode: data.credentialMode,
    secretId,
    oauthScopes: data.oauthScopes ?? null,
    oauthParams: data.oauthParams,
    oauthStateHash: null,
    status: 'untested',
    lastError: null,
  }))!;
  for (const old of oldSecrets) await deps.secrets.remove(ctx, old);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'mcp.auth_changed',
    targetType: 'mcp_connection',
    targetId: id,
    outcome: 'success',
    metadata: {
      before: { authType: current.authType, credentialMode: current.credentialMode },
      after: { authType: data.authType, credentialMode: data.credentialMode },
    },
  });
  return finishSetup(db, deps, ctx, connection, data);
}

export async function setMcpConnectionEnabled(
  db: Database,
  ctx: TenantContext,
  id: string,
  enabled: boolean,
) {
  await requireWorkspaceAdmin(db, ctx);
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
  await requireWorkspaceAdmin(db, ctx);
  const connection = await requireConnection(db, ctx, id);
  const memberSecrets = await listMcpCredentialSecretIds(db, ctx, id);
  await deleteMcpConnection(db, ctx, id);
  if (connection.secretId) await deps.secrets.remove(ctx, connection.secretId);
  for (const secret of memberSecrets) await deps.secrets.remove(ctx, secret);
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
  await requireWorkspaceAdmin(db, ctx);
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
  await requireAgentManager(db, ctx, agent);
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
    const result = await callTool(
      await accessFor(db, deps, ctx, connection),
      tool.name,
      input.args,
    );
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

/** MCP Hub → Test: re-discovers tools (owners and admins). */
export async function testMcpConnection(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  id: string,
): Promise<McpConnection> {
  await requireWorkspaceAdmin(db, ctx);
  return refreshMcpConnection(db, deps, ctx, id);
}
