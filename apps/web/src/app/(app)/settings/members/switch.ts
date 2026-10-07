'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { switchWorkspace } from '@agentos/core';
import { SESSION_COOKIE } from '@/lib/session-cookie';
import { getServices } from '@/server/services';
import { requireSession } from '@/server/session';

/** Top bar → workspace switcher. */
export async function switchWorkspaceAction(workspaceId: string) {
  const { user } = await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  await switchWorkspace(getServices().db, user.id, token, workspaceId);
  redirect('/dashboard');
}
