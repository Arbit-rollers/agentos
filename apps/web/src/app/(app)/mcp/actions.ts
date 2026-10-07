'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AppError,
  connectGoogleWorkspace,
  createMcpConnection,
  disconnectMyMcpAccount,
  setMyMcpToken,
  updateMcpConnectionAuth,
  type GoogleService,
  refreshMcpConnection,
  removeMcpConnection,
  setMcpConnectionEnabled,
  startMcpAuthorization,
  updateToolDefaults,
} from '@agentos/core';
import type { PermissionMode } from '@agentos/policy';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export type McpFormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set when the browser must go to the server's sign-in page (OAuth). */
  authorizationUrl?: string;
  ok?: boolean;
  redirectTo?: string;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const failure = (error: unknown): McpFormState => {
  if (!(error instanceof AppError)) throw error;
  return {
    error: error.code === 'VALIDATION' ? undefined : error.code,
    fieldErrors: error.details,
  };
};

/** The sign-in fields shared by Connect and Change sign-in method. */
const signInFields = (formData: FormData) => ({
  authType: text(formData, 'authType') as never,
  credentialMode: (text(formData, 'credentialMode') || 'shared') as 'shared' | 'per_user',
  token: text(formData, 'token') || undefined,
  headers: text(formData, 'headers') || undefined,
  oauthClientId: text(formData, 'oauthClientId') || undefined,
  oauthClientSecret: text(formData, 'oauthClientSecret') || undefined,
  oauthScopes: text(formData, 'oauthScopes') || undefined,
});

export async function connectMcpAction(_: McpFormState, formData: FormData): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  let id: string;
  try {
    const { connection, authorizationUrl } = await createMcpConnection(db, mcpDeps, ctx, {
      name: text(formData, 'name'),
      serverType: text(formData, 'serverType') || 'custom',
      endpoint: text(formData, 'endpoint'),
      transport: text(formData, 'transport') as never,
      ...signInFields(formData),
    });
    revalidatePath('/mcp');
    if (authorizationUrl) return { authorizationUrl };
    id = connection.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/mcp/${id}`);
}

/** Returns an error code, or the sign-in URL for OAuth connections needing it. */
export async function testMcpAction(id: string): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  try {
    const connection = await refreshMcpConnection(db, mcpDeps, ctx, id);
    revalidatePath(`/mcp/${id}`);
    revalidatePath('/mcp');
    return connection.status === 'connected'
      ? {}
      : { error: `mcp.${connection.lastError ?? 'protocol'}` };
  } catch (error) {
    return failure(error);
  }
}

export async function reauthorizeMcpAction(id: string): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  try {
    const url = await startMcpAuthorization(db, mcpDeps, ctx, id);
    revalidatePath(`/mcp/${id}`);
    return url ? { authorizationUrl: url } : {};
  } catch (error) {
    return failure(error);
  }
}

export async function setMcpEnabledAction(id: string, enabled: boolean): Promise<McpFormState> {
  const { ctx } = await requireSession();
  try {
    await setMcpConnectionEnabled(getServices().db, ctx, id, enabled);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/mcp/${id}`);
  revalidatePath('/mcp');
  return {};
}

export async function removeMcpAction(id: string): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  try {
    await removeMcpConnection(db, mcpDeps, ctx, id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/mcp');
  redirect('/mcp');
}

export async function updateToolDefaultAction(
  connectionId: string,
  toolId: string,
  input: { defaultPermission?: PermissionMode; enabled?: boolean },
): Promise<McpFormState> {
  const { ctx } = await requireSession();
  try {
    await updateToolDefaults(getServices().db, ctx, toolId, input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/mcp/${connectionId}`);
  return {};
}

/** MCP Hub → connection → Sign-in method: change it without removing the connection. */
export async function changeSignInAction(
  id: string,
  _: McpFormState,
  formData: FormData,
): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  try {
    const { authorizationUrl } = await updateMcpConnectionAuth(
      db,
      mcpDeps,
      ctx,
      id,
      signInFields(formData),
    );
    revalidatePath(`/mcp/${id}`);
    revalidatePath('/mcp');
    return authorizationUrl ? { authorizationUrl } : { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Per-user token connections: save my own token. */
export async function saveMyTokenAction(
  id: string,
  _: McpFormState,
  formData: FormData,
): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  try {
    const connection = await setMyMcpToken(db, mcpDeps, ctx, id, text(formData, 'token'));
    revalidatePath(`/mcp/${id}`);
    return connection.status === 'connected' ? { ok: true } : { error: 'mcp.auth' };
  } catch (error) {
    return failure(error);
  }
}

/** Disconnect my account from a per-user connection. */
export async function disconnectMyAccountAction(id: string): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  try {
    await disconnectMyMcpAccount(db, mcpDeps, ctx, id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/mcp/${id}`);
  return { ok: true };
}

/** MCP Hub → Google Workspace: one per-user connection per chosen service. */
export async function connectGoogleAction(
  _: McpFormState,
  formData: FormData,
): Promise<McpFormState> {
  const { ctx } = await requireSession();
  const { db, mcpDeps } = getServices();
  const t = await getTranslations('mcp.google.services');
  const names = Object.fromEntries(
    (['gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'chat', 'people'] as const).map(
      (s) => [s, t(s)],
    ),
  ) as Record<GoogleService, string>;
  try {
    const { connections, authorizationUrl } = await connectGoogleWorkspace(
      db,
      mcpDeps,
      ctx,
      {
        services: formData.getAll('services').map(String) as GoogleService[],
        client: text(formData, 'client') === 'platform' ? 'platform' : 'own',
        clientId: text(formData, 'clientId') || undefined,
        clientSecret: text(formData, 'clientSecret') || undefined,
      },
      names,
    );
    revalidatePath('/mcp');
    if (authorizationUrl) return { authorizationUrl };
    return { ok: true, redirectTo: `/mcp/${connections[0]!.id}` };
  } catch (error) {
    return failure(error);
  }
}
