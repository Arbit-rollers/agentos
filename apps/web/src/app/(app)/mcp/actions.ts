'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AppError,
  createMcpConnection,
  refreshMcpConnection,
  removeMcpConnection,
  setMcpConnectionEnabled,
  startMcpAuthorization,
  updateToolDefaults,
} from '@agentos/core';
import type { PermissionMode } from '@agentos/policy';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export type McpFormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set when the browser must go to the server's sign-in page (OAuth). */
  authorizationUrl?: string;
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
      authType: text(formData, 'authType') as never,
      token: text(formData, 'token') || undefined,
      headers: text(formData, 'headers') || undefined,
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
