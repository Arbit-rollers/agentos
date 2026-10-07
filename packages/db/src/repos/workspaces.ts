import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { workspaceMembers, workspaces } from '../schema/index';
import type { TenantContext } from '../tenant';

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceRole = (typeof workspaceMembers.$inferSelect)['role'];

export async function createWorkspaceWithOwner(
  db: Executor,
  values: { ownerUserId: string; name: string },
): Promise<Workspace> {
  const [workspace] = await db.insert(workspaces).values(values).returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace!.id, userId: values.ownerUserId, role: 'owner' });
  return workspace!;
}

/** The user's first workspace by creation date — their private default workspace in the MVP. */
export async function findDefaultWorkspaceForUser(
  db: Executor,
  userId: string,
): Promise<Workspace | undefined> {
  const [row] = await db
    .select({ workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  return row?.workspace;
}

/** Membership check used when building a TenantContext. */
export async function findMembership(
  db: Executor,
  userId: string,
  workspaceId: string,
): Promise<{ workspace: Workspace; role: WorkspaceRole } | undefined> {
  const [row] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  return row;
}

/** Returns the workspace only if the caller is a member of it. */
export async function getWorkspace(
  db: Executor,
  ctx: TenantContext,
  workspaceId: string,
): Promise<Workspace | undefined> {
  return (await findMembership(db, ctx.userId, workspaceId))?.workspace;
}

/** Shallow-merges keys into the caller's workspace settings; `null` removes a key. */
export async function updateWorkspaceSettings(
  db: Executor,
  ctx: TenantContext,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const removed = Object.keys(patch).filter((key) => patch[key] === null);
  const kept = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
  let expression = sql`${workspaces.settings} || ${JSON.stringify(kept)}::jsonb`;
  for (const key of removed) expression = sql`(${expression}) - ${key}`;
  const [row] = await db
    .update(workspaces)
    .set({ settings: expression })
    .where(eq(workspaces.id, ctx.workspaceId))
    .returning({ settings: workspaces.settings });
  return row?.settings ?? {};
}
