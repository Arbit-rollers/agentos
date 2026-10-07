import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import {
  agentToolPermissions,
  agents,
  mcpConnections,
  mcpTools,
  mcpUserCredentials,
  users,
} from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type McpConnection = typeof mcpConnections.$inferSelect;
export type McpTool = typeof mcpTools.$inferSelect;
export type PermissionModeValue = McpTool['defaultPermission'];

// --- connections -------------------------------------------------------------

export async function insertMcpConnection(
  db: Executor,
  ctx: TenantContext,
  values: Pick<
    McpConnection,
    'name' | 'serverType' | 'transport' | 'endpoint' | 'authType' | 'secretId'
  > &
    Partial<Pick<McpConnection, 'credentialMode' | 'oauthScopes' | 'oauthParams'>>,
): Promise<McpConnection> {
  const [row] = await db
    .insert(mcpConnections)
    .values({ ...values, workspaceId: ctx.workspaceId, ownerUserId: ctx.userId })
    .returning();
  return row!;
}

export async function listMcpConnections(
  db: Executor,
  ctx: TenantContext,
): Promise<McpConnection[]> {
  return db
    .select()
    .from(mcpConnections)
    .where(tenantScope(ctx, mcpConnections))
    .orderBy(asc(mcpConnections.createdAt));
}

export async function findMcpConnection(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<McpConnection | undefined> {
  const [row] = await db
    .select()
    .from(mcpConnections)
    .where(tenantScope(ctx, mcpConnections, eq(mcpConnections.id, id)))
    .limit(1);
  return row;
}

export async function findMcpConnectionByOAuthState(
  db: Executor,
  ctx: TenantContext,
  stateHash: string,
): Promise<McpConnection | undefined> {
  const [row] = await db
    .select()
    .from(mcpConnections)
    .where(tenantScope(ctx, mcpConnections, eq(mcpConnections.oauthStateHash, stateHash)))
    .limit(1);
  return row;
}

export async function updateMcpConnection(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<
      McpConnection,
      | 'name'
      | 'status'
      | 'enabled'
      | 'serverInfo'
      | 'resources'
      | 'oauthStateHash'
      | 'lastCheckedAt'
      | 'lastError'
      | 'secretId'
      | 'authType'
      | 'credentialMode'
      | 'oauthScopes'
      | 'oauthParams'
    >
  >,
): Promise<McpConnection | undefined> {
  const [row] = await db
    .update(mcpConnections)
    .set(values)
    .where(tenantScope(ctx, mcpConnections, eq(mcpConnections.id, id)))
    .returning();
  return row;
}

export async function deleteMcpConnection(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(mcpConnections)
    .where(tenantScope(ctx, mcpConnections, eq(mcpConnections.id, id)))
    .returning({ id: mcpConnections.id });
  return rows.length > 0;
}

/**
 * System-level listing for the worker's health checks: every enabled connection across all
 * workspaces, with the workspace and owner needed to build a TenantContext per connection.
 * Never call this from request handlers.
 */
// --- per-user credentials (v0.4.1) -------------------------------------------

export type McpUserCredential = typeof mcpUserCredentials.$inferSelect;

/** The caller's own credentials for a connection. */
export async function findMyMcpCredential(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
): Promise<McpUserCredential | undefined> {
  const [row] = await db
    .select()
    .from(mcpUserCredentials)
    .where(
      tenantScope(
        ctx,
        mcpUserCredentials,
        eq(mcpUserCredentials.connectionId, connectionId),
        eq(mcpUserCredentials.userId, ctx.userId),
      ),
    )
    .limit(1);
  return row;
}

/** Creates or updates the caller's credential row for a connection. */
export async function upsertMyMcpCredential(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
  values: Partial<
    Pick<McpUserCredential, 'secretId' | 'status' | 'oauthStateHash' | 'connectedAt'>
  >,
): Promise<McpUserCredential> {
  const [row] = await db
    .insert(mcpUserCredentials)
    .values({ ...values, workspaceId: ctx.workspaceId, connectionId, userId: ctx.userId })
    .onConflictDoUpdate({
      target: [mcpUserCredentials.connectionId, mcpUserCredentials.userId],
      set: values,
    })
    .returning();
  return row!;
}

/** The caller's sign-in in progress, found by its `state`. Never another member's. */
export async function findMyMcpCredentialByOAuthState(
  db: Executor,
  ctx: TenantContext,
  stateHash: string,
): Promise<McpUserCredential | undefined> {
  const [row] = await db
    .select()
    .from(mcpUserCredentials)
    .where(
      tenantScope(
        ctx,
        mcpUserCredentials,
        eq(mcpUserCredentials.oauthStateHash, stateHash),
        eq(mcpUserCredentials.userId, ctx.userId),
      ),
    )
    .limit(1);
  return row;
}

export async function deleteMyMcpCredential(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
): Promise<McpUserCredential | undefined> {
  const [row] = await db
    .delete(mcpUserCredentials)
    .where(
      tenantScope(
        ctx,
        mcpUserCredentials,
        eq(mcpUserCredentials.connectionId, connectionId),
        eq(mcpUserCredentials.userId, ctx.userId),
      ),
    )
    .returning();
  return row;
}

/** Secret ids of every member's credentials for a connection (removed with it). */
export async function listMcpCredentialSecretIds(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ secretId: mcpUserCredentials.secretId })
    .from(mcpUserCredentials)
    .where(tenantScope(ctx, mcpUserCredentials, eq(mcpUserCredentials.connectionId, connectionId)));
  return rows.flatMap((r) => (r.secretId ? [r.secretId] : []));
}

