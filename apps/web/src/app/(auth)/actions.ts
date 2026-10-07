'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError, login, logout, register } from '@agentos/core';
import { isLocale } from '@agentos/i18n';
import { LOCALE_COOKIE, resolveLocale } from '@/i18n/locale';
import { safeNext } from '@/lib/safe-next';
import { SESSION_COOKIE } from '@/lib/session-cookie';
import { getServices } from '@/server/services';
import { clearSessionCookie, setSessionCookie } from '@/server/session';

/** Errors are codes; the form translates them (PRD §33). */
export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: { email?: string; displayName?: string };
};

const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : '');

async function signIn(start: () => ReturnType<typeof login>, formData: FormData) {
  try {
    const { token, expiresAt } = await start();
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      error: error.code === 'VALIDATION' ? undefined : error.code,
      fieldErrors: error.details,
      values: {
        email: text(formData.get('email')),
        displayName: text(formData.get('displayName')),
      },
    } satisfies AuthFormState;
  }
  redirect(safeNext(formData.get('next')));
}

export async function loginAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const db = getServices().db;
  return signIn(
    () => login(db, { email: formData.get('email'), password: formData.get('password') }),
    formData,
  );
}

export async function registerAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const db = getServices().db;
  // New accounts start in the language the visitor is currently seeing.
  const locale = await resolveLocale();
  return signIn(
    () =>
      register(db, {
        displayName: formData.get('displayName'),
        email: formData.get('email'),
        password: formData.get('password'),
        locale,
      }),
    formData,
  );
}

export async function logoutAction() {
  await logout(getServices().db, (await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect('/login');
}

/** Language switch for signed-out visitors; signed-in users change it in Settings. */
export async function setVisitorLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
  });
}
