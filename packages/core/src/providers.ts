import {
  countConnectionUsage,
  deleteProviderConnection,
  findProviderConnection,
  insertProviderConnection,
  updateProviderConnection,
  withTransaction,
  type Database,
  type ProviderConnection,
  type TenantContext,
} from '@agentos/db';
import {
  PROVIDERS,
  ProviderError,
  createAdapter,
  createCircuitBreaker,
  type ModelHealth,
  type ProviderAccess,
  type ProviderAdapter,
  type ProviderKind,
} from '@agentos/model-gateway';
import { z } from 'zod';
import { recordAudit } from './audit';
import { parse } from './auth';
import { AppError } from './errors';
import { requireWorkspaceAdmin } from './permissions';
import type { SecretStore } from './secrets';

export type AdapterFactory = (access: ProviderAccess) => ProviderAdapter;

export type ProviderDeps = {
  secrets: SecretStore;
  /** Overridable in tests. */
  createAdapter?: AdapterFactory;
  /** Which models keep failing; defaults to one breaker per process. */
  modelHealth?: ModelHealth;
};

const processModelHealth = createCircuitBreaker();

/** The circuit breaker model calls share (fallback optimization, v0.6). */
export const modelHealthFor = (deps: ProviderDeps): ModelHealth =>
  deps.modelHealth ?? processModelHealth;

const NEEDS_KEY: ReadonlySet<ProviderKind> = new Set(['openai', 'anthropic', 'google']);
const NEEDS_ENDPOINT: ReadonlySet<ProviderKind> = new Set(['ollama', 'openai_compatible']);

const inputSchema = z
  .object({
    provider: z.enum(PROVIDERS, { error: 'provider_required' }),
    name: z
      .string()
      .trim()
      .min(1, { error: 'provider_name_required' })
      .max(60, { error: 'provider_name_too_long' }),
    endpoint: z.string().trim().max(500).optional(),
    apiKey: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (NEEDS_KEY.has(value.provider) && !value.apiKey) {
      ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'api_key_required' });
    }
    if (NEEDS_ENDPOINT.has(value.provider) && !value.endpoint) {
      ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'endpoint_required' });
    }
    if (value.endpoint && !/^https?:\/\/[^\s]+$/i.test(value.endpoint)) {
      ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'invalid_endpoint' });
    }
  });

export type ProviderInput = z.input<typeof inputSchema>;

/** Builds an adapter for a stored connection, decrypting its key only for this call. */
export async function adapterForConnection(
  deps: ProviderDeps,
  ctx: TenantContext,
  connection: ProviderConnection,
): Promise<ProviderAdapter> {
  const apiKey = connection.secretId ? await deps.secrets.reveal(ctx, connection.secretId) : null;
  return (deps.createAdapter ?? createAdapter)({
    provider: connection.provider,
    endpoint: connection.endpoint,
    apiKey,
  });
}

/**
 * Lists the provider's models to confirm the connection works and refresh the model list
 * (PRD §7.5). Failures are stored as a short error code, never the provider's raw response.
 */
export async function testProviderConnection(
  db: Database,
  deps: ProviderDeps,
  ctx: TenantContext,
  id: string,
): Promise<ProviderConnection> {
  await requireWorkspaceAdmin(db, ctx);
  const connection = await findProviderConnection(db, ctx, id);
  if (!connection) throw new AppError('NOT_FOUND', 'Provider not found');
  try {
    const models = await (await adapterForConnection(deps, ctx, connection)).listModels();
    return (await updateProviderConnection(db, ctx, id, {
      status: 'connected',
      models,
      lastCheckedAt: new Date(),
      lastError: null,
    }))!;
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return (await updateProviderConnection(db, ctx, id, {
      status: 'error',
      lastCheckedAt: new Date(),
      lastError: error.kind,
    }))!;
  }
}

/** Settings → AI Providers: stores the key in the secret store, then tests the connection. */
export async function createProviderConnection(
  db: Database,
  deps: ProviderDeps,
  ctx: TenantContext,
  input: ProviderInput,
): Promise<ProviderConnection> {
  await requireWorkspaceAdmin(db, ctx);
  const data = parse(inputSchema, input);
  const connection = await withTransaction(db, async (tx) => {
    const secretId = data.apiKey
      ? await deps.secrets.create(ctx, `provider:${data.provider}`, data.apiKey)
      : null;
    const row = await insertProviderConnection(tx, ctx, {
      provider: data.provider,
      name: data.name,
      endpoint: data.endpoint || null,
      secretId,
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action: 'provider.connected',
      targetType: 'provider_connection',
      targetId: row.id,
      outcome: 'success',
      metadata: { provider: data.provider, name: data.name },
    });
    return row;
  });
  return testProviderConnection(db, deps, ctx, connection.id);
}

/** Refuses while any agent still uses the connection, so no agent silently loses its model. */
export async function removeProviderConnection(
  db: Database,
  deps: ProviderDeps,
  ctx: TenantContext,
  id: string,
): Promise<void> {
  await requireWorkspaceAdmin(db, ctx);
  const connection = await findProviderConnection(db, ctx, id);
  if (!connection) throw new AppError('NOT_FOUND', 'Provider not found');
  if ((await countConnectionUsage(db, ctx, id)) > 0) {
    throw new AppError('PROVIDER_IN_USE', 'Agents still use this provider');
  }
  await deleteProviderConnection(db, ctx, id);
  if (connection.secretId) await deps.secrets.remove(ctx, connection.secretId);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'provider.removed',
    targetType: 'provider_connection',
    targetId: id,
    outcome: 'success',
    metadata: { provider: connection.provider, name: connection.name },
  });
}
