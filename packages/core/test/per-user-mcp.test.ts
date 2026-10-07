import {
  addWorkspaceMember,
  findMyMcpCredential,
  listMcpConnectedMembers,
  listMcpTools,
  listRunsWithDetails,
} from '@agentos/db';
import { STATIC_CLIENT } from '@agentos/mcp-gateway/testing';
import { describe, expect, it } from 'vitest';
import {
  completeMcpAuthorization,
  createMcpConnection,
  disconnectMyMcpAccount,
  refreshMcpConnection,
  setAgentTools,
  setMyMcpToken,
  startMcpAuthorization,
  updateMcpConnectionAuth,
} from '../src/mcp';
import { GOOGLE_WORKSPACE_SERVICES, connectGoogleWorkspace } from '../src/google-workspace';
import { startChatTurn } from '../src/runtime';
import { createTask } from '../src/tasks';
import { createUser } from './helpers';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();
type Ctx = { workspaceId: string; userId: string };

/** Follows the authorization URL as `account` and completes the callback for `ctx`. */
async function signIn(ctx: Ctx, authorizationUrl: string, account: string) {
  const url = new URL(authorizationUrl);
  url.searchParams.set('account', account);
  const response = await fetch(url, { redirect: 'manual' });
  const callback = new URL(response.headers.get('location')!);
  return completeMcpAuthorization(fx.db, fx.deps, ctx, {
    state: callback.searchParams.get('state')!,
    code: callback.searchParams.get('code')!,
  });
}

/** A Google-like per-user connection (pre-registered client, scopes, offline access). */
async function googleLike(ctx: Ctx) {
  return createMcpConnection(fx.db, fx.deps, ctx, {
    name: 'Gmail',
    serverType: 'google_gmail',
    endpoint: `${(await fx.mcp.ready).staticUrl}/mcp`,
    transport: 'streamable_http',
    authType: 'oauth',
    credentialMode: 'per_user',
    oauthClientId: STATIC_CLIENT.id,
    oauthClientSecret: STATIC_CLIENT.secret,
    oauthScopes: 'mail.read mail.compose',
    oauthParams: { access_type: 'offline', prompt: 'consent' },
  });
}

/** Admin + a second member of the same workspace, sharing an agent that can call whoami. */
async function team() {
  const admin = await fx.setup();
  const other = await createUser(fx.db);
  await addWorkspaceMember(fx.db, {
    workspaceId: admin.ctx.workspaceId,
    userId: other.ctx.userId,
    role: 'member',
  });
  const member: Ctx = { workspaceId: admin.ctx.workspaceId, userId: other.ctx.userId };
  return { admin, member };
}

async function whoami(ctx: Ctx, agentId: string) {
  await startChatTurn(fx.db, fx.deps, ctx, agentId, { message: 'Who am I? [[call:whoami:{}]]' });
  await fx.drain(ctx);
  const [run] = await listRunsWithDetails(fx.db, ctx, { agentId, limit: 1 });
  return run!.toolCalls.at(-1)!.result ?? '';
}

