import { findSchedule, insertSchedule, listTasks, type Schedule } from '@agentos/db';
import { describe, expect, it } from 'vitest';
import {
  createSchedule,
  deleteSchedule,
  fireSchedule,
  nextRunAt,
  setScheduleActive,
  syncSchedules,
  type ScheduleDeps,
  type SchedulerPort,
} from '../src/schedules';
import { useAgentFixture } from './agent-fixture';
import { createUser } from './helpers';

const { db, deps, drain, setup } = useAgentFixture();

function memoryScheduler(): SchedulerPort & { held: Map<string, Schedule> } {
  const held = new Map<string, Schedule>();
  return {
    held,
    upsert: async (s) => void held.set(s.id, s),
    remove: async (id) => void held.delete(id),
    list: async () => [...held.keys()],
  };
}

const sdeps = (scheduler = memoryScheduler()) =>
  ({ ...deps, scheduler }) as ScheduleDeps & { scheduler: ReturnType<typeof memoryScheduler> };
const recurring = (agentId: string) => ({
  agentId,
  name: 'Weekly trends',
  objective: 'Research aviation trends',
  kind: 'recurring' as const,
  cron: '0 9 * * 1',
  timezone: 'Europe/Istanbul',
});

describe('schedules (PRD §17)', () => {
  it('validates cron (minute granularity), timezone and one-time dates', async () => {
    const s = await setup();
    const d = sdeps();
    await expect(
      createSchedule(db, d, s.ctx, { ...recurring(s.agent.id), cron: '*/5 * * * * *' }),
    ).rejects.toMatchObject({ details: { cron: ['invalid_cron'] } });
    await expect(
      createSchedule(db, d, s.ctx, { ...recurring(s.agent.id), timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({ details: { timezone: ['invalid_timezone'] } });
    await expect(
      createSchedule(db, d, s.ctx, {
        agentId: s.agent.id,
        name: 'x',
        objective: 'y',
        kind: 'once',
        timezone: 'UTC',
        runAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toMatchObject({ details: { runAt: ['run_at_in_past'] } });
  });

  it('computes the next run in the schedule timezone', () => {
    const next = nextRunAt(
      {
        kind: 'recurring',
        cron: '0 9 * * 1',
        timezone: 'Europe/Istanbul',
        runAt: null,
        active: true,
      },
      new Date('2026-10-07T12:00:00Z'),
    );
    // Monday 12 Oct 2026, 09:00 Istanbul (UTC+3) = 06:00 UTC.
    expect(next?.toISOString()).toBe('2026-10-12T06:00:00.000Z');
  });

  it('registers with the scheduler and creates a task when it fires', async () => {
    const s = await setup();
    const d = sdeps();
    const schedule = await createSchedule(db, d, s.ctx, recurring(s.agent.id));
    expect(d.scheduler.held.has(schedule.id)).toBe(true);
    const task = await fireSchedule(db, d, s.ctx, schedule.id);
    await drain(s.ctx);
    expect(task).toMatchObject({ origin: 'schedule', scheduleId: schedule.id, maxRetries: 2 });
    expect((await listTasks(db, s.ctx)).find((t) => t.id === task!.id)?.state).toBe('completed');
    expect((await findSchedule(db, s.ctx, schedule.id))!.lastTaskId).toBe(task!.id);
  });

  it('paused and deleted schedules do not fire; Run now always does', async () => {
    const s = await setup();
    const d = sdeps();
    const schedule = await createSchedule(db, d, s.ctx, recurring(s.agent.id));
    await setScheduleActive(db, d, s.ctx, schedule.id, false);
    expect(d.scheduler.held.has(schedule.id)).toBe(false);
    expect(await fireSchedule(db, d, s.ctx, schedule.id)).toBeNull();
    expect(await fireSchedule(db, d, s.ctx, schedule.id, { manual: true })).not.toBeNull();
    await deleteSchedule(db, d, s.ctx, schedule.id);
    expect(await fireSchedule(db, d, s.ctx, schedule.id, { manual: true })).toBeNull();
  });

  it('one-time schedules switch off after firing', async () => {
    const s = await setup();
    const d = sdeps();
    const once = await createSchedule(db, d, s.ctx, {
      agentId: s.agent.id,
      name: 'Once',
      objective: 'x',
      kind: 'once',
      timezone: 'UTC',
      runAt: new Date(Date.now() + 60_000),
    });
    await fireSchedule(db, d, s.ctx, once.id);
    expect((await findSchedule(db, s.ctx, once.id))!.active).toBe(false);
    expect(d.scheduler.held.has(once.id)).toBe(false);
  });

  it('a schedule for an agent that cannot run records a failed task instead of losing the firing', async () => {
    const s = await setup();
    const d = sdeps();
    const schedule = await createSchedule(db, d, s.ctx, recurring(s.agent.id));
    await (await import('../src/agents')).changeAgentStatus(db, s.ctx, s.agent.id, 'pause');
    const task = await fireSchedule(db, d, s.ctx, schedule.id);
    expect(task).toMatchObject({ state: 'failed', error: 'agent_not_runnable' });
  });

  it('sync on worker start: re-registers, removes orphans and fires missed one-time schedules', async () => {
    const s = await setup();
    const d = sdeps();
    const kept = await createSchedule(db, d, s.ctx, recurring(s.agent.id));
    // A one-time schedule whose time passed while the worker was down.
    const missed = await insertSchedule(db, s.ctx, {
      agentId: s.agent.id,
      name: 'Missed',
      objective: 'late',
      input: '',
      kind: 'once',
      cron: null,
      timezone: 'UTC',
      runAt: new Date(Date.now() - 60_000),
    });
    d.scheduler.held.clear();
    d.scheduler.held.set('00000000-0000-0000-0000-000000000000', kept); // orphan from an old database
    const result = await syncSchedules(db, d);
    expect(d.scheduler.held.has(kept.id)).toBe(true);
    expect(d.scheduler.held.has('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(result.missedFired).toBeGreaterThanOrEqual(1);
    expect((await findSchedule(db, s.ctx, missed.id))!.lastTaskId).not.toBeNull();
  });

  it('is isolated per workspace (AC 2)', async () => {
    const s = await setup();
    const d = sdeps();
    const schedule = await createSchedule(db, d, s.ctx, recurring(s.agent.id));
    const other = await createUser(db);
    await expect(setScheduleActive(db, d, other.ctx, schedule.id, false)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(deleteSchedule(db, d, other.ctx, schedule.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await fireSchedule(db, d, other.ctx, schedule.id, { manual: true })).toBeNull();
    await expect(createSchedule(db, d, other.ctx, recurring(s.agent.id))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
