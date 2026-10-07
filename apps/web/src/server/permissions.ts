import 'server-only';
import type { AuthenticatedSession } from '@agentos/core';

// Mirrors packages/core/src/permissions.ts so pages can hide what the server would refuse.
// The server check is the real one; these only decide what to show.

export const isAdmin = (session: AuthenticatedSession) =>
  session.role === 'owner' || session.role === 'admin';

/** The item's creator, or an owner/admin. */
export const canManageItem = (
  session: AuthenticatedSession,
  createdBy: string | null | undefined,
) => isAdmin(session) || (Boolean(createdBy) && createdBy === session.ctx.userId);

export const canManageAgent = (session: AuthenticatedSession, agent: { ownerUserId: string }) =>
  canManageItem(session, agent.ownerUserId);
