import { createHash, randomBytes } from 'node:crypto';
import {
  addWorkspaceMember,
  countOwners,
  deleteMembership,
  findInvitationByTokenHash,
  findMembership,
  findUserById,
  insertInvitation,
  listWorkspaceMembers,
  markInvitationAccepted,
  removeMemberData,
  renameWorkspace,
  revokeInvitation as revokeInvitationRow,
  revokeInvitationsForEmail,
  setSessionWorkspace,
  updateMemberRole,
  withTransaction,
  type Database,
  type TenantContext,
  type WorkspaceInvitation,
  type WorkspaceRole,
} from '@agentos/db';
import { z } from 'zod';
import { recordAudit } from './audit';
import { hashSessionToken, parse } from './auth';
import { AppError } from './errors';
import type { SecretStore } from './secrets';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Roles an invitation or a role change can grant. Ownership isn't transferable yet. */
export const ASSIGNABLE_ROLES = ['admin', 'member'] as const;
const MANAGERS: WorkspaceRole[] = ['owner', 'admin'];

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

async function roleOf(db: Database, ctx: TenantContext): Promise<WorkspaceRole> {
  const membership = await findMembership(db, ctx.userId, ctx.workspaceId);
  if (!membership) throw new AppError('FORBIDDEN', 'Not a member of this workspace');
  return membership.role;
}

/** Owners and admins manage members and invitations. */
export async function requireManager(db: Database, ctx: TenantContext) {
  const role = await roleOf(db, ctx);
  if (!MANAGERS.includes(role)) throw new AppError('FORBIDDEN', 'Owners and admins only');
  return role;
}

const audit = (
  db: Database,
  ctx: TenantContext,
  action: string,
  target: { type: string; id: string },
  metadata: Record<string, unknown> = {},
) =>
  recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action,
    targetType: target.type,
    targetId: target.id,
    outcome: 'success',
    metadata,
  });

const inviteSchema = z.object({
  email: z.email({ error: 'invalid_email' }).trim().toLowerCase().max(254),
  role: z.enum(ASSIGNABLE_ROLES),
});

/**
 * Settings → Members → Invite. Returns the invitation and the raw token for the link; only
 * its hash is stored. A new invitation for the same email replaces an open one.
 */
export async function inviteMember(
  db: Database,
  ctx: TenantContext,
  input: { email: unknown; role: unknown },
  now = new Date(),
): Promise<{ invitation: WorkspaceInvitation; token: string }> {
  await requireManager(db, ctx);
  const data = parse(inviteSchema, input);
  const members = await listWorkspaceMembers(db, ctx);
  if (members.some((m) => m.email === data.email))
    throw new AppError('VALIDATION', 'Already a member', { email: ['already_member'] });
  const token = randomBytes(32).toString('base64url');
  const invitation = await withTransaction(db, async (tx) => {
    await revokeInvitationsForEmail(tx, ctx, data.email);
    return insertInvitation(tx, ctx, {
      email: data.email,
      role: data.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    });
  });
  await audit(
    db,
    ctx,
    'member.invited',
    { type: 'invitation', id: invitation.id },
    {
      email: data.email,
      role: data.role,
    },
  );
  return { invitation, token };
}

export async function revokeInvitation(db: Database, ctx: TenantContext, id: string) {
  await requireManager(db, ctx);
  if (!(await revokeInvitationRow(db, ctx, id)))
    throw new AppError('NOT_FOUND', 'Invitation not found');
  await audit(db, ctx, 'member.invitation_revoked', { type: 'invitation', id });
}

export type InvitationView = {
  workspaceName: string;
  inviterName: string;
  email: string;
  role: WorkspaceRole;
  status: 'valid' | 'expired' | 'used' | 'revoked';
};

/** The invitation page (before the visitor belongs to the workspace). Unknown → null. */
export async function describeInvitation(
  db: Database,
  token: string,
  now = new Date(),
): Promise<InvitationView | null> {
  const found = await findInvitationByTokenHash(db, hashToken(token));
  if (!found) return null;
  const { invitation } = found;
  return {
    workspaceName: found.workspaceName,
    inviterName: found.inviterName || found.inviterEmail,
    email: invitation.email,
    role: invitation.role,
    status: invitation.revokedAt
      ? 'revoked'
      : invitation.acceptedAt
        ? 'used'
        : invitation.expiresAt <= now
          ? 'expired'
          : 'valid',
  };
}

/**
 * Accepts an invitation as the signed-in person: their email must be the invited one. Adds
 * the membership, marks the invitation used (once), and switches this session to the
 * workspace. Returns the workspace id.
 */
