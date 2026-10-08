import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import { createDb, deleteExpiredSessions, listMcpConnectionsForHealthCheck } from '@agentos/db';
import {
  QUEUES,
  bullScheduler,
  createAgentQueue,
  createKnowledgeQueue,
  createWorkflowQueue,
  createRedis,
  createScheduleQueue,
  createSecretCipher,
  createSecretStore,
  createSystemQueue,
  executeRun,
  fireSchedule,
  ingestKnowledgeSource,
  advanceWorkflowRun,
  loadEnv,
  logger,
  recoverStaleRuns,
  refreshMcpConnection,
  reindexWorkspace,
  syncSchedules,
  type AgentRunJob,
  type KnowledgeDeps,
  type KnowledgeJob,
  type WorkflowDeps,
  type WorkflowJob,
  type ScheduleDeps,
  type ScheduleJob,
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
const scheduleQueue = createScheduleQueue(connection);
const knowledgeQueue = createKnowledgeQueue(connection);
const workflowQueue = createWorkflowQueue(connection);
const deps: ScheduleDeps & KnowledgeDeps & WorkflowDeps = {
  secrets,
  appUrl: env.APP_URL,
  enqueueRun: async (job, options) =>
    void (await agentQueue.add('run', job, { delay: options?.delayMs ?? 0 })),
  scheduler: bullScheduler(scheduleQueue),
  enqueueKnowledge: async (job) => void (await knowledgeQueue.add(job.kind, job)),
  enqueueWorkflow: async (job, options) =>
    void (await workflowQueue.add('advance', job, { delay: options?.delayMs ?? 0 })),
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
          const checked = await refreshMcpConnection(db, deps, ctx, c.id);
          if (checked.status !== 'connected') failing += 1;
        }
        if (failing > 0)
          log.warn('mcp connections failing', { failing, checked: connections.length });
        return { checked: connections.length, failing };
      }
      case 'runs.recover': {
        // Runs whose worker died mid-way go back on the queue and resume from saved state.
        const recovered = await recoverStaleRuns(db, deps);
        if (recovered > 0) log.warn('re-queued interrupted runs', { recovered });
        return { recovered };
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
    await executeRun(db, deps, { workspaceId, userId }, runId);
  },
  { connection, concurrency: 4 },
);

/** Schedule firings (PRD §17): each creates a task under the schedule creator's context. */
const scheduleWorker = new Worker<ScheduleJob>(
  scheduleQueue.name,
  async (job) => {
    const { scheduleId, workspaceId, userId } = job.data;
    await fireSchedule(db, deps, { workspaceId, userId }, scheduleId);
  },
  { connection },
);

/**
 * Knowledge (PRD §11): fetch, chunk and embed a source, or re-index the workspace after the
 * embedding model changed. Runs as the source's owner, so private sources stay private.
 */
const knowledgeWorker = new Worker<KnowledgeJob>(
  knowledgeQueue.name,
  async (job) => {
    const ctx = { workspaceId: job.data.workspaceId, userId: job.data.userId };
    if (job.data.kind === 'ingest') await ingestKnowledgeSource(db, deps, ctx, job.data.sourceId);
    else log.info('workspace re-indexed', await reindexWorkspace(db, deps, ctx));
  },
  { connection, concurrency: 2 },
);

/**
 * Workflow runs (PRD §16): each job advances one run as far as it can, as the person it acts
 * for. Waiting steps (agents, approvals, delays) wake it again with a new job.
 */
const workflowWorker = new Worker<WorkflowJob>(
  workflowQueue.name,
  async (job) => {
    const { runId, workspaceId, userId } = job.data;
    await advanceWorkflowRun(db, deps, { workspaceId, userId }, runId);
  },
  { connection, concurrency: 4 },
);

for (const worker of [systemWorker, agentWorker, scheduleWorker, knowledgeWorker, workflowWorker]) {
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
await systemQueue.upsertJobScheduler(
  'runs.recover',
  { every: 60 * 1000 },
  { name: 'runs.recover', data: {} },
);

// The database is the source of truth for schedules; make Redis match it.
log.info('schedules synced', await syncSchedules(db, deps));

// Liveness for Docker and the E2E harness.
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 4030);
const health = createServer((_req, res) => {
  res.writeHead(agentWorker.isRunning() ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: agentWorker.isRunning() }));
}).listen(healthPort, '127.0.0.1');

async function shutdown(signal: string) {
  log.info('draining', { signal });
  health.close();
  await Promise.all([
    systemWorker.close(),
    agentWorker.close(),
    scheduleWorker.close(),
    knowledgeWorker.close(),
    workflowWorker.close(),
  ]);
  await Promise.all([
    systemQueue.close(),
    agentQueue.close(),
    scheduleQueue.close(),
    knowledgeQueue.close(),
    workflowQueue.close(),
  ]);
  await sql.end();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
