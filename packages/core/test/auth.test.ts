import { listAuditLogs } from '@agentos/db';
import { describe, expect, it } from 'vitest';
import {
  SESSION_TTL_MS,
  authenticate,
  hashSessionToken,
  login,
  logout,
  register,
} from '../src/auth';
import { AppError } from '../src/errors';
import { createUser, useTestDb } from './helpers';

const { db, sql } = useTestDb();
const PASSWORD = 'correct horse battery';

async function expectAppError(promise: Promise<unknown>, code: AppError['code']) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

describe('register', () => {
  it('creates the user, a private default workspace and an owner membership (AC 1)', async () => {
    const session = await createUser(db, '  Alice@Example.COM ');
    expect(session.user.email).toBe('alice@example.com');
    expect(session.workspace.name).toBe('Personal');
    expect(session.role).toBe('owner');
    expect(session.ctx).toEqual({ userId: session.user.id, workspaceId: session.workspace.id });

    const actions = (await listAuditLogs(db, session.ctx)).map((log) => log.action).sort();
    expect(actions).toEqual(['user.registered', 'workspace.created']);
  });

  it('stores an Argon2id hash, never the password, and only a hash of the session token', async () => {
    const { token } = await createUser(db);
    const [user] = await sql`select password_hash from users`;
    expect(user!.password_hash).toMatch(/^\$argon2id\$/);
    const [session] = await sql`select id from sessions`;
    expect(session!.id).toBe(hashSessionToken(token));
    expect(session!.id).not.toBe(token);
  });

  it('rejects duplicate emails case-insensitively', async () => {
    await createUser(db, 'bob@example.com');
    await expectAppError(
      register(db, { email: 'BOB@example.com', password: PASSWORD }),
      'EMAIL_TAKEN',
    );
  });

  it('validates email and password length', async () => {
    await expect(register(db, { email: 'nope', password: 'short' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { email: expect.any(Array), password: expect.any(Array) },
    });
  });
});

describe('login', () => {
  it('signs in with the right password and audits it', async () => {
    const { ctx } = await createUser(db, 'carol@example.com');
    const { token } = await login(db, { email: 'Carol@example.com', password: PASSWORD });
    expect((await authenticate(db, token))?.ctx).toEqual(ctx);
    const logins = (await listAuditLogs(db, ctx)).filter((log) => log.action === 'auth.login');
    expect(logins.map((log) => log.outcome)).toEqual(['success']);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { ctx } = await createUser(db, 'dave@example.com');
    await expectAppError(
      login(db, { email: 'dave@example.com', password: 'wrong password!' }),
      'INVALID_CREDENTIALS',
    );
    await expectAppError(
      login(db, { email: 'nobody@example.com', password: PASSWORD }),
      'INVALID_CREDENTIALS',
    );
    const failures = (await listAuditLogs(db, ctx)).filter((log) => log.outcome === 'failure');
    expect(failures).toHaveLength(1);
  });

  it('refuses disabled accounts', async () => {
    await createUser(db, 'erin@example.com');
    await sql`update users set status = 'disabled' where email = 'erin@example.com'`;
    await expectAppError(
      login(db, { email: 'erin@example.com', password: PASSWORD }),
      'ACCOUNT_DISABLED',
    );
  });
});

describe('authenticate', () => {
  it('returns null for missing, unknown and expired tokens', async () => {
    const { token } = await createUser(db);
    expect(await authenticate(db, undefined)).toBeNull();
    expect(await authenticate(db, 'not-a-real-token')).toBeNull();
    const later = new Date(Date.now() + SESSION_TTL_MS + 1000);
    expect(await authenticate(db, token, later)).toBeNull();
  });

  it('renews a session once less than half its lifetime remains', async () => {
    const { token } = await createUser(db);
    expect((await authenticate(db, token))?.renewedExpiresAt).toBeUndefined();
    const later = new Date(Date.now() + SESSION_TTL_MS * 0.75);
    const renewed = await authenticate(db, token, later);
    expect(renewed?.renewedExpiresAt?.getTime()).toBe(later.getTime() + SESSION_TTL_MS);
  });

  it('ends the session when the user is disabled or loses membership', async () => {
    const first = await createUser(db);
    await sql`update users set status = 'disabled' where id = ${first.user.id}`;
    expect(await authenticate(db, first.token)).toBeNull();

    const second = await createUser(db);
    await sql`delete from workspace_members where user_id = ${second.user.id}`;
    expect(await authenticate(db, second.token)).toBeNull();
    const [{ count }] = await sql`select count(*)::int as count from sessions`;
    expect(count).toBe(0);
  });
});

describe('logout', () => {
  it('invalidates the session and audits it', async () => {
    const { token, ctx } = await createUser(db);
    await logout(db, token);
    expect(await authenticate(db, token)).toBeNull();
    expect((await listAuditLogs(db, ctx)).map((log) => log.action)).toContain('auth.logout');
  });
});
