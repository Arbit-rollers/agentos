import 'server-only';
import { AppError } from '@agentos/core';

/** What a form's server action returns: field errors by name, or one error code. */
export type FormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const formText = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

/** Expected failures become form state; anything else is a bug and rethrows. */
export function formFailure(error: unknown): FormState {
  if (!(error instanceof AppError)) throw error;
  return {
    error: error.code === 'VALIDATION' ? undefined : error.code,
    fieldErrors: error.details,
  };
}

/** Runs a mutation and maps expected failures; revalidation is the caller's job. */
export async function attempt(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    return formFailure(error);
  }
}
