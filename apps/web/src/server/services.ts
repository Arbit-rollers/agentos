import 'server-only';
import { createDb } from '@agentos/db';
import {
  bullScheduler,
  createAgentQueue,
  createKnowledgeQueue,
  createWorkflowQueue,
  createRedis,
  createScheduleQueue,
  createSecretCipher,
  createSecretStore,
  loadEnv,
  rateLimitsEnabled,
  redisRateLimiter,
  type KnowledgeDeps,
  type WorkflowDeps,
  type ScheduleDeps,
} from '@agentos/core';

// Reuse connections across hot reloads in development.
const globalForServices = globalThis as unknown as {
  agentosServices?: ReturnType<typeof createServices>;
};

function createServices() {
  const env = loadEnv();
  const { db, sql } = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const secrets = createSecretStore(db, createSecretCipher(env.AGENTOS_MASTER_KEY));
  /** Model providers decrypt keys through the secret store only at call time. */
  const providerDeps = { secrets };
  /** MCP credentials and OAuth state, decrypted only at call time (PRD §21). */
  const mcpDeps = {
    secrets,
    appUrl: env.APP_URL,
    ...(env.AGENTOS_GOOGLE_CLIENT_ID &&
      env.AGENTOS_GOOGLE_CLIENT_SECRET && {
        googleClient: {
          id: env.AGENTOS_GOOGLE_CLIENT_ID,
          secret: env.AGENTOS_GOOGLE_CLIENT_SECRET,
        },
      }),
  };
  const agentQueue = createAgentQueue(redis);
  /** Chat turns, tasks and approvals hand runs to the worker; schedules go to the scheduler. */
  const knowledgeQueue = createKnowledgeQueue(redis);
  const workflowQueue = createWorkflowQueue(redis);
  /** Undefined in development and tests unless AGENTOS_RATE_LIMITS=on. */
  const rateLimiter = rateLimitsEnabled(env) ? redisRateLimiter(redis) : undefined;
  const runtimeDeps: ScheduleDeps & KnowledgeDeps & WorkflowDeps = {
    ...mcpDeps,
    ...(rateLimiter && { rateLimiter }),
    limits: {
      maxQueuedRuns: env.AGENTOS_MAX_QUEUED_RUNS,
      maxRunningRuns: env.AGENTOS_MAX_RUNNING_RUNS,
    },
    enqueueRun: async (job, options) =>
      void (await agentQueue.add('run', job, { delay: options?.delayMs ?? 0 })),
    scheduler: bullScheduler(createScheduleQueue(redis)),
    enqueueKnowledge: async (job) => void (await knowledgeQueue.add(job.kind, job)),
    enqueueWorkflow: async (job, options) =>
      void (await workflowQueue.add('advance', job, { delay: options?.delayMs ?? 0 })),
  };
  return { env, db, sql, redis, secrets, providerDeps, mcpDeps, runtimeDeps, rateLimiter };
}

export function getServices() {
  globalForServices.agentosServices ??= createServices();
  return globalForServices.agentosServices;
}
