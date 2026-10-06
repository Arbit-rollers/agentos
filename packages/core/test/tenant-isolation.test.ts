// AC 2: user A must not be able to reach user B's resources by supplying B's ids.
// Every tenant-owned repository/service gets a case here as it is added.
import { getWorkspace, listAuditLogs } from '@agentos/db';
import { describe, expect, it } from 'vitest';
import { createSecretCipher } from '../src/crypto';
import { AppError } from '../src/errors';
import { createSecretStore } from '../src/secrets';
import { createUser, useTestDb } from './helpers';

const { db, sql } = useTestDb();
const secretStore = createSecretStore(
  db,
  createSecretCipher(Buffer.alloc(32, 9).toString('base64')),
);

const notFound = (e: unknown) => e instanceof AppError && e.code === 'NOT_FOUND';

describe('tenant isolation', () => {
  it('workspaces: only members can read a workspace', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    expect(await getWorkspace(db, alice.ctx, alice.workspace.id)).toBeDefined();
    expect(await getWorkspace(db, alice.ctx, bob.workspace.id)).toBeUndefined();
  });

  it('secrets: another workspace cannot reveal, replace or delete them', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const id = await secretStore.create(bob.ctx, 'provider:openai', 'sk-bob-secret-value');

    await expect(secretStore.reveal(alice.ctx, id)).rejects.toSatisfy(notFound);
    await expect(secretStore.replace(alice.ctx, id, 'stolen')).rejects.toSatisfy(notFound);
    await expect(secretStore.remove(alice.ctx, id)).rejects.toSatisfy(notFound);

    // The failed attempts left Bob's secret untouched.
    expect(await secretStore.reveal(bob.ctx, id)).toBe('sk-bob-secret-value');
  });

  it('secrets: a ciphertext copied into another workspace does not decrypt', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const id = await secretStore.create(bob.ctx, 'provider:openai', 'sk-bob-secret-value');
    await sql`update secrets set workspace_id = ${alice.workspace.id} where id = ${id}`;
    await expect(secretStore.reveal(alice.ctx, id)).rejects.toThrow();
  });

  it('audit logs: each workspace sees only its own events', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const aliceLogs = await listAuditLogs(db, alice.ctx);
    expect(aliceLogs.length).toBeGreaterThan(0);
    expect(aliceLogs.every((log) => log.workspaceId === alice.workspace.id)).toBe(true);
    expect(aliceLogs.some((log) => log.actorUserId === bob.user.id)).toBe(false);
  });
});

describe('secret store', () => {
  it('stores ciphertext only and audits without the value', async () => {
    const alice = await createUser(db);
    await secretStore.create(alice.ctx, 'provider:anthropic', 'sk-ant-very-secret-value');
    const rows = await sql`select * from secrets`;
    expect(JSON.stringify(rows)).not.toContain('sk-ant-very-secret-value');
    const logs = await sql`select metadata from audit_logs where action = 'secret.created'`;
    expect(JSON.stringify(logs)).not.toContain('sk-ant');
  });

  it('replaces and removes a secret', async () => {
    const alice = await createUser(db);
    const id = await secretStore.create(alice.ctx, 'mcp:token', 'first');
    await secretStore.replace(alice.ctx, id, 'second');
    expect(await secretStore.reveal(alice.ctx, id)).toBe('second');
    await secretStore.remove(alice.ctx, id);
    await expect(secretStore.reveal(alice.ctx, id)).rejects.toSatisfy(notFound);
  });
});
