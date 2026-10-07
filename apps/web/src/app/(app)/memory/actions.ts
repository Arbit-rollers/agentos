'use server';

import { revalidatePath } from 'next/cache';
import {
  createMemory,
  decideFeedbackSuggestion,
  deleteMemory,
  editMemory,
  setMemoryFlags,
} from '@agentos/core';
import type { MemoryType } from '@agentos/db';
import { attempt, formText, type FormState } from '@/server/form-state';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const refresh = () => {
  revalidatePath('/memory');
  revalidatePath('/agents/[id]', 'page');
};

/** Memory → Add (PRD §12). */
export async function createMemoryAction(_: FormState, formData: FormData): Promise<FormState> {
  const { ctx } = await requireSession();
  const { db, providerDeps } = getServices();
  const result = await attempt(() =>
    createMemory(db, providerDeps, ctx, {
      type: formText(formData, 'type') as MemoryType,
      content: formText(formData, 'content'),
      agentId: formText(formData, 'agentId') || null,
      pinned: formData.get('pinned') === 'on',
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function editMemoryAction(id: string, input: { content: string; type: MemoryType }) {
  const { ctx } = await requireSession();
  const { db, providerDeps } = getServices();
  const result = await attempt(() => editMemory(db, providerDeps, ctx, id, input));
  refresh();
  return result;
}

export async function setMemoryFlagsAction(
  id: string,
  flags: { pinned?: boolean; enabled?: boolean },
) {
  const { ctx } = await requireSession();
  const result = await attempt(() => setMemoryFlags(getServices().db, ctx, id, flags));
  refresh();
  return result;
}

export async function deleteMemoryAction(id: string) {
  const { ctx } = await requireSession();
  const result = await attempt(() => deleteMemory(getServices().db, ctx, id));
  refresh();
  return result;
}

/** Accept or dismiss a suggestion made from feedback (PRD §13). */
export async function decideSuggestionAction(feedbackId: string, index: number, accept: boolean) {
  const { ctx } = await requireSession();
  const result = await attempt(() =>
    decideFeedbackSuggestion(getServices().db, ctx, feedbackId, index, accept),
  );
  refresh();
  return result;
}
