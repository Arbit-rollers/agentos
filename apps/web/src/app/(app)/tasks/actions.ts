'use server';

import { revalidatePath } from 'next/cache';
import { AppError, cancelTask, createTask, retryTask } from '@agentos/core';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export type TaskFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const failure = (error: unknown): TaskFormState => {
  if (!(error instanceof AppError)) throw error;
  return {
    error: error.code === 'VALIDATION' ? undefined : error.code,
    fieldErrors: error.details,
  };
};

/** Tasks → New Task (PRD §14). */
export async function createTaskAction(
  _: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const dueAt = text(formData, 'dueAt');
  try {
    await createTask(db, runtimeDeps, ctx, {
      agentId: text(formData, 'agentId'),
      objective: text(formData, 'objective'),
      input: text(formData, 'input'),
      priority: Number(text(formData, 'priority') || 0),
      ...(dueAt && { dueAt }),
      dependsOn: formData.getAll('dependsOn').filter((v): v is string => typeof v === 'string'),
      maxRetries: Number(text(formData, 'maxRetries') || 0),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function cancelTaskAction(id: string): Promise<TaskFormState> {
  const { ctx } = await requireSession();
  try {
    await cancelTask(getServices().db, ctx, id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
  return { ok: true };
}

export async function retryTaskAction(id: string): Promise<TaskFormState> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  try {
    await retryTask(db, runtimeDeps, ctx, id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
  return { ok: true };
}
