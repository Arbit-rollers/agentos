'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AppError,
  changeAgentStatus,
  completeAgentSetup,
  createAgent,
  runAgentPrompt,
  saveAgentModelConfig,
  setAgentPermissions,
  setAgentTools,
  updateAgentBasics,
  updatePersonality,
  type AgentAction,
  type PromptRunResult,
} from '@agentos/core';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

/** Errors are codes; the forms translate them (PRD §33). */
export type AgentFormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const lines = (formData: FormData, key: string) => text(formData, key).split('\n');

function jsonArray(formData: FormData, key: string): string[] {
  try {
    const value: unknown = JSON.parse(text(formData, key) || '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Runs a mutation and turns expected failures into form state; redirects on success. */
async function run(mutate: () => Promise<string>): Promise<AgentFormState> {
  let destination: string;
  try {
    destination = await mutate();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      error: error.code === 'VALIDATION' ? undefined : error.code,
      fieldErrors: error.details,
    };
  }
  revalidatePath('/agents');
  revalidatePath('/dashboard');
  redirect(destination);
}

/** Wizard step 1. Creates the Draft agent on first save (PRD §19). */
export async function saveBasicsAction(
  agentId: string | null,
  _: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const { ctx } = await requireSession();
  const db = getServices().db;
  const parent = text(formData, 'parentAgentId');
  const input = {
    name: text(formData, 'name'),
    description: text(formData, 'description'),
    agentType: text(formData, 'agentType') as never,
    avatar: text(formData, 'avatar'),
    tags: jsonArray(formData, 'tags'),
    parentAgentId: parent && parent !== 'none' ? parent : null,
    role: text(formData, 'role'),
    jobDefinition: text(formData, 'jobDefinition'),
    goals: lines(formData, 'goals'),
    constraints: lines(formData, 'constraints'),
  };
  return run(async () => {
    const agent = agentId
      ? await updateAgentBasics(db, ctx, agentId, input)
      : await createAgent(db, ctx, input);
    return `/agents/${agent.id}/setup/personality`;
  });
}

export async function savePersonalityAction(
  agentId: string,
  _: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const { ctx } = await requireSession();
  let traits: unknown = {};
  try {
    traits = JSON.parse(text(formData, 'traits'));
  } catch {
    // Malformed input normalizes to neutral scores.
  }
  const rawModel = text(formData, 'modelConfig');
  return run(async () => {
    const db = getServices().db;
    await updatePersonality(db, ctx, agentId, { traits });
    // Empty when no model has been chosen yet; the agent then stays without one.
    if (rawModel) {
      let modelConfig: unknown;
      try {
        modelConfig = JSON.parse(rawModel);
      } catch {
        throw new AppError('VALIDATION', 'Malformed model config', { primary: ['model_required'] });
      }
      await saveAgentModelConfig(db, ctx, agentId, modelConfig as never);
    }
    return `/agents/${agentId}/setup/tools`;
  });
}

/** Review step: "Create agent" (Draft → Configured) or "Save as draft". */
export async function finishSetupAction(
  agentId: string,
  create: boolean,
  _: AgentFormState,
): Promise<AgentFormState> {
  const { ctx } = await requireSession();
  return run(async () => {
    if (create) await completeAgentSetup(getServices().db, ctx, agentId);
    return `/agents/${agentId}`;
  });
}

export async function changeStatusAction(
  agentId: string,
  action: AgentAction,
  _: AgentFormState,
): Promise<AgentFormState> {
  const { ctx } = await requireSession();
  return run(async () => {
    await changeAgentStatus(getServices().db, ctx, agentId, action);
    return `/agents/${agentId}`;
  });
}

export type PromptState = {
  result?: PromptRunResult;
  error?: string;
  fieldErrors?: AgentFormState['fieldErrors'];
};

/** "Try this agent": one test prompt through the agent's model strategy, recorded as a run. */
export async function runPromptAction(
  agentId: string,
  _: PromptState,
  formData: FormData,
): Promise<PromptState> {
  const { ctx } = await requireSession();
  const { db, providerDeps } = getServices();
  try {
    const result = await runAgentPrompt(db, providerDeps, ctx, agentId, {
      prompt: text(formData, 'prompt'),
      category: (text(formData, 'category') || 'general') as never,
    });
    revalidatePath(`/agents/${agentId}`);
    return { result };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    revalidatePath(`/agents/${agentId}`);
    return {
      error:
        error.code === 'VALIDATION' || error.code === 'MODEL_CALL_FAILED' ? undefined : error.code,
      fieldErrors: error.details,
    };
  }
}

/** Wizard step 3 (Screen 5): the agent's tool selection. */
export async function saveToolsAction(
  agentId: string,
  _: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const { ctx } = await requireSession();
  const toolIds = formData.getAll('toolIds').filter((v): v is string => typeof v === 'string');
  return run(async () => {
    await setAgentTools(getServices().db, ctx, agentId, toolIds);
    return `/agents/${agentId}/setup/permissions`;
  });
}

/** Wizard step 4 (Screen 6): per-tool modes and the high-risk approval policy. */
export async function savePermissionsAction(
  agentId: string,
  _: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const { ctx } = await requireSession();
  const modes: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('mode:') && typeof value === 'string') modes[key.slice(5)] = value;
  }
  const approvalPolicy = {
    requireApprovalForHighRisk: formData.get('requireApprovalForHighRisk') === 'on',
    categories: formData.getAll('categories').filter((v): v is string => typeof v === 'string'),
  };
  return run(async () => {
    await setAgentPermissions(getServices().db, ctx, agentId, {
      modes: modes as never,
      approvalPolicy: approvalPolicy as never,
    });
    return `/agents/${agentId}/setup/review`;
  });
}