describe('per-user MCP connections (v0.4.1)', () => {
  it('signs each member in with their own account; runs use the account of the person they act for', async () => {
    const { admin, member } = await team();
    const { connection, authorizationUrl } = await googleLike(admin.ctx);
    // Pre-registered client, requested scopes and Google-style offline access; no registration.
    const url = new URL(authorizationUrl!);
    expect(url.searchParams.get('client_id')).toBe(STATIC_CLIENT.id);
    expect(url.searchParams.get('scope')).toBe('mail.read mail.compose');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');

    const connected = await signIn(admin.ctx, authorizationUrl!, 'alice@example.com');
    expect(connected.status).toBe('connected');
    const tools = await listMcpTools(fx.db, admin.ctx, { connectionId: connection.id });
    const whoamiTool = tools.find((t) => t.name === 'whoami')!;
    await setAgentTools(fx.db, admin.ctx, admin.agent.id, [whoamiTool.id]);

    // The member hasn't connected: told to connect, never served Alice's account.
    const before = await whoami(member, admin.agent.id);
    expect(before).toContain('has not connected their own account to "Gmail"');
    expect(before).not.toContain('alice');

    await signIn(
      member,
      (await startMcpAuthorization(fx.db, fx.deps, member, connection.id))!,
      'bob@example.com',
    );

    expect(await whoami(admin.ctx, admin.agent.id)).toBe(
      'account: alice@example.com; scopes: mail.read mail.compose',
    );
    expect(await whoami(member, admin.agent.id)).toBe(
      'account: bob@example.com; scopes: mail.read mail.compose',
    );

    // A task runs as its creator.
    await createTask(fx.db, fx.deps, member, {
      agentId: admin.agent.id,
      objective: 'Check [[call:whoami:{}]]',
    });
    await fx.drain(member);
    const [taskRun] = await listRunsWithDetails(fx.db, member, {
      agentId: admin.agent.id,
      limit: 1,
    });
    expect(taskRun!.toolCalls.at(-1)!.result).toContain('bob@example.com');

    const members = await listMcpConnectedMembers(fx.db, admin.ctx, connection.id);
    expect(members.map((m) => m.userId).sort()).toEqual([admin.ctx.userId, member.userId].sort());

    // Disconnecting removes only my credentials; the next call asks me to connect again.
    await disconnectMyMcpAccount(fx.db, fx.deps, member, connection.id);
    expect(await findMyMcpCredential(fx.db, member, connection.id)).toBeUndefined();
    expect(await whoami(member, admin.agent.id)).toContain('has not connected');
    expect(await whoami(admin.ctx, admin.agent.id)).toContain('alice@example.com');
  });

  it("a member can't finish someone else's sign-in", async () => {
    const { admin, member } = await team();
    const { authorizationUrl } = await googleLike(admin.ctx);
    await expect(signIn(member, authorizationUrl!, 'mallory@example.com')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('per-user tokens: each member pastes their own', async () => {
    const { admin, member } = await team();
    const { connection } = await createMcpConnection(fx.db, fx.deps, admin.ctx, {
      name: 'Secure',
      endpoint: `${(await fx.mcp.ready).url}/secure/mcp`,
      transport: 'streamable_http',
      authType: 'bearer',
      credentialMode: 'per_user',
    });
    expect(connection.status).toBe('needs_auth');
    await expect(
      setMyMcpToken(fx.db, fx.deps, admin.ctx, connection.id, 'wrong'),
    ).resolves.toMatchObject({ status: 'needs_auth' });
    const ok = await setMyMcpToken(fx.db, fx.deps, admin.ctx, connection.id, 'test-token');
    expect(ok.status).toBe('connected');
    expect(await findMyMcpCredential(fx.db, member, connection.id)).toBeUndefined();
  });

  it('changing the sign-in method keeps the connection; a "None" connection that needs sign-in says so', async () => {
    const { ctx } = await fx.setup();
    const { connection } = await createMcpConnection(fx.db, fx.deps, ctx, {
      name: 'Locked',
      endpoint: `${(await fx.mcp.ready).url}/oauth/mcp`,
      transport: 'streamable_http',
      authType: 'none',
    });
    expect(connection).toMatchObject({ status: 'error', lastError: 'auth_required' });
    const { authorizationUrl } = await updateMcpConnectionAuth(fx.db, fx.deps, ctx, connection.id, {
      authType: 'oauth',
    });
    const done = await signIn(ctx, authorizationUrl!, 'default@example.com');
    expect(done).toMatchObject({ id: connection.id, status: 'connected', authType: 'oauth' });
    expect((await refreshMcpConnection(fx.db, fx.deps, ctx, connection.id)).status).toBe(
      'connected',
    );
  });
});

describe('Google Workspace template', () => {
  const names = {
    gmail: 'Gmail',
    calendar: 'Calendar',
    drive: 'Drive',
    docs: 'Docs',
    sheets: 'Sheets',
    slides: 'Slides',
    chat: 'Chat',
    people: 'People',
  };
  it('needs at least one service, and a client: the platform one or your own', async () => {
    const { ctx } = await fx.setup();
    await expect(
      connectGoogleWorkspace(fx.db, fx.deps, ctx, { services: [], client: 'own' }, names),
    ).rejects.toMatchObject({
      details: {
        services: ['google_service_required'],
        clientId: ['client_id_required'],
        clientSecret: ['client_secret_required'],
      },
    });
    await expect(
      connectGoogleWorkspace(
        fx.db,
        fx.deps,
        ctx,
        { services: ['gmail'], client: 'platform' },
        names,
      ),
    ).rejects.toMatchObject({ details: { client: ['google_platform_missing'] } });
  });

  it('lists the official endpoints with per-service scopes', () => {
    expect(GOOGLE_WORKSPACE_SERVICES.gmail).toEqual({
      endpoint: 'https://gmailmcp.googleapis.com/mcp/v1',
      scopes:
        'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
    });
    expect(GOOGLE_WORKSPACE_SERVICES.docs.scopes).toContain('auth/drive.file');
  });
});
