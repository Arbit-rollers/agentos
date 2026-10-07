import {
  deleteSchedule as deleteScheduleRow,
  findAgent,
  findSchedule,
  insertSchedule,
  listActiveSchedulesForSync,
  updateSchedule,
  type Database,
  type Schedule,
  type TenantContext,
} from '@agentos/db';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { recordAudit } from './audit';
import { parse } from './auth';
import { AppError } from './errors';
import { requireCreatorOrAdmin } from './permissions';
import type { RuntimeDeps } from './runtime';
import { createTask } from './tasks';
import { isValidTimezone } from './time';

/**
 * Where active schedules live at runtime (BullMQ job schedulers in production, a fake in
 * tests). The database stays the source of truth; `syncSchedules` rebuilds the port from it.
 */
export type SchedulerPort = {
  upsert(schedule: Schedule): Promise<void>;
  remove(scheduleId: string): Promise<void>;
  /** Ids of every schedule the port currently holds. */
  list(): Promise<string[]>;
};

export type ScheduleDeps = RuntimeDeps & { scheduler: SchedulerPort };

export { isValidTimezone } from './time';

/** Next firing time, or null for inactive / already-fired one-time schedules. */
export function nextRunAt(
  schedule: Pick<Schedule, 'kind' | 'cron' | 'timezone' | 'runAt' | 'active'>,
  now = new Date(),
): Date | null {
  if (!schedule.active) return null;
  if (schedule.kind === 'once')
    return schedule.runAt && schedule.runAt > now ? schedule.runAt : null;
  return CronExpressionParser.parse(schedule.cron!, { tz: schedule.timezone, currentDate: now })
    .next()
    .toDate();
}

const scheduleSchema = z
  .object({
    agentId: z.uuid({ error: 'agent_required' }),
    name: z.string().trim().min(1, { error: 'schedule_name_required' }).max(80),
    objective: z
      .string()
      .trim()
      .min(1, { error: 'objective_required' })
      .max(500, { error: 'objective_too_long' }),
    input: z.string().max(20_000).default(''),
    kind: z.enum(['recurring', 'once']),
    cron: z.string().trim().optional(),
    timezone: z.string().refine(isValidTimezone, { error: 'invalid_timezone' }),
    runAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'recurring') {
      // Five fields only: minute granularity keeps schedules from hammering providers.
      const fields = value.cron?.split(/\s+/).filter(Boolean) ?? [];
      let valid = fields.length === 5;
      if (valid) {
        try {
          CronExpressionParser.parse(value.cron!, { tz: value.timezone });
        } catch {
          valid = false;
        }
      }
      if (!valid) ctx.addIssue({ code: 'custom', path: ['cron'], message: 'invalid_cron' });
    } else if (!value.runAt || value.runAt.getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', path: ['runAt'], message: 'run_at_in_past' });
    }
  });

export type ScheduleInput = z.input<typeof scheduleSchema>;

async function requireSchedule(db: Database, ctx: TenantContext, id: string) {
  const schedule = await findSchedule(db, ctx, id);
  if (!schedule) throw new AppError('NOT_FOUND', 'Schedule not found');
  return schedule;
}

const audit = (db: Database, ctx: TenantContext, action: string, schedule: Schedule) =>
  recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: schedule.agentId,
    action,
    targetType: 'schedule',
    targetId: schedule.id,
    outcome: 'success',
    metadata: {
      name: schedule.name,
      kind: schedule.kind,
      cron: schedule.cron,
      timezone: schedule.timezone,
    },
  });

/** Schedules → New schedule (PRD §17). */
export async function createSchedule(
  db: Database,
  deps: ScheduleDeps,
  ctx: TenantContext,
  input: ScheduleInput,
): Promise<Schedule> {
  const data = parse(scheduleSchema, input);
  if (!(await findAgent(db, ctx, data.agentId)))
    throw new AppError('VALIDATION', 'Unknown agent', { agentId: ['agent_required'] });
  const schedule = await insertSchedule(db, ctx, {
    agentId: data.agentId,
    name: data.name,
    objective: data.objective,
    input: data.input,
    kind: data.kind,
    cron: data.kind === 'recurring' ? data.cron! : null,
    timezone: data.timezone,
    runAt: data.kind === 'once' ? data.runAt! : null,
  });
  await deps.scheduler.upsert(schedule);
  await audit(db, ctx, 'schedule.created', schedule);
  return schedule;
}

export async function setScheduleActive(
  db: Database,
  deps: ScheduleDeps,
  ctx: TenantContext,
  id: string,
  active: boolean,
) {
  const current = await requireSchedule(db, ctx, id);
  await requireCreatorOrAdmin(db, ctx, current.createdBy);
  const schedule = (await updateSchedule(db, ctx, id, { active }))!;
  if (active) await deps.scheduler.upsert(schedule);
  else await deps.scheduler.remove(id);
  await audit(db, ctx, active ? 'schedule.resumed' : 'schedule.paused', schedule);
}

export async function deleteSchedule(
  db: Database,
  deps: ScheduleDeps,
  ctx: TenantContext,
  id: string,
) {
  const schedule = await requireSchedule(db, ctx, id);
  await requireCreatorOrAdmin(db, ctx, schedule.createdBy);
  await deps.scheduler.remove(id);
  await deleteScheduleRow(db, ctx, id);
  await audit(db, ctx, 'schedule.deleted', schedule);
}

/**
 * A schedule fires: creates a task for its agent. Called by the worker when the job queue
 * fires, and by "Run now". Paused or deleted schedules don't fire; one-time schedules
 * switch themselves off after firing.
 */
export async function fireSchedule(
  db: Database,
  deps: ScheduleDeps,
  ctx: TenantContext,
  id: string,
  options: { manual?: boolean } = {},
) {
  const schedule = await findSchedule(db, ctx, id);
  if (!schedule || (!schedule.active && !options.manual)) return null;
  // "Run now" from the UI: its creator or an admin. Timed firings run as the creator.
  if (options.manual) await requireCreatorOrAdmin(db, ctx, schedule.createdBy);
  const task = await createTask(
    db,
    deps,
    ctx,
    {
      agentId: schedule.agentId,
      objective: schedule.objective,
      input: schedule.input,
      maxRetries: 2,
    },
    { kind: 'schedule', scheduleId: schedule.id },
  );
  await updateSchedule(db, ctx, id, {
    lastFiredAt: new Date(),
    lastTaskId: task.id,
    ...(schedule.kind === 'once' && !options.manual && { active: false }),
  });
  if (schedule.kind === 'once' && !options.manual) await deps.scheduler.remove(id);
  return task;
}

/**
 * Worker start: makes the job queue match the database. Active schedules are (re)registered
 * and anything else is removed. A one-time schedule whose time passed while the worker was
 * down fires once now rather than being lost.
 */
export async function syncSchedules(db: Database, deps: ScheduleDeps, now = new Date()) {
  const active = await listActiveSchedulesForSync(db);
  const wanted = new Set(active.map((s) => s.id));
  for (const id of await deps.scheduler.list())
    if (!wanted.has(id)) await deps.scheduler.remove(id);
  let missed = 0;
  for (const schedule of active) {
    if (schedule.kind === 'once' && schedule.runAt && schedule.runAt <= now) {
      const ctx = { workspaceId: schedule.workspaceId, userId: schedule.createdBy };
      await fireSchedule(db, deps, ctx, schedule.id);
      missed += 1;
      continue;
    }
    await deps.scheduler.upsert(schedule);
  }
  return { registered: active.length - missed, missedFired: missed };
}
