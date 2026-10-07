'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError, acceptInvitation } from '@agentos/core';
import { SESSION_COOKIE } from '@/lib/session-cookie';
import { getServices } from '@/server/services';
import { requireSession } from '@/server/session';

/** Invitation page → Accept: join the workspace and switch this session to it. */
export async function acceptInvitationAction(token: string): Promise<{ error?: string }> {
  const { user } = await requireSession();
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  try {
    await acceptInvitation(getServices().db, user.id, sessionToken, token);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { error: error.details?.invitation?.[0] ?? error.code };
  }
  redirect('/dashboard?joined=1');
}
