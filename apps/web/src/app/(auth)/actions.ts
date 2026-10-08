'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError, enforceRateLimit, login, logout, register } from '@agentos/core';
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

/**
 * The client's address for rate limits. Behind a reverse proxy this is the first
 * X-Forwarded-For entry, which a client can spoof without one, so sign-in is also limited
 * per email address.
 */
async function clientAddress(): Promise<string> {
  const list = await headers();
  return list.get('x-forwarded-for')?.split(',')[0]?.trim() || list.get('x-real-ip') || 'unknown';
}

export async function loginAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { db, rateLimiter } = getServices();
  const ip = await clientAddress();
  return signIn(async () => {
    await enforceRateLimit(rateLimiter, 'loginIp', ip);
    await enforceRateLimit(rateLimiter, 'loginEmail', text(formData.get('email')).toLowerCase());
    return login(db, { email: formData.get('email'), password: formData.get('password') });
  }, formData);
}

export async function registerAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { db, rateLimiter } = getServices();
  // New accounts start in the language the visitor is currently seeing.
  const locale = await resolveLocale();
  const ip = await clientAddress();
  return signIn(async () => {
    await enforceRateLimit(rateLimiter, 'register', ip);
    return register(db, {
      displayName: formData.get('displayName'),
      email: formData.get('email'),
      password: formData.get('password'),
      locale,
    });
  }, formData);
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
