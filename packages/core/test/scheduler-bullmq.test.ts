// "A recurring schedule keeps firing across a worker restart" (ROADMAP v0.2 DoD), against
// real BullMQ + Redis. Schedulers live in Redis, so a fresh worker picks them up.
import { insertSchedule, listTasks } from '@agentos/db';
import { Worker } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { createRedis } from '../src/queue';
import { bullScheduler, createScheduleQueue, type ScheduleJob } from '../src/scheduler-bullmq';
import { fireSchedule, syncSchedules, type ScheduleDeps } from '../src/schedules';
import { useAgentFixture } from './agent-fixture';

const { db, deps, setup } = useAgentFixture();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = createRedis(redisUrl, 'test-redis');
const queueName = `test-schedules-${Date.now()}`;
const queue = createScheduleQueue(connection, queueName);
const scheduleDeps: ScheduleDeps = { ...deps, scheduler: bullScheduler(queue) };

afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
  connection.disconnect();
});

function startWorker() {
  return new Worker<ScheduleJob>(
    queueName,
    async (job) => {
      const { scheduleId, workspaceId, userId } = job.data;
      await fireSchedule(db, scheduleDeps, { workspaceId, userId }, scheduleId);
    },
    { connection: createRedis(redisUrl, 'test-worker') },
  );
}

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 10_000) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
};

describe('BullMQ schedules', () => {
  it('keep firing after the worker is replaced', async () => {
    const s = await setup();
    // Per-second cron is only possible by writing the row directly; the API allows minutes.
    const schedule = await insertSchedule(db, s.ctx, {
      agentId: s.agent.id,
      name: 'Every second',
      objective: 'tick',
      input: '',
      kind: 'recurring',
      cron: '* * * * * *',
      timezone: 'UTC',
      runAt: null,
    });
    await syncSchedules(db, scheduleDeps);
    expect(await scheduleDeps.scheduler.list()).toContain(schedule.id);

    const fired = async () =>
      (await listTasks(db, s.ctx)).filter((t) => t.scheduleId === schedule.id).length;
    const workerA = startWorker();
    await waitFor(async () => (await fired()) >= 1);
    await workerA.close(true); // abrupt, like a crash
    const before = await fired();

    const workerB = startWorker();
    await waitFor(async () => (await fired()) > before);
    await workerB.close();
    await scheduleDeps.scheduler.remove(schedule.id);
    expect(await scheduleDeps.scheduler.list()).not.toContain(schedule.id);
  }, 30_000);

  it('one-time schedules fire once at their time', async () => {
    const s = await setup();
    const schedule = await insertSchedule(db, s.ctx, {
      agentId: s.agent.id,
      name: 'Soon',
      objective: 'once',
      input: '',
      kind: 'once',
      cron: null,
      timezone: 'UTC',
      runAt: new Date(Date.now() + 1500),
    });
    await scheduleDeps.scheduler.upsert(schedule);
    const worker = startWorker();
    const fired = async () =>
      (await listTasks(db, s.ctx)).filter((t) => t.scheduleId === schedule.id).length;
    await waitFor(async () => (await fired()) === 1);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await fired()).toBe(1);
    await worker.close();
  }, 20_000);
});
