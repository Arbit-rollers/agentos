import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// One .env at the repo root serves web, worker and db scripts.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    '@agentos/core',
    '@agentos/db',
    '@agentos/i18n',
    '@agentos/ui',
    '@agentos/personality',
    '@agentos/policy',
    '@agentos/model-gateway',
    '@agentos/mcp-gateway',
  ],
  serverExternalPackages: ['bullmq', 'ioredis', 'postgres', '@node-rs/argon2'],
};

export default withNextIntl(nextConfig);
