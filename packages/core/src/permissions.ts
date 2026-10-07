import { findMembership, type Executor, type TenantContext, type WorkspaceRole } from '@agentos/db';
import { AppError } from './errors';

/**
 * Workspace roles (v0.4.3). Owners and admins run the workspace: providers, MCP servers,
 * embeddings, members, and anything anyone created. Members use it: they chat, create agents,
 * tasks, schedules and private knowledge, and manage what they created themselves.
 * Checked in core, on the server, for every call; the UI only hides what would be refused.
 */
export async function workspaceRole(db: Executor, ctx: TenantContext): Promise<WorkspaceRole> {
  const membership = await findMembership(db, ctx.userId, ctx.workspaceId);
  if (!membership) throw new AppError('FORBIDDEN', 'Not a member of this workspace');
  return membership.role;
}

export const isWorkspaceAdmin = (role: WorkspaceRole) => role === 'owner' || role === 'admin';

/** Owners and admins only. */
export async function requireWorkspaceAdmin(db: Executor, ctx: TenantContext) {
  const role = await workspaceRole(db, ctx);
  if (!isWorkspaceAdmin(role))
    throw new AppError('FORBIDDEN', 'Owners and admins only', { permission: ['admin_only'] });
  return role;
}

/** Whoever created it, or an owner/admin. */
export async function requireCreatorOrAdmin(
  db: Executor,
  ctx: TenantContext,
  createdBy: string | null | undefined,
) {
  if (createdBy && createdBy === ctx.userId) return;
  if (isWorkspaceAdmin(await workspaceRole(db, ctx))) return;
  throw new AppError('FORBIDDEN', 'Only its creator or an admin can do that', {
    permission: ['creator_or_admin'],
  });
}

/** Changing an agent: the person who created it, or an owner/admin. */
export const requireAgentManager = (
  db: Executor,
  ctx: TenantContext,
  agent: { ownerUserId: string },
) => requireCreatorOrAdmin(db, ctx, agent.ownerUserId);
