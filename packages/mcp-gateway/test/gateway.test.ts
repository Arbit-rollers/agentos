import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  McpGatewayError,
  StoredOAuthProvider,
  beginOAuth,
  callTool,
  completeOAuth,
  discover,
  type McpAccess,
  type OAuthState,
} from '../src/index';
import { FAKE_TOOLS, startFakeMcpServer } from '../src/testing/fake-mcp-server';

const fake = startFakeMcpServer();
let base = '';
beforeAll(async () => {
  base = (await fake.ready).url;
});
afterAll(() => fake.close());

const open = (path: string): McpAccess => ({
  endpoint: `${base}${path}`,
  transport: 'streamable_http',
  auth: { type: 'none' },
});

describe('discovery (PRD §8.3)', () => {
  it('lists tools with schemas and annotations, plus resources', async () => {
    const found = await discover(open('/mcp'));
    expect(found.server).toMatchObject({ name: 'fake-workspace', title: 'Fake Workspace' });
    expect(found.tools.map((t) => t.name).sort()).toEqual([...FAKE_TOOLS].sort());
    const search = found.tools.find((t) => t.name === 'search_documents')!;
    expect(search.annotations).toEqual({ readOnlyHint: true });
    expect(search.inputSchema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    });
    expect(found.resources).toEqual([
      {
        uri: 'file:///readme.md',
        name: 'readme',
        description: 'Read me',
        mimeType: 'text/markdown',
      },
    ]);
  });

  it('works over legacy HTTP+SSE', async () => {
    const found = await discover({
      endpoint: `${base}/sse`,
      transport: 'sse',
      auth: { type: 'none' },
    });
    expect(found.tools).toHaveLength(FAKE_TOOLS.length);
  });

  it('sends bearer tokens and classifies rejections as auth errors', async () => {
    const access = (token: string): McpAccess => ({
      ...open('/secure/mcp'),
      auth: { type: 'bearer', token },
    });
    expect((await discover(access('test-token'))).tools.length).toBeGreaterThan(0);
    await expect(discover(access('wrong'))).rejects.toMatchObject({ kind: 'auth' });
    await expect(
      discover({
        ...open('/secure/mcp'),
        auth: { type: 'headers', headers: { Authorization: 'Bearer test-token' } },
      }),
    ).resolves.toBeTruthy();
  });

  it('reports unreachable servers as unavailable', async () => {
    await expect(
      discover({
        endpoint: 'http://127.0.0.1:1/mcp',
        transport: 'streamable_http',
        auth: { type: 'none' },
      }),
    ).rejects.toSatisfy((e) => e instanceof McpGatewayError && e.kind === 'unavailable');
  });
});

describe('callTool', () => {
  it('returns tool output and passes arguments through', async () => {
    const result = await callTool(open('/mcp'), 'search_documents', { query: 'aviation' });
    expect(result).toMatchObject({ isError: false, text: 'results for aviation' });
    expect(fake.calls.at(-1)).toEqual({
      name: 'search_documents',
      args: { query: 'aviation' },
      path: '/mcp',
    });
  });

  it('never reports a tool-level failure as success (AC 22)', async () => {
    expect(await callTool(open('/mcp'), 'flaky_tool', {})).toMatchObject({
      isError: true,
      text: 'upstream API error',
    });
  });
});

describe('OAuth 2.1 (authorization code + PKCE, dynamic registration, refresh)', () => {
  const memoryStore = () => {
    let state: OAuthState = {};
    return {
      load: async () => state,
      save: async (next: OAuthState) => void (state = next),
      peek: () => state,
    };
  };
  const REDIRECT = 'http://localhost:3000/api/mcp/oauth/callback';

  async function authorize(store: ReturnType<typeof memoryStore>) {
    const endpoint = `${base}/oauth/mcp`;
    const provider = new StoredOAuthProvider(store, REDIRECT, 'state-123');
    const started = await beginOAuth(provider, endpoint);
    expect(started.status).toBe('redirect');
    const url = new URL((started as { url: string }).url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(store.peek().clientInformation?.client_id).toBeTruthy(); // registered dynamically

    // The browser would follow this; the fake server auto-approves and redirects back.
    const response = await fetch(url, { redirect: 'manual' });
    const callback = new URL(response.headers.get('location')!);
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT);
    await completeOAuth(provider, endpoint, callback.searchParams.get('code')!);
    expect(store.peek().tokens?.access_token).toBeTruthy();
    expect(store.peek().codeVerifier).toBeUndefined();
    return { endpoint, provider };
  }

  it('authorizes, then connects with the stored token', async () => {
    const store = memoryStore();
    const { endpoint, provider } = await authorize(store);
    const found = await discover({
      endpoint,
      transport: 'streamable_http',
      auth: { type: 'oauth', provider },
    });
    expect(found.tools.length).toBe(FAKE_TOOLS.length);
  });

  it('refreshes an expired access token automatically', async () => {
    fake.oauth.accessTokenLifetimeSeconds = 0;
    const store = memoryStore();
    const { endpoint, provider } = await authorize(store);
    fake.oauth.accessTokenLifetimeSeconds = 3600;
    const expired = store.peek().tokens!.access_token;
    await discover({ endpoint, transport: 'streamable_http', auth: { type: 'oauth', provider } });
    expect(store.peek().tokens!.access_token).not.toBe(expired);
  });

  it('without tokens, connecting fails as an auth error', async () => {
    const provider = new StoredOAuthProvider(memoryStore(), REDIRECT, 's');
    await expect(
      discover({
        endpoint: `${base}/oauth/mcp`,
        transport: 'streamable_http',
        auth: { type: 'oauth', provider },
      }),
    ).rejects.toMatchObject({ kind: 'auth' });
  });
});
