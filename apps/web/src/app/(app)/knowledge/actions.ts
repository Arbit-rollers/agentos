'use server';

import { revalidatePath } from 'next/cache';
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  reindexKnowledgeSource,
  type KnowledgeSourceInput,
} from '@agentos/core';
import { attempt, formText, type FormState } from '@/server/form-state';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const refresh = () => {
  revalidatePath('/knowledge');
  revalidatePath('/agents/[id]', 'page');
};

/** Knowledge → Add source (PRD §11). */
export async function addKnowledgeAction(_: FormState, formData: FormData): Promise<FormState> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const type = formText(formData, 'type') as KnowledgeSourceInput['type'];
  const file = formData.get('file');
  const result = await attempt(async () =>
    createKnowledgeSource(db, runtimeDeps, ctx, {
      scope: formText(formData, 'scope') as KnowledgeSourceInput['scope'],
      agentId: formText(formData, 'agentId') || undefined,
      type,
      name: formText(formData, 'name') || undefined,
      ...(type === 'note' && { text: formText(formData, 'text') }),
      ...(type === 'url' && { url: formText(formData, 'url') }),
      ...(type === 'file' &&
        file instanceof File &&
        file.size > 0 && {
          file: {
            name: file.name,
            mimeType: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
          },
        }),
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function reindexKnowledgeAction(id: string, refetch = false) {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const result = await attempt(() => reindexKnowledgeSource(db, runtimeDeps, ctx, id, { refetch }));
  refresh();
  return result;
}

export async function deleteKnowledgeAction(id: string) {
  const { ctx } = await requireSession();
  const result = await attempt(() => deleteKnowledgeSource(getServices().db, ctx, id));
  refresh();
  return result;
}
