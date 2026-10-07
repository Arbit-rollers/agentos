import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUES = {
  system: 'system',
  /** Agent runs (chat turns and tasks): one job per run step. */
  agent: 'agent',
  /** Schedule firings (PRD §17). */
  schedules: 'schedules',
} as const;

export type PingResult = { pong: true; requestedAt: string; processedAt: string };

/** Jobs on the `system` queue: name → payload and result. */
export type SystemJobs = {
  ping: { data: { requestedAt: string }; result: PingResult };
  'sessions.cleanup': { data: Record<string, never>; result: { deleted: number } };
  'mcp.health': { data: Record<string, never>; result: { checked: number; failing: number } };
  'runs.recover': { data: Record<string, never>; result: { recovered: number } };
};
export type SystemJobName = keyof SystemJobs;
export type SystemJobData = SystemJobs[SystemJobName]['data'];
export type SystemJobResult = SystemJobs[SystemJobName]['result'];

/**
 * BullMQ workers require `maxRetriesPerRequest: null` on their connection. Connection errors
 * are logged once per outage instead of surfacing as unhandled `error` events; ioredis keeps
 * reconnecting in the background.
 */
export function createRedis(redisUrl: string, label = 'redis'): Redis {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  let down = false;
  redis.on('error', (error: Error) => {
    if (down) return;
    down = true;
    console.warn(`[${label}] connection error: ${error.message || error.name}`);
  });
  redis.on('ready', () => {
    if (down) console.info(`[${label}] reconnected`);
    down = false;
  });
  return redis;
}

export function createSystemQueue(connection: Redis) {
  return new Queue<SystemJobData, SystemJobResult, SystemJobName>(QUEUES.system, {
    connection,
  });
}

export type AgentRunJob = { runId: string; workspaceId: string; userId: string };

export function createAgentQueue(connection: Redis) {
  return new Queue<AgentRunJob, void, 'run'>(QUEUES.agent, { connection });
}
