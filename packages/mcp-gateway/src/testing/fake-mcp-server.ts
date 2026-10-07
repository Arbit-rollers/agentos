// Test MCP server built from the official SDK's server pieces, so the gateway is tested
// against a reference implementation. Endpoints (all stateless Streamable HTTP unless noted):
//   /mcp          no auth
//   /secure/mcp   bearer token `test-token`
//   /oauth/mcp    OAuth 2.1 (auto-approving authorization server at the same origin)
//   /sse + /messages   legacy HTTP+SSE transport, no auth
// A second listener (`staticUrl`) imitates Google's MCP servers: OAuth with a client that must
// be registered beforehand (no dynamic registration), scopes, and accounts. Its /mcp also
// offers `whoami`, which reports the signed-in account and scopes. The account is chosen with
// `&account=…` on the authorization URL (default `default@example.com`).
// Tools mirror the Google Workspace example in PRD §8.3.
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Request, Response } from 'express';
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

function buildServer(calls: ToolCallRecord[], path: string, whoami = false): McpServer {
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
  if (whoami) {
    server.registerTool(
      'whoami',
      {
        description: 'The signed-in account',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async (args, extra) => {
        record('whoami')(args);
        const info = extra.authInfo;
        const account = (info?.extra?.account as string | undefined) ?? 'anonymous';
        return text(`account: ${account}; scopes: ${(info?.scopes ?? []).join(' ')}`);
      },
    );
  }
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
type Grant = { clientId: string; account: string; scopes: string[] };

class FakeOAuthProvider implements OAuthServerProvider {
  clientsStore: OAuthServerProvider['clientsStore'] = new DemoInMemoryClientsStore();
  accessTokenLifetimeSeconds = 3600;
  /** Query of the last authorization request (tests check scopes and extra parameters). */
  lastAuthorizeQuery: Record<string, unknown> = {};
  private codes = new Map<
    string,
    { client: OAuthClientInformationFull; params: AuthorizationParams; account: string }
  >();
  private access = new Map<string, Grant & { expiresAt: number }>();
  private refresh = new Map<string, Grant>();

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const code = randomUUID();
    const query = { ...(res.req as Request).query } as Record<string, unknown>;
    this.lastAuthorizeQuery = query;
    const account = typeof query.account === 'string' ? query.account : 'default@example.com';
    this.codes.set(code, { client, params, account });
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

  private issue(grant: Grant): OAuthTokens {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    this.access.set(accessToken, {
      ...grant,
      expiresAt: Date.now() + this.accessTokenLifetimeSeconds * 1000,
    });
    this.refresh.set(refreshToken, grant);
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
    return this.issue({
      clientId: client.client_id,
      account: data.account,
      scopes: data.params.scopes ?? [],
    });
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string) {
    const grant = this.refresh.get(refreshToken);
    if (grant?.clientId !== client.client_id) throw new Error('Invalid refresh token');
    this.refresh.delete(refreshToken);
    return this.issue(grant);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = this.access.get(token);
    // InvalidTokenError → 401 with WWW-Authenticate, which tells clients to refresh.
    if (!data || data.expiresAt < Date.now())
      throw new InvalidTokenError('Invalid or expired token');
    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: Math.floor(data.expiresAt / 1000),
      extra: { account: data.account },
    };
  }
}

/** The pre-registered client the Google-like server accepts. */
export const STATIC_CLIENT = { id: 'static-client', secret: 'static-secret' } as const;

export function startFakeMcpServer(
  options: { port?: number; staticPort?: number; staticRedirectUris?: string[] } = {},
) {
  const calls: ToolCallRecord[] = [];
  const oauth = new FakeOAuthProvider();
  const staticOAuth = new FakeOAuthProvider();
  const staticClient: OAuthClientInformationFull = {
    client_id: STATIC_CLIENT.id,
    client_secret: STATIC_CLIENT.secret,
    redirect_uris: options.staticRedirectUris ?? ['http://localhost:3000/api/mcp/oauth/callback'],
    token_endpoint_auth_method: 'client_secret_post',
  };
  // No registerClient: the authorization server publishes no registration endpoint.
  staticOAuth.clientsStore = {
    getClient: async (id: string) => (id === STATIC_CLIENT.id ? staticClient : undefined),
  };
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  let baseUrl = '';

  const handle =
    (path: string, whoami = false) =>
    async (req: Parameters<Parameters<typeof app.post>[1]>[0], res: Response) => {
      const server = buildServer(calls, path, whoami);
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

  // Google-like server on its own origin (its authorization server lives at that origin).
  const staticApp = createMcpExpressApp({ host: '127.0.0.1' });
  const staticServer: Server = staticApp.listen(options.staticPort ?? 0, '127.0.0.1');
  const staticReady = new Promise<string>((resolve) => {
    staticServer.on('listening', () => {
      const address = staticServer.address();
      const port = typeof address === 'object' && address ? address.port : options.staticPort;
      const origin = `http://127.0.0.1:${port}`;
      const resourceServerUrl = new URL(`${origin}/mcp`);
      staticApp.use(
        mcpAuthRouter({ provider: staticOAuth, issuerUrl: new URL(origin), resourceServerUrl }),
      );
      staticApp.post(
        '/mcp',
        requireBearerAuth({
          verifier: staticOAuth,
          resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
        }),
        handle('/static/mcp', true),
      );
      resolve(origin);
    });
  });

  const server: Server = app.listen(options.port ?? 0, '127.0.0.1');
  const ready = new Promise<{ url: string; staticUrl: string }>((resolve) => {
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
      void staticReady.then((staticUrl) => resolve({ url: baseUrl, staticUrl }));
    });
  });

  return {
    ready,
    calls,
    oauth,
    staticOAuth,
    close: () =>
      Promise.all(
        [server, staticServer].map(
          (s) =>
            new Promise<void>((resolve) => {
              s.closeAllConnections();
              s.close(() => resolve());
            }),
        ),
      ).then(() => undefined),
  };
}