/** Drops every member's credentials for a connection (its sign-in method changed). */
export async function deleteMcpCredentialsForConnection(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
): Promise<void> {
  await db
    .delete(mcpUserCredentials)
    .where(tenantScope(ctx, mcpUserCredentials, eq(mcpUserCredentials.connectionId, connectionId)));
}

/** Who has connected their own account (for admins): names and dates, never secrets. */
export async function listMcpConnectedMembers(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
): Promise<{ userId: string; displayName: string; email: string; connectedAt: Date | null }[]> {
  return db
    .select({
      userId: mcpUserCredentials.userId,
      displayName: users.displayName,
      email: users.email,
      connectedAt: mcpUserCredentials.connectedAt,
    })
    .from(mcpUserCredentials)
    .innerJoin(users, eq(users.id, mcpUserCredentials.userId))
    .where(
      tenantScope(
        ctx,
        mcpUserCredentials,
        eq(mcpUserCredentials.connectionId, connectionId),
        eq(mcpUserCredentials.status, 'connected'),
      ),
    )
    .orderBy(asc(users.displayName));
}

export async function listMcpConnectionsForHealthCheck(db: Executor) {
  return db
    .select({
      id: mcpConnections.id,
      workspaceId: mcpConnections.workspaceId,
      ownerUserId: mcpConnections.ownerUserId,
    })
    .from(mcpConnections)
    .where(
      and(eq(mcpConnections.enabled, true), inArray(mcpConnections.status, ['connected', 'error'])),
    );
}

// --- tools -------------------------------------------------------------------

export type DiscoveredToolRow = Pick<
  McpTool,
  | 'name'
  | 'title'
  | 'description'
  | 'inputSchema'
  | 'annotations'
  | 'riskCategory'
  | 'defaultPermission'
>;

/**
 * Syncs a connection's tools with what the server just listed. New tools get the classified
 * default permission; existing tools keep the workspace's choices; tools the server no longer
 * lists are marked unavailable (and can't run) rather than deleted, so grants survive.
 */
export async function syncDiscoveredTools(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
  tools: DiscoveredToolRow[],
): Promise<void> {
  if (tools.length > 0) {
    await db
      .insert(mcpTools)
      .values(tools.map((tool) => ({ ...tool, connectionId, workspaceId: ctx.workspaceId })))
      .onConflictDoUpdate({
        target: [mcpTools.connectionId, mcpTools.name],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          inputSchema: sql`excluded.input_schema`,
          annotations: sql`excluded.annotations`,
          riskCategory: sql`excluded.risk_category`,
          available: true,
          discoveredAt: new Date(),
        },
        setWhere: eq(mcpTools.workspaceId, ctx.workspaceId),
      });
  }
  await db
    .update(mcpTools)
    .set({ available: false })
    .where(
      tenantScope(
        ctx,
        mcpTools,
        and(
          eq(mcpTools.connectionId, connectionId),
          tools.length > 0
            ? notInArray(
                mcpTools.name,
                tools.map((t) => t.name),
              )
            : undefined,
        ),
      ),
    );
}

