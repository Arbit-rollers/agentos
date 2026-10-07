'use server';

import { revalidatePath } from 'next/cache';
import { setEmbeddingSetting } from '@agentos/core';
import { attempt, formText, type FormState } from '@/server/form-state';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

/** Settings → Knowledge → Embedding model. An empty provider turns semantic search off. */
export async function saveEmbeddingAction(_: FormState, formData: FormData): Promise<FormState> {
  const { ctx } = await requireSession();
  const { db, runtimeDeps } = getServices();
  const connectionId = formText(formData, 'connectionId');
  const result = await attempt(() =>
    setEmbeddingSetting(
      db,
      runtimeDeps,
      ctx,
      formData.get('off') === '1' || !connectionId
        ? null
        : { connectionId, model: formText(formData, 'model') },
    ),
  );
  if (result.ok) {
    revalidatePath('/settings/knowledge');
    revalidatePath('/knowledge');
  }
  return result;
}
