import {
  deleteSecret as deleteSecretRow,
  findSecret,
  insertSecret,
  updateSecret as updateSecretRow,
  type Executor,
  type TenantContext,
} from '@agentos/db';
import { recordAudit } from './audit';
import type { SecretCipher } from './crypto';
import { AppError } from './errors';

// Binds each ciphertext to its workspace and purpose.
const contextFor = (ctx: TenantContext, kind: string) => `${ctx.workspaceId}:${kind}`;

/**
 * Workspace secret store. Callers hold only the returned id (`secret_ref`); the plaintext is
 * read back solely at the point of use (model / MCP gateway calls) and never logged.
 */
export function createSecretStore(db: Executor, cipher: SecretCipher) {
  return {
    async create(ctx: TenantContext, kind: string, plaintext: string): Promise<string> {
      const { id } = await insertSecret(db, ctx, {
        kind,
        ...cipher.encrypt(plaintext, contextFor(ctx, kind)),
      });
      await recordAudit(db, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'secret.created',
        targetType: 'secret',
        targetId: id,
        outcome: 'success',
        metadata: { kind },
      });
      return id;
    },

    async reveal(ctx: TenantContext, id: string): Promise<string> {
      const row = await findSecret(db, ctx, id);
      if (!row) throw new AppError('NOT_FOUND', 'Secret not found');
      return cipher.decrypt(row, contextFor(ctx, row.kind));
    },

    async replace(ctx: TenantContext, id: string, plaintext: string): Promise<void> {
      const row = await findSecret(db, ctx, id);
      if (!row) throw new AppError('NOT_FOUND', 'Secret not found');
      await updateSecretRow(db, ctx, id, cipher.encrypt(plaintext, contextFor(ctx, row.kind)));
      await recordAudit(db, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'secret.updated',
        targetType: 'secret',
        targetId: id,
        outcome: 'success',
        metadata: { kind: row.kind },
      });
    },

    async remove(ctx: TenantContext, id: string): Promise<void> {
      if (!(await deleteSecretRow(db, ctx, id)))
        throw new AppError('NOT_FOUND', 'Secret not found');
      await recordAudit(db, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'secret.deleted',
        targetType: 'secret',
        targetId: id,
        outcome: 'success',
      });
    },
  };
}

export type SecretStore = ReturnType<typeof createSecretStore>;
