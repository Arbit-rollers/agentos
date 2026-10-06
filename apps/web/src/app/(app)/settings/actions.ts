'use server';

import { revalidatePath } from 'next/cache';
import { AppError, updateProfile } from '@agentos/core';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export type ProfileFormState = {
  status: 'idle' | 'saved' | 'error';
  fieldErrors?: Record<string, string[] | undefined>;
};

export async function updateProfileAction(
  _: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { ctx } = await requireSession();
  try {
    await updateProfile(getServices().db, ctx, {
      displayName: formData.get('displayName'),
      locale: formData.get('locale'),
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'VALIDATION') {
      return { status: 'error', fieldErrors: error.details };
    }
    throw error;
  }
  // The locale may have changed: re-render everything under the root layout.
  revalidatePath('/', 'layout');
  return { status: 'saved' };
}
