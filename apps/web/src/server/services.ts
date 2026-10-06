import 'server-only';
import { createDb } from '@agentos/db';
import { createRedis, createSecretCipher, createSecretStore, loadEnv } from '@agentos/core';

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
  return { env, db, sql, redis, secrets, providerDeps };
}

export function getServices() {
  globalForServices.agentosServices ??= createServices();
  return globalForServices.agentosServices;
}
