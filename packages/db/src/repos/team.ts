import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import {
  knowledgeSources,
  mcpUserCredentials,
  memories,
  schedules,
  sessions,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';
import type { WorkspaceRole } from './workspaces';

export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;

// --- members --------------------------------------------------------------------

export type WorkspaceMemberRow = {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: Date;
};

export async function listWorkspaceMembers(
  db: Executor,
  ctx: TenantContext,
): Promise<WorkspaceMemberRow[]> {
  return db
    .select({
      userId: workspaceMembers.userId,
      displayName: users.displayName,
      email: users.email,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}

export async function updateMemberRole(
  db: Executor,
  ctx: TenantContext,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)),
    );
}

export async function deleteMembership(
  db: Executor,
  ctx: TenantContext,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .returning({ userId: workspaceMembers.userId });
  return rows.length > 0;
}

/**
 * What belongs to one person inside a workspace and must leave with them: private memories,
 * private knowledge, their own connected accounts (returns the secret ids to delete), and
 * schedules that would keep running as them (paused).
 */
export async function removeMemberData(
  db: Executor,
  ctx: TenantContext,
  userId: string,
): Promise<{ secretIds: string[]; pausedScheduleIds: string[] }> {
  await db.delete(memories).where(tenantScope(ctx, memories, eq(memories.userId, userId)));
  await db
    .delete(knowledgeSources)
    .where(
      tenantScope(
        ctx,
        knowledgeSources,
        eq(knowledgeSources.scope, 'user'),
        eq(knowledgeSources.createdBy, userId),
      ),
    );
  const credentials = await db
    .delete(mcpUserCredentials)
    .where(tenantScope(ctx, mcpUserCredentials, eq(mcpUserCredentials.userId, userId)))
    .returning({ secretId: mcpUserCredentials.secretId });
  const paused = await db
    .update(schedules)
    .set({ active: false, updatedAt: new Date() })
    .where(tenantScope(ctx, schedules, eq(schedules.createdBy, userId), eq(schedules.active, true)))
    .returning({ id: schedules.id });
  return {
    secretIds: credentials.flatMap((c) => (c.secretId ? [c.secretId] : [])),
    pausedScheduleIds: paused.map((p) => p.id),
  };
}

/** Every workspace a person belongs to, for the workspace switcher. */
export async function listWorkspacesForUser(
  db: Executor,
  userId: string,
): Promise<{ id: string; name: string; role: WorkspaceRole }[]> {
  return db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

/** Points a session at another workspace (the caller checks membership). */
export async function setSessionWorkspace(
  db: Executor,
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  await db.update(sessions).set({ workspaceId }).where(eq(sessions.id, sessionId));
}

export async function renameWorkspace(db: Executor, ctx: TenantContext, name: string) {
  await db.update(workspaces).set({ name }).where(eq(workspaces.id, ctx.workspaceId));
}

// --- invitations ----------------------------------------------------------------

export async function insertInvitation(
  db: Executor,
  ctx: TenantContext,
  values: Pick<WorkspaceInvitation, 'email' | 'role' | 'tokenHash' | 'expiresAt'>,
): Promise<WorkspaceInvitation> {
  const [row] = await db
    .insert(workspaceInvitations)
    .values({ ...values, workspaceId: ctx.workspaceId, invitedBy: ctx.userId })
    .returning();
  return row!;
}

/** Open invitations: not accepted, not revoked, not expired. */
export async function listPendingInvitations(
  db: Executor,
  ctx: TenantContext,
  now = new Date(),
): Promise<WorkspaceInvitation[]> {
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      tenantScope(
        ctx,
        workspaceInvitations,
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, now),
      ),
    )
    .orderBy(desc(workspaceInvitations.createdAt));
}

/** Revokes any open invitation for this email (a new one replaces it). */
export async function revokeInvitationsForEmail(
  db: Executor,
  ctx: TenantContext,
  email: string,
): Promise<void> {
  await db
    .update(workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(
      tenantScope(
        ctx,
        workspaceInvitations,
        eq(workspaceInvitations.email, email),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
      ),
    );
}

export async function revokeInvitation(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  const rows = await db
    .update(workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(
      tenantScope(
        ctx,
        workspaceInvitations,
        eq(workspaceInvitations.id, id),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
      ),
    )
    .returning({ id: workspaceInvitations.id });
  return rows.length > 0;
}

/**
 * System-level lookup by token hash: the invitation page runs before the visitor belongs to
 * the workspace. Returns the workspace and inviter names for display.
 */
export async function findInvitationByTokenHash(db: Executor, tokenHash: string) {
  const [row] = await db
    .select({
      invitation: workspaceInvitations,
      workspaceName: workspaces.name,
      inviterName: users.displayName,
      inviterEmail: users.email,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .innerJoin(users, eq(users.id, workspaceInvitations.invitedBy))
    .where(eq(workspaceInvitations.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Marks an invitation used, only if it is still open (single use under concurrency). */
export async function markInvitationAccepted(
  db: Executor,
  id: string,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(workspaceInvitations)
    .set({ acceptedAt: now, acceptedBy: userId })
    .where(
      and(
        eq(workspaceInvitations.id, id),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, now),
      ),
    )
    .returning({ id: workspaceInvitations.id });
  return rows.length > 0;
}

export const countOwners = async (db: Executor, ctx: TenantContext) =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.role, 'owner')),
      )
  )[0]!.n;
