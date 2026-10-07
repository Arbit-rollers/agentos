import { and, asc, eq } from 'drizzle-orm';
import type { Executor } from '../client';
import { agents, schedules } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type Schedule = typeof schedules.$inferSelect;

export async function insertSchedule(
  db: Executor,
  ctx: TenantContext,
  values: Pick<
    Schedule,
    'agentId' | 'name' | 'objective' | 'input' | 'kind' | 'cron' | 'timezone' | 'runAt'
  >,
): Promise<Schedule> {
  const [row] = await db
    .insert(schedules)
    .values({ ...values, workspaceId: ctx.workspaceId, createdBy: ctx.userId })
    .returning();
  return row!;
}

export async function listSchedules(
  db: Executor,
  ctx: TenantContext,
): Promise<(Schedule & { agentName: string })[]> {
  const rows = await db
    .select({ schedule: schedules, agentName: agents.name })
    .from(schedules)
    .innerJoin(agents, eq(agents.id, schedules.agentId))
    .where(tenantScope(ctx, schedules))
    .orderBy(asc(schedules.createdAt));
  return rows.map((r) => ({ ...r.schedule, agentName: r.agentName }));
}

export async function findSchedule(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Schedule | undefined> {
  const [row] = await db
    .select()
    .from(schedules)
    .where(tenantScope(ctx, schedules, eq(schedules.id, id)))
    .limit(1);
  return row;
}

export async function updateSchedule(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<Pick<Schedule, 'active' | 'lastFiredAt' | 'lastTaskId'>>,
): Promise<Schedule | undefined> {
  const [row] = await db
    .update(schedules)
    .set({ ...values, updatedAt: new Date() })
    .where(tenantScope(ctx, schedules, eq(schedules.id, id)))
    .returning();
  return row;
}

export async function deleteSchedule(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(schedules)
    .where(tenantScope(ctx, schedules, eq(schedules.id, id)))
    .returning({ id: schedules.id });
  return rows.length > 0;
}

/** System-level: every active schedule, for mirroring into the job queue at worker start. */
export async function listActiveSchedulesForSync(db: Executor): Promise<Schedule[]> {
  return db
    .select()
    .from(schedules)
    .where(and(eq(schedules.active, true)));
}
