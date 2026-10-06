import { Worker } from 'bullmq';
import { createDb, deleteExpiredSessions, listMcpConnectionsForHealthCheck } from '@agentos/db';
import {
  QUEUES,
  createRedis,
  createSecretCipher,
  createSecretStore,
  refreshMcpConnection,
  createSystemQueue,
  loadEnv,
  logger,
  type SystemJobData,
  type SystemJobName,
  type SystemJobResult,
} from '@agentos/core';

const env = loadEnv();
const log = logger.child({ service: 'worker' });
const connection = createRedis(env.REDIS_URL);
const { db, sql } = createDb(env.DATABASE_URL, { max: 5 });
const mcpDeps = {
  secrets: createSecretStore(db, createSecretCipher(env.AGENTOS_MASTER_KEY)),
  appUrl: env.APP_URL,
};

const systemWorker = new Worker<SystemJobData, SystemJobResult, SystemJobName>(
  QUEUES.system,
  async (job) => {
    switch (job.name) {
      case 'ping':
        return {
          pong: true,
          requestedAt: (job.data as { requestedAt: string }).requestedAt,
          processedAt: new Date().toISOString(),
        };
      case 'sessions.cleanup': {
        const deleted = await deleteExpiredSessions(db, new Date());
        if (deleted > 0) log.info('expired sessions removed', { deleted });
        return { deleted };
      }
      case 'mcp.health': {
        // PRD §8.1: keep each MCP Hub card's health current. Runs per connection under its
        // own workspace's context, so a check can only touch that workspace's data.
        let failing = 0;
        const connections = await listMcpConnectionsForHealthCheck(db);
        for (const c of connections) {
          const ctx = { workspaceId: c.workspaceId, userId: c.ownerUserId };
          const checked = await refreshMcpConnection(db, mcpDeps, ctx, c.id);
          if (checked.status !== 'connected') failing += 1;
        }
        if (failing > 0)
          log.warn('mcp connections failing', { failing, checked: connections.length });
        return { checked: connections.length, failing };
      }
      default:
        throw new Error(`Unknown system job: ${String(job.name)}`);
    }
  },
  { connection },
);

systemWorker.on('ready', () => log.info('listening', { queue: QUEUES.system }));
systemWorker.on('failed', (job, error) =>
  log.error('job failed', { jobId: job?.id, job: job?.name, error }),
);

// Idempotent: re-registering on every start just updates the schedule.
const systemQueue = createSystemQueue(connection);
await systemQueue.upsertJobScheduler(
  'sessions.cleanup',
  { every: 60 * 60 * 1000 },
  { name: 'sessions.cleanup', data: {} },
);
await systemQueue.upsertJobScheduler(
  'mcp.health',
  { every: 15 * 60 * 1000 },
  { name: 'mcp.health', data: {} },
);

async function shutdown(signal: string) {
  log.info('draining', { signal });
  await systemWorker.close();
  await systemQueue.close();
  await sql.end();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
