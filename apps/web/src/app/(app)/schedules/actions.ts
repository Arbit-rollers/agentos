'use server';

import { revalidatePath } from 'next/cache';
import {
  AppError,
  createSchedule,
  deleteSchedule,
  fireSchedule,
  setScheduleActive,
} from '@agentos/core';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export type ScheduleFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const failure = (error: unknown): ScheduleFormState => {
  if (!(error instanceof AppError)) throw error;
  return {
    error: error.code === 'VALIDATION' ? undefined : error.code,
    fieldErrors: error.details,
  };
};

export async function createScheduleAction(
  _: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const kind = text(formData, 'kind') === 'once' ? 'once' : 'recurring';
  try {
    await createSchedule(db, runtimeDeps, ctx, {
      agentId: text(formData, 'agentId'),
      name: text(formData, 'name'),
      objective: text(formData, 'objective'),
      input: text(formData, 'input'),
      kind,
      timezone: text(formData, 'timezone'),
      ...(kind === 'recurring'
        ? { cron: text(formData, 'cron') }
        : { runAt: text(formData, 'runAt') || undefined }),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/schedules');
  return { ok: true };
}

async function mutate(fn: () => Promise<unknown>): Promise<ScheduleFormState> {
  try {
    await fn();
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/schedules');
  revalidatePath('/tasks');
  return { ok: true };
}

export async function runScheduleNowAction(id: string) {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  return mutate(() => fireSchedule(db, runtimeDeps, ctx, id, { manual: true }));
}

export async function setScheduleActiveAction(id: string, active: boolean) {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  return mutate(() => setScheduleActive(db, runtimeDeps, ctx, id, active));
}

export async function deleteScheduleAction(id: string) {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  return mutate(() => deleteSchedule(db, runtimeDeps, ctx, id));
}
