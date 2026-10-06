import { Worker } from 'bullmq';
import { QUEUES, createRedis, loadEnv, type PingResult, type SystemJob } from '@agentos/core';

const env = loadEnv();
const connection = createRedis(env.REDIS_URL);

const systemWorker = new Worker<SystemJob['data'], PingResult, SystemJob['name']>(
  QUEUES.system,
  async (job) => {
    switch (job.name) {
      case 'ping':
        return {
          pong: true,
          requestedAt: job.data.requestedAt,
          processedAt: new Date().toISOString(),
        };
      default:
        throw new Error(`Unknown system job: ${String(job.name)}`);
    }
  },
  { connection },
);

systemWorker.on('ready', () => console.log(`[worker] listening on queue "${QUEUES.system}"`));
systemWorker.on('failed', (job, error) =>
  console.error(`[worker] job ${job?.id} (${job?.name}) failed: ${error.message}`),
);

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, draining…`);
  await systemWorker.close();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
