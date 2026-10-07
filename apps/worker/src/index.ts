import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import { createDb, deleteExpiredSessions, listMcpConnectionsForHealthCheck } from '@agentos/db';
import {
  QUEUES,
  createAgentQueue,
  createRedis,
  createSecretCipher,
  createSecretStore,
  createSystemQueue,
  executeRun,
  loadEnv,
  logger,
  refreshMcpConnection,
  type AgentRunJob,
  type RuntimeDeps,
  type SystemJobData,
  type SystemJobName,
  type SystemJobResult,
} from '@agentos/core';

const env = loadEnv();
const log = logger.child({ service: 'worker' });
const connection = createRedis(env.REDIS_URL);
const { db, sql } = createDb(env.DATABASE_URL, { max: 10 });
const secrets = createSecretStore(db, createSecretCipher(env.AGENTOS_MASTER_KEY));
const agentQueue = createAgentQueue(connection);
const runtimeDeps: RuntimeDeps = {
  secrets,
  appUrl: env.APP_URL,
  enqueueRun: async (job) => void (await agentQueue.add('run', job)),
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
          const checked = await refreshMcpConnection(db, runtimeDeps, ctx, c.id);
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

/**
 * Agent runs (PRD §24 Agent Runtime). Each job runs or resumes one run under the context of
 * the user who started it; executeRun claims the run atomically, so redelivery is harmless.
 */
const agentWorker = new Worker<AgentRunJob, void, 'run'>(
  QUEUES.agent,
  async (job) => {
    const { runId, workspaceId, userId } = job.data;
    await executeRun(db, runtimeDeps, { workspaceId, userId }, runId);
  },
  { connection, concurrency: 4 },
);

for (const worker of [systemWorker, agentWorker]) {
  worker.on('ready', () => log.info('listening', { queue: worker.name }));
  worker.on('failed', (job, error) =>
    log.error('job failed', { queue: worker.name, jobId: job?.id, job: job?.name, error }),
  );
}

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

// Liveness for Docker and the E2E harness.
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 4030);
const health = createServer((_req, res) => {
  res.writeHead(agentWorker.isRunning() ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: agentWorker.isRunning() }));
}).listen(healthPort, '127.0.0.1');

async function shutdown(signal: string) {
  log.info('draining', { signal });
  health.close();
  await Promise.all([systemWorker.close(), agentWorker.close()]);
  await Promise.all([systemQueue.close(), agentQueue.close()]);
  await sql.end();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
