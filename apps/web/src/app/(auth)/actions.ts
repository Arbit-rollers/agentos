'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError, login, logout, register } from '@agentos/core';
import { SESSION_COOKIE } from '@/lib/session-cookie';
import { getServices } from '@/server/services';
import { clearSessionCookie, setSessionCookie } from '@/server/session';

export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  email?: string;
};

async function authenticateWith(
  action: typeof login | typeof register,
  formData: FormData,
): Promise<AuthFormState> {
  const email = formData.get('email');
  const input = { email, password: formData.get('password') };
  try {
    const { token, expiresAt } = await action(getServices().db, input);
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      error: error.code === 'VALIDATION' ? undefined : error.message,
      fieldErrors: error.details,
      email: typeof email === 'string' ? email : '',
    };
  }
  redirect('/dashboard');
}

export async function loginAction(_: AuthFormState, formData: FormData) {
  return authenticateWith(login, formData);
}

export async function registerAction(_: AuthFormState, formData: FormData) {
  return authenticateWith(register, formData);
}

export async function logoutAction() {
  await logout(getServices().db, (await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect('/login');
}
