import 'server-only';
import { createDb } from '@agentos/db';
import {
  createAgentQueue,
  createRedis,
  createSecretCipher,
  createSecretStore,
  loadEnv,
  type RuntimeDeps,
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
  const mcpDeps = { secrets, appUrl: env.APP_URL };
  const agentQueue = createAgentQueue(redis);
  /** Chat turns and approvals hand runs to the worker through the agent queue. */
  const runtimeDeps: RuntimeDeps = {
    ...mcpDeps,
    enqueueRun: async (job) => void (await agentQueue.add('run', job)),
  };
  return { env, db, sql, redis, secrets, providerDeps, mcpDeps, runtimeDeps };
}

export function getServices() {
  globalForServices.agentosServices ??= createServices();
  return globalForServices.agentosServices;
}
