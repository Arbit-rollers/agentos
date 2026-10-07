import type { Database, McpConnection, TenantContext } from '@agentos/db';
import { z } from 'zod';
import { parse } from './auth';
import { AppError } from './errors';
import { createMcpConnection, type McpDeps } from './mcp';

const scope = (...names: string[]) =>
  names.map((n) => `https://www.googleapis.com/auth/${n}`).join(' ');
const DRIVE = ['drive.readonly', 'drive.file'];

/**
 * Google's hosted Workspace MCP servers and the scopes each needs, as published in
 * "Configure the Google Workspace MCP servers" (developers.google.com, Developer Preview).
 */
export const GOOGLE_WORKSPACE_SERVICES = {
  gmail: {
    endpoint: 'https://gmailmcp.googleapis.com/mcp/v1',
    scopes: scope('gmail.readonly', 'gmail.compose'),
  },
  calendar: {
    endpoint: 'https://calendarmcp.googleapis.com/mcp/v1',
    scopes: scope(
      'calendar.calendarlist.readonly',
      'calendar.events.freebusy',
      'calendar.events.readonly',
    ),
  },
  drive: { endpoint: 'https://drivemcp.googleapis.com/mcp/v1', scopes: scope(...DRIVE) },
  docs: {
    endpoint: 'https://docsmcp.googleapis.com/mcp/v1',
    scopes: scope(...DRIVE, 'documents.readonly', 'documents'),
  },
  sheets: {
    endpoint: 'https://sheetsmcp.googleapis.com/mcp/v1',
    scopes: scope(...DRIVE, 'spreadsheets.readonly', 'spreadsheets'),
  },
  slides: {
    endpoint: 'https://slidesmcp.googleapis.com/mcp/v1',
    scopes: scope(...DRIVE, 'presentations.readonly', 'presentations'),
  },
  chat: {
    endpoint: 'https://chatmcp.googleapis.com/mcp/v1',
    scopes: scope(
      'chat.spaces.readonly',
      'chat.memberships.readonly',
      'chat.messages.readonly',
      'chat.messages.create',
      'chat.users.readstate',
    ),
  },
  people: {
    endpoint: 'https://people.googleapis.com/mcp/v1',
    scopes: scope('directory.readonly', 'userinfo.profile', 'contacts.readonly'),
  },
} as const;

export type GoogleService = keyof typeof GOOGLE_WORKSPACE_SERVICES;
export const GOOGLE_SERVICES = Object.keys(GOOGLE_WORKSPACE_SERVICES) as GoogleService[];

const inputSchema = z
  .object({
    services: z.array(z.enum(GOOGLE_SERVICES)).min(1, { error: 'google_service_required' }),
    client: z.enum(['platform', 'own']),
    clientId: z.string().trim().max(500).optional(),
    clientSecret: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.client === 'own' && !value.clientId)
      ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'client_id_required' });
    if (value.client === 'own' && !value.clientSecret)
      ctx.addIssue({ code: 'custom', path: ['clientSecret'], message: 'client_secret_required' });
  });

export type GoogleWorkspaceInput = z.input<typeof inputSchema>;

/**
 * MCP Hub → Google Workspace: one per-user connection per chosen service. Every member then
 * signs in with their own Google account. The OAuth client is AgentOS's own (configured by
 * the operator) or the tenant's (bring your own). Returns the sign-in URL for the first
 * service; the others show "Connect my account" in the hub.
 */
export async function connectGoogleWorkspace(
  db: Database,
  deps: McpDeps,
  ctx: TenantContext,
  input: GoogleWorkspaceInput,
  /** Connection names per service (translated by the caller). */
  names: Record<GoogleService, string>,
): Promise<{ connections: McpConnection[]; authorizationUrl: string | null }> {
  const data = parse(inputSchema, input);
  const client =
    data.client === 'platform'
      ? deps.googleClient
      : { id: data.clientId!, secret: data.clientSecret! };
  if (!client)
    throw new AppError('VALIDATION', 'No platform Google app', {
      client: ['google_platform_missing'],
    });

  const connections: McpConnection[] = [];
  let authorizationUrl: string | null = null;
  for (const service of [...new Set(data.services)]) {
    const spec = GOOGLE_WORKSPACE_SERVICES[service];
    const created = await createMcpConnection(db, deps, ctx, {
      name: names[service],
      serverType: 'google_workspace',
      endpoint: spec.endpoint,
      transport: 'streamable_http',
      authType: 'oauth',
      credentialMode: 'per_user',
      oauthClientId: client.id,
      oauthClientSecret: client.secret,
      oauthScopes: spec.scopes,
      // Google issues refresh tokens only with offline access and a consent prompt.
      oauthParams: { access_type: 'offline', prompt: 'consent' },
    });
    connections.push(created.connection);
    authorizationUrl ??= created.authorizationUrl;
  }
  return { connections, authorizationUrl };
}
