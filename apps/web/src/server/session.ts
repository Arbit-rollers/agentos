import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, type AuthenticatedSession } from '@agentos/core';
import { SESSION_COOKIE } from '@/lib/session-cookie';
import { getServices } from './services';

/** Resolves the current request's session once per request. Server-side only (PRD §21). */
export const getSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return authenticate(getServices().db, token);
});

/** For pages and server actions: the session, or a redirect to the login page. */
export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
