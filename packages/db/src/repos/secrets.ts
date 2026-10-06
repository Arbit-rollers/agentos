import { eq } from 'drizzle-orm';
import type { Executor } from '../client';
import { secrets } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type SecretRow = typeof secrets.$inferSelect;
export type EncryptedSecret = Pick<SecretRow, 'keyVersion' | 'wrappedDek' | 'ciphertext'>;

export async function insertSecret(
  db: Executor,
  ctx: TenantContext,
  values: { kind: string } & EncryptedSecret,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(secrets)
    .values({ ...values, workspaceId: ctx.workspaceId })
    .returning({ id: secrets.id });
  return row!;
}

export async function findSecret(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<SecretRow | undefined> {
  const [row] = await db
    .select()
    .from(secrets)
    .where(tenantScope(ctx, secrets, eq(secrets.id, id)))
    .limit(1);
  return row;
}

export async function updateSecret(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: EncryptedSecret,
): Promise<boolean> {
  const updated = await db
    .update(secrets)
    .set({ ...values, updatedAt: new Date() })
    .where(tenantScope(ctx, secrets, eq(secrets.id, id)))
    .returning({ id: secrets.id });
  return updated.length > 0;
}

export async function deleteSecret(db: Executor, ctx: TenantContext, id: string): Promise<boolean> {
  const deleted = await db
    .delete(secrets)
    .where(tenantScope(ctx, secrets, eq(secrets.id, id)))
    .returning({ id: secrets.id });
  return deleted.length > 0;
}
