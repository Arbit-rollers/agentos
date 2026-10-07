'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AppError,
  changeAgentStatus,
  completeAgentSetup,
  createAgent,
  decideApproval,
  saveAgentModelConfig,
  setAgentPermissions,
  setAgentTools,
  startChatTurn,
  submitFeedback,
  updateAgentBasics,
  updatePersonality,
  type AgentAction,
} from '@agentos/core';
import type { FeedbackAction, FeedbackSuggestion } from '@agentos/db';
import { getTranslations } from 'next-intl/server';
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

/** Agent Workspace → Chat: records the message and queues the run (PRD §20). */
export async function sendMessageAction(
  agentId: string,
  conversationId: string | null,
  _: ChatFormState,
  formData: FormData,
): Promise<ChatFormState> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  try {
    const turn = await startChatTurn(db, runtimeDeps, ctx, agentId, {
      message: text(formData, 'message'),
      ...(conversationId && { conversationId }),
    });
    revalidatePath(`/agents/${agentId}`);
    return { conversationId: turn.conversationId, runId: turn.runId, sentAt: Date.now() };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { error: error.code === 'VALIDATION' ? error.details?.message?.[0] : error.code };
  }
}

export type ChatFormState = {
  conversationId?: string;
  runId?: string;
  sentAt?: number;
  error?: string;
};

/** Approval Inbox and inline chat approvals (PRD §10). */
export async function decideApprovalAction(input: {
  approvalId: string;
  decision: 'approve' | 'reject';
  editedArguments?: Record<string, unknown>;
}): Promise<{ error?: string }> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  try {
    await decideApproval(db, runtimeDeps, ctx, input.approvalId, input);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { error: error.code === 'VALIDATION' ? 'invalid_arguments' : error.code };
  }
  revalidatePath('/approvals');
  revalidatePath('/agents', 'layout');
  return {};
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

export type FeedbackResult = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  feedback?: { id: string; suggestions: FeedbackSuggestion[] };
};

/**
 * Agent output → Approve / Reject / Revise / Feedback (PRD §13). Revise also asks the agent
 * to redo the answer in the same conversation.
 */
export async function submitFeedbackAction(input: {
  agentId: string;
  conversationId: string;
  messageId: string;
  action: FeedbackAction;
  comment?: string;
}): Promise<FeedbackResult> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  try {
    const event = await submitFeedback(db, runtimeDeps, ctx, {
      messageId: input.messageId,
      action: input.action,
      comment: input.comment,
    });
    if (input.action === 'revise') {
      const t = await getTranslations('feedback');
      await startChatTurn(db, runtimeDeps, ctx, input.agentId, {
        message: t('reviseMessage', { comment: event.comment }),
        conversationId: input.conversationId,
      });
    }
    revalidatePath(`/agents/${input.agentId}`);
    revalidatePath('/memory');
    return { ok: true, feedback: { id: event.id, suggestions: event.suggestions } };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      error: error.code === 'VALIDATION' ? undefined : error.code,
      fieldErrors: error.details,
    };
  }
}
