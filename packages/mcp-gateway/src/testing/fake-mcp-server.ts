// Test MCP server built from the official SDK's server pieces, so the gateway is tested
// against a reference implementation. Endpoints (all stateless Streamable HTTP unless noted):
//   /mcp          no auth
//   /secure/mcp   bearer token `test-token`
//   /oauth/mcp    OAuth 2.1 (auto-approving authorization server at the same origin)
//   /sse + /messages   legacy HTTP+SSE transport, no auth
// Tools mirror the Google Workspace example in PRD §8.3.
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Response } from 'express';
import { DemoInMemoryClientsStore } from '@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import * as z from 'zod/v4';

export const FAKE_TOOLS = [
  'search_documents',
  'read_document',
  'gmail_send',
  'calendar_create',
  'drive_delete',
  'flaky_tool',
] as const;

export type ToolCallRecord = { name: string; args: Record<string, unknown>; path: string };

function buildServer(calls: ToolCallRecord[], path: string): McpServer {
  const server = new McpServer({
    name: 'fake-workspace',
    version: '1.0.0',
    title: 'Fake Workspace',
  });
  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
  const record = (name: string) => (args: Record<string, unknown>) => {
    calls.push({ name, args, path });
  };

  server.registerTool(
    'search_documents',
    {
      description: 'Search documents',
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => (record('search_documents')(args), text(`results for ${args.query}`)),
  );
  server.registerTool(
    'read_document',
    { description: 'Read a document', inputSchema: { id: z.string() } },
    async (args) => (record('read_document')(args), text(`document ${args.id}`)),
  );
  server.registerTool(
    'gmail_send',
    { description: 'Send an email', inputSchema: { to: z.string(), body: z.string() } },
    async (args) => (record('gmail_send')(args), text(`sent to ${args.to}`)),
  );
  server.registerTool(
    'calendar_create',
    { description: 'Create a calendar event', inputSchema: { title: z.string() } },
    async (args) => (record('calendar_create')(args), text(`created ${args.title}`)),
  );
  server.registerTool(
    'drive_delete',
    {
      description: 'Delete a file',
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async (args) => (record('drive_delete')(args), text(`deleted ${args.id}`)),
  );
  server.registerTool(
    'flaky_tool',
    { description: 'Always fails at the tool level', inputSchema: {} },
    async (args) => {
      record('flaky_tool')(args);
      return { ...text('upstream API error'), isError: true };
    },
  );
  server.registerResource(
    'readme',
    'file:///readme.md',
    { description: 'Read me', mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: '# Fake' }],
    }),
  );
  return server;
}

/** Auto-approving OAuth server with refresh tokens; access tokens can be made to expire at once. */
class FakeOAuthProvider implements OAuthServerProvider {
  clientsStore = new DemoInMemoryClientsStore();
  accessTokenLifetimeSeconds = 3600;
  private codes = new Map<
    string,
    { client: OAuthClientInformationFull; params: AuthorizationParams }
  >();
  private access = new Map<string, { clientId: string; expiresAt: number }>();
  private refresh = new Map<string, string>();

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const code = randomUUID();
    this.codes.set(code, { client, params });
    const target = new URL(params.redirectUri);
    target.searchParams.set('code', code);
    if (params.state) target.searchParams.set('state', params.state);
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, code: string) {
    const data = this.codes.get(code);
    if (!data) throw new Error('Invalid authorization code');
    return data.params.codeChallenge;
  }

  private issue(clientId: string): OAuthTokens {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    this.access.set(accessToken, {
      clientId,
      expiresAt: Date.now() + this.accessTokenLifetimeSeconds * 1000,
    });
    this.refresh.set(refreshToken, clientId);
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: this.accessTokenLifetimeSeconds,
      refresh_token: refreshToken,
    };
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    const data = this.codes.get(code);
    if (!data || data.client.client_id !== client.client_id)
      throw new Error('Invalid authorization code');
    this.codes.delete(code);
    return this.issue(client.client_id);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string) {
    if (this.refresh.get(refreshToken) !== client.client_id)
      throw new Error('Invalid refresh token');
    this.refresh.delete(refreshToken);
    return this.issue(client.client_id);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = this.access.get(token);
    // InvalidTokenError → 401 with WWW-Authenticate, which tells clients to refresh.
    if (!data || data.expiresAt < Date.now())
      throw new InvalidTokenError('Invalid or expired token');
    return {
      token,
      clientId: data.clientId,
      scopes: [],
      expiresAt: Math.floor(data.expiresAt / 1000),
    };
  }
}

export function startFakeMcpServer(options: { port?: number } = {}) {
  const calls: ToolCallRecord[] = [];
  const oauth = new FakeOAuthProvider();
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  let baseUrl = '';

  const handle =
    (path: string) => async (req: Parameters<Parameters<typeof app.post>[1]>[0], res: Response) => {
      const server = buildServer(calls, path);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    };

  app.post('/mcp', handle('/mcp'));
  app.post(
    '/secure/mcp',
    (req, res, next) =>
      req.headers.authorization === 'Bearer test-token'
        ? next()
        : res.status(401).json({ error: 'unauthorized' }),
    handle('/secure/mcp'),
  );

  // Legacy HTTP+SSE.
  const sseSessions = new Map<string, SSEServerTransport>();
  app.get('/sse', async (_req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    sseSessions.set(transport.sessionId, transport);
    res.on('close', () => sseSessions.delete(transport.sessionId));
    await buildServer(calls, '/sse').connect(transport);
  });
  app.post('/messages', async (req, res) => {
    const transport = sseSessions.get(String(req.query.sessionId));
    if (!transport) return void res.status(404).end();
    await transport.handlePostMessage(req, res, req.body);
  });

  const server: Server = app.listen(options.port ?? 0, '127.0.0.1');
  const ready = new Promise<{ url: string }>((resolve) => {
    server.on('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      baseUrl = `http://127.0.0.1:${port}`;
      // OAuth routes need the final origin, so they are mounted once the port is known.
      const issuerUrl = new URL(baseUrl);
      const resourceServerUrl = new URL(`${baseUrl}/oauth/mcp`);
      app.use(mcpAuthRouter({ provider: oauth, issuerUrl, resourceServerUrl }));
      app.post(
        '/oauth/mcp',
        requireBearerAuth({
          verifier: oauth,
          resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
        }),
        handle('/oauth/mcp'),
      );
      resolve({ url: baseUrl });
    });
  });

  return {
    ready,
    calls,
    oauth,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
