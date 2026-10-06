import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// One .env at the repo root serves web, worker and db scripts.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@agentos/core', '@agentos/db', '@agentos/i18n', '@agentos/ui'],
  serverExternalPackages: ['bullmq', 'ioredis', 'postgres'],
};

export default nextConfig;
