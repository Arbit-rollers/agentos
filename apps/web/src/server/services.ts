import 'server-only';
import { createDb } from '@agentos/db';
import { createRedis, loadEnv } from '@agentos/core';

// Reuse connections across hot reloads in development.
const globalForServices = globalThis as unknown as {
  agentosServices?: ReturnType<typeof createServices>;
};

function createServices() {
  const env = loadEnv();
  const { db, sql } = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  return { env, db, sql, redis };
}

export function getServices() {
  globalForServices.agentosServices ??= createServices();
  return globalForServices.agentosServices;
}
