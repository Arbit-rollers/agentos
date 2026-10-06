'use server';

import { revalidatePath } from 'next/cache';
import {
  AppError,
  createProviderConnection,
  removeProviderConnection,
  testProviderConnection,
} from '@agentos/core';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export type ProviderFormState = {
  status: 'idle' | 'saved' | 'error';
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

async function run(mutate: () => Promise<unknown>): Promise<ProviderFormState> {
  try {
    await mutate();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      status: 'error',
      error: error.code === 'VALIDATION' ? undefined : error.code,
      fieldErrors: error.details,
    };
  }
  revalidatePath('/settings/providers');
  return { status: 'saved' };
}

export async function addProviderAction(
  _: ProviderFormState,
  formData: FormData,
): Promise<ProviderFormState> {
  const { ctx } = await requireSession();
  const { db, providerDeps } = getServices();
  return run(() =>
    createProviderConnection(db, providerDeps, ctx, {
      provider: text(formData, 'provider') as never,
      name: text(formData, 'name'),
      endpoint: text(formData, 'endpoint') || undefined,
      apiKey: text(formData, 'apiKey') || undefined,
    }),
  );
}

export async function testProviderAction(id: string): Promise<ProviderFormState> {
  const { ctx } = await requireSession();
  const { db, providerDeps } = getServices();
  return run(() => testProviderConnection(db, providerDeps, ctx, id));
}

export async function removeProviderAction(id: string): Promise<ProviderFormState> {
  const { ctx } = await requireSession();
  const { db, providerDeps } = getServices();
  return run(() => removeProviderConnection(db, providerDeps, ctx, id));
}
