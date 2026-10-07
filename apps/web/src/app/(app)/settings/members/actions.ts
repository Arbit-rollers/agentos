'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  renameCurrentWorkspace,
  revokeInvitation,
} from '@agentos/core';
import { attempt, formFailure, formText, type FormState } from '@/server/form-state';
import { getServices } from '@/server/services';
import { requireSession } from '@/server/session';

export type InviteState = FormState & { link?: string; email?: string };

/** Settings → Members → Invite: returns the link to share (AgentOS sends no email yet). */
export async function inviteMemberAction(_: InviteState, formData: FormData): Promise<InviteState> {
  const { ctx } = await requireSession();
  const { db, env } = getServices();
  try {
    const { invitation, token } = await inviteMember(db, ctx, {
      email: formText(formData, 'email'),
      role: formText(formData, 'role'),
    });
    revalidatePath('/settings/members');
    return {
      ok: true,
      email: invitation.email,
      link: `${env.APP_URL.replace(/\/+$/, '')}/invite/${token}`,
    };
  } catch (error) {
    return formFailure(error);
  }
}

export async function revokeInvitationAction(id: string) {
  const { ctx } = await requireSession();
  const result = await attempt(() => revokeInvitation(getServices().db, ctx, id));
  revalidatePath('/settings/members');
  return result;
}

export async function changeRoleAction(userId: string, role: string) {
  const { ctx } = await requireSession();
  const result = await attempt(() => changeMemberRole(getServices().db, ctx, userId, role));
  revalidatePath('/settings/members');
  return result;
}

export async function removeMemberAction(userId: string) {
  const { ctx } = await requireSession();
  const { db, secrets } = getServices();
  const result = await attempt(() => removeMember(db, { secrets }, ctx, userId));
  if (result.ok && userId === ctx.userId) redirect('/dashboard');
  revalidatePath('/settings/members');
  return result;
}

export async function renameWorkspaceAction(_: FormState, formData: FormData): Promise<FormState> {
  const { ctx } = await requireSession();
  const result = await attempt(() =>
    renameCurrentWorkspace(getServices().db, ctx, formText(formData, 'name')),
  );
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}
