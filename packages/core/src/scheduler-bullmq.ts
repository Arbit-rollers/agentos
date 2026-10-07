import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Schedule } from '@agentos/db';
import { QUEUES } from './queue';
import type { SchedulerPort } from './schedules';

export type ScheduleJob = { scheduleId: string; workspaceId: string; userId: string };

const recurringKey = (id: string) => `schedule-${id}`;
const onceKey = (id: string) => `once-${id}`;
const idOf = (key: string) => key.replace(/^(schedule|once)-/, '');

export function createScheduleQueue(connection: Redis, name: string = QUEUES.schedules) {
  // BullMQ types scheduler ids with the job-name type, so names stay a plain string.
  return new Queue<ScheduleJob, void, string>(name, { connection });
}

/**
 * SchedulerPort on BullMQ: recurring schedules become job schedulers (cron + IANA timezone,
 * persisted in Redis so they keep firing across worker restarts); one-time schedules
 * become a single delayed job.
 */
export function bullScheduler(queue: ReturnType<typeof createScheduleQueue>): SchedulerPort {
  const removeOnce = async (id: string) => {
    const job = await queue.getJob(onceKey(id));
    if (job) await job.remove();
  };
  return {
    async upsert(schedule: Schedule) {
      const data = {
        scheduleId: schedule.id,
        workspaceId: schedule.workspaceId,
        userId: schedule.createdBy,
      };
      if (schedule.kind === 'recurring' && schedule.cron) {
        await removeOnce(schedule.id);
        await queue.upsertJobScheduler(
          recurringKey(schedule.id),
          { pattern: schedule.cron, tz: schedule.timezone },
          { name: 'fire', data },
        );
        return;
      }
      await queue.removeJobScheduler(recurringKey(schedule.id));
      await removeOnce(schedule.id);
      const delay = Math.max(0, (schedule.runAt?.getTime() ?? Date.now()) - Date.now());
      await queue.add('fire', data, {
        jobId: onceKey(schedule.id),
        delay,
        removeOnComplete: true,
        removeOnFail: 100,
      });
    },
    async remove(scheduleId: string) {
      await queue.removeJobScheduler(recurringKey(scheduleId));
      await removeOnce(scheduleId);
    },
    async list() {
      const recurring = (await queue.getJobSchedulers()).map((s) => idOf(s.key));
      const once = (await queue.getDelayed()).flatMap((job) =>
        job.id?.startsWith('once-') ? [idOf(job.id)] : [],
      );
      return [...new Set([...recurring, ...once])];
    },
  };
}
