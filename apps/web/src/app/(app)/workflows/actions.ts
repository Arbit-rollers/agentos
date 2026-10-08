'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  cancelWorkflowRun,
  createSchedule,
  createWorkflow,
  deleteSchedule,
  deleteWorkflow,
  restoreWorkflowVersion,
  saveWorkflow,
  setWorkflowActive,
  startWorkflowRun,
  type GraphIssue,
} from '@agentos/core';
import type { WorkflowGraph } from '@agentos/db';
import { attempt, formFailure, formText, type FormState } from '@/server/form-state';
import { getServices } from '@/server/services';
import { requireSession } from '@/server/session';

const refresh = (id?: string) => {
  revalidatePath('/workflows');
  if (id) revalidatePath(`/workflows/${id}`);
};

/** Workflows → New. */
export async function createWorkflowAction(_: FormState, formData: FormData): Promise<FormState> {
  const { ctx } = await requireSession();
  let id: string;
  try {
    id = (
      await createWorkflow(getServices().db, ctx, {
        name: formText(formData, 'name'),
        description: formText(formData, 'description'),
      })
    ).id;
  } catch (error) {
    return formFailure(error);
  }
  refresh();
  redirect(`/workflows/${id}`);
}

export type SaveResult = FormState & { version?: number; issues?: GraphIssue[] };

/** Builder → Save: a new version. Returns what still keeps it from running. */
export async function saveWorkflowAction(
  id: string,
  input: { name: string; description: string; graph: WorkflowGraph },
): Promise<SaveResult> {
  const { ctx } = await requireSession();
  try {
    const { version, issues } = await saveWorkflow(getServices().db, ctx, id, input);
    refresh(id);
    return { ok: true, version, issues };
  } catch (error) {
    return formFailure(error);
  }
}

export async function setWorkflowActiveAction(id: string, active: boolean) {
  const { ctx } = await requireSession();
  const result = await attempt(() => setWorkflowActive(getServices().db, ctx, id, active));
  refresh(id);
  return result;
}

/** Test run (draft allowed) or Run now (active only). Returns the new run's id. */
export async function runWorkflowAction(
  id: string,
  input: string,
  trigger: 'test' | 'manual',
): Promise<FormState & { runId?: string }> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  try {
    const run = await startWorkflowRun(db, runtimeDeps, ctx, id, { input, trigger });
    refresh(id);
    return { ok: true, runId: run.id };
  } catch (error) {
    return formFailure(error);
  }
}

export async function cancelWorkflowRunAction(workflowId: string, runId: string) {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const result = await attempt(() => cancelWorkflowRun(db, runtimeDeps, ctx, runId));
  refresh(workflowId);
  return result;
}

export async function restoreVersionAction(id: string, versionId: string) {
  const { ctx } = await requireSession();
  const result = await attempt(() => restoreWorkflowVersion(getServices().db, ctx, id, versionId));
  refresh(id);
  return result;
}

export async function deleteWorkflowAction(id: string) {
  const { ctx } = await requireSession();
  const result = await attempt(() => deleteWorkflow(getServices().db, ctx, id));
  if (result.ok) {
    refresh();
    redirect('/workflows');
  }
  return result;
}

/** Workflow settings → Schedule: a recurring trigger (cron + timezone). */
export async function addWorkflowScheduleAction(
  id: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const result = await attempt(() =>
    createSchedule(db, runtimeDeps, ctx, {
      workflowId: id,
      name: formText(formData, 'name') || 'Workflow schedule',
      input: formText(formData, 'input'),
      kind: 'recurring',
      cron: formText(formData, 'cron'),
      timezone: formText(formData, 'timezone'),
    }),
  );
  refresh(id);
  revalidatePath('/schedules');
  return result;
}

export async function removeWorkflowScheduleAction(workflowId: string, scheduleId: string) {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const result = await attempt(() => deleteSchedule(db, runtimeDeps, ctx, scheduleId));
  refresh(workflowId);
  revalidatePath('/schedules');
  return result;
}