export async function listMcpTools(
  db: Executor,
  ctx: TenantContext,
  options: { connectionId?: string } = {},
): Promise<McpTool[]> {
  return db
    .select()
    .from(mcpTools)
    .where(
      tenantScope(
        ctx,
        mcpTools,
        options.connectionId ? eq(mcpTools.connectionId, options.connectionId) : undefined,
      ),
    )
    .orderBy(asc(mcpTools.name));
}

export async function findMcpTool(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<McpTool | undefined> {
  const [row] = await db
    .select()
    .from(mcpTools)
    .where(tenantScope(ctx, mcpTools, eq(mcpTools.id, id)))
    .limit(1);
  return row;
}

export async function updateMcpTool(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<Pick<McpTool, 'defaultPermission' | 'enabled'>>,
): Promise<McpTool | undefined> {
  const [row] = await db
    .update(mcpTools)
    .set(values)
    .where(tenantScope(ctx, mcpTools, eq(mcpTools.id, id)))
    .returning();
  return row;
}

// --- per-agent grants --------------------------------------------------------

export type AgentToolGrant = {
  tool: McpTool;
  connection: Pick<McpConnection, 'id' | 'name' | 'enabled' | 'status'>;
  permissionMode: PermissionModeValue;
};

export async function listAgentToolGrants(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
): Promise<AgentToolGrant[]> {
  const rows = await db
    .select({
      tool: mcpTools,
      connection: {
        id: mcpConnections.id,
        name: mcpConnections.name,
        enabled: mcpConnections.enabled,
        status: mcpConnections.status,
      },
      permissionMode: agentToolPermissions.permissionMode,
    })
    .from(agentToolPermissions)
    .innerJoin(mcpTools, eq(mcpTools.id, agentToolPermissions.toolId))
    .innerJoin(mcpConnections, eq(mcpConnections.id, mcpTools.connectionId))
    .where(tenantScope(ctx, agentToolPermissions, eq(agentToolPermissions.agentId, agentId)))
    .orderBy(asc(mcpConnections.name), asc(mcpTools.name));
  return rows;
}

/** Replaces which tools the agent has (wizard step 3), keeping modes for tools it keeps. */
export async function replaceAgentToolSelection(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  tools: Pick<McpTool, 'id' | 'defaultPermission'>[],
): Promise<void> {
  const ids = tools.map((t) => t.id);
  await db
    .delete(agentToolPermissions)
    .where(
      tenantScope(
        ctx,
        agentToolPermissions,
        and(
          eq(agentToolPermissions.agentId, agentId),
          ids.length > 0 ? notInArray(agentToolPermissions.toolId, ids) : undefined,
        ),
      ),
    );
  if (tools.length > 0) {
    await db
      .insert(agentToolPermissions)
      .values(
        tools.map((t) => ({
          agentId,
          toolId: t.id,
          workspaceId: ctx.workspaceId,
          permissionMode: t.defaultPermission,
        })),
      )
      .onConflictDoNothing();
  }
}

export async function setAgentToolMode(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  toolId: string,
  mode: PermissionModeValue,
): Promise<boolean> {
  const rows = await db
    .update(agentToolPermissions)
    .set({ permissionMode: mode, updatedAt: new Date() })
    .where(
      tenantScope(
        ctx,
        agentToolPermissions,
        and(eq(agentToolPermissions.agentId, agentId), eq(agentToolPermissions.toolId, toolId)),
      ),
    )
    .returning({ toolId: agentToolPermissions.toolId });
  return rows.length > 0;
}

/** Agents that hold at least one tool from the connection (connection detail, Screen 3). */
export async function listAgentsUsingConnection(
  db: Executor,
  ctx: TenantContext,
  connectionId: string,
) {
  return db
    .selectDistinct({ id: agents.id, name: agents.name, avatar: agents.avatar })
    .from(agentToolPermissions)
    .innerJoin(mcpTools, eq(mcpTools.id, agentToolPermissions.toolId))
    .innerJoin(agents, eq(agents.id, agentToolPermissions.agentId))
    .where(tenantScope(ctx, agentToolPermissions, eq(mcpTools.connectionId, connectionId)));
}

/** Tool counts per connection (MCP Hub cards). */
export async function countToolsByConnection(
  db: Executor,
  ctx: TenantContext,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ connectionId: mcpTools.connectionId, count: sql<number>`count(*)::int` })
    .from(mcpTools)
    .where(tenantScope(ctx, mcpTools, eq(mcpTools.available, true)))
    .groupBy(mcpTools.connectionId);
  return new Map(rows.map((r) => [r.connectionId, r.count]));
}