export async function acceptInvitation(
  db: Database,
  userId: string,
  sessionToken: string,
  token: string,
  now = new Date(),
): Promise<string> {
  const found = await findInvitationByTokenHash(db, hashToken(token));
  const user = await findUserById(db, userId);
  if (!found || !user) throw new AppError('NOT_FOUND', 'Invitation not found');
  const { invitation } = found;
  if (user.email !== invitation.email)
    throw new AppError('FORBIDDEN', 'This invitation is for another email address', {
      invitation: ['invite_wrong_account'],
    });
  const workspaceCtx = { workspaceId: invitation.workspaceId, userId };
  const alreadyMember = await findMembership(db, userId, invitation.workspaceId);
  await withTransaction(db, async (tx) => {
    if (!(await markInvitationAccepted(tx, invitation.id, userId, now)))
      throw new AppError('INVALID_TRANSITION', 'Invitation no longer valid', {
        invitation: ['invite_invalid'],
      });
    if (!alreadyMember)
      await addWorkspaceMember(tx, {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
      });
  });
  await setSessionWorkspace(db, hashSessionToken(sessionToken), invitation.workspaceId);
  await audit(
    db,
    workspaceCtx,
    'member.joined',
    { type: 'user', id: userId },
    {
      role: invitation.role,
      invitationId: invitation.id,
    },
  );
  return invitation.workspaceId;
}

/** Top bar → workspace switcher. */
export async function switchWorkspace(
  db: Database,
  userId: string,
  sessionToken: string,
  workspaceId: string,
) {
  if (!(await findMembership(db, userId, workspaceId)))
    throw new AppError('NOT_FOUND', 'Workspace not found');
  await setSessionWorkspace(db, hashSessionToken(sessionToken), workspaceId);
}

export async function changeMemberRole(
  db: Database,
  ctx: TenantContext,
  userId: string,
  role: unknown,
) {
  await requireManager(db, ctx);
  const next = parse(z.enum(ASSIGNABLE_ROLES), role);
  if (userId === ctx.userId)
    throw new AppError('INVALID_TRANSITION', 'You cannot change your own role');
  const target = await findMembership(db, userId, ctx.workspaceId);
  if (!target) throw new AppError('NOT_FOUND', 'Member not found');
  if (target.role === 'owner') throw new AppError('FORBIDDEN', 'The owner keeps the owner role');
  await updateMemberRole(db, ctx, userId, next);
  await audit(
    db,
    ctx,
    'member.role_changed',
    { type: 'user', id: userId },
    {
      before: target.role,
      after: next,
    },
  );
}

/**
 * Removes a member (owners and admins) or leaves (anyone but the owner). Their private data
 * in this workspace goes with them: memories, private knowledge, connected accounts; their
 * schedules are paused so nothing keeps running as them. Shared work (agents, tasks,
 * conversations) stays.
 */
export async function removeMember(
  db: Database,
  deps: { secrets: SecretStore },
  ctx: TenantContext,
  userId: string,
) {
  const leaving = userId === ctx.userId;
  if (!leaving) await requireManager(db, ctx);
  const target = await findMembership(db, userId, ctx.workspaceId);
  if (!target) throw new AppError('NOT_FOUND', 'Member not found');
  if (target.role === 'owner' && (await countOwners(db, ctx)) <= 1)
    throw new AppError('FORBIDDEN', 'The owner cannot leave or be removed', {
      member: ['owner_cannot_leave'],
    });
  const removed = await withTransaction(db, async (tx) => {
    const data = await removeMemberData(tx, ctx, userId);
    await deleteMembership(tx, ctx, userId);
    return data;
  });
  for (const secretId of removed.secretIds) await deps.secrets.remove(ctx, secretId);
  await audit(
    db,
    ctx,
    leaving ? 'member.left' : 'member.removed',
    { type: 'user', id: userId },
    {
      pausedSchedules: removed.pausedScheduleIds.length,
    },
  );
  return removed;
}

export async function renameCurrentWorkspace(db: Database, ctx: TenantContext, name: unknown) {
  await requireManager(db, ctx);
  const { name: value } = parse(
    z.object({ name: z.string().trim().min(1, { error: 'workspace_name_required' }).max(80) }),
    { name },
  );
  await renameWorkspace(db, ctx, value);
  await audit(
    db,
    ctx,
    'workspace.renamed',
    { type: 'workspace', id: ctx.workspaceId },
    { name: value },
  );
}
