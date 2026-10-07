import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The suite runs against `next dev`, which compiles each route on first visit.
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3000' },
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Stand-in for OpenAI-compatible, Ollama and Anthropic APIs (no real keys in tests).
      command: 'pnpm --filter @agentos/model-gateway fake-provider',
      url: 'http://127.0.0.1:4010/openai/v1/models',
      reuseExistingServer: !process.env.CI,
    },
    {
      // Agent runs execute in the worker (health endpoint on 4030).
      command: 'pnpm --filter @agentos/worker start',
      url: 'http://127.0.0.1:4030',
      reuseExistingServer: !process.env.CI,
    },
    {
      // Reference MCP server (no auth, bearer, OAuth with an auto-approving login, SSE).
      command: 'pnpm --filter @agentos/mcp-gateway fake-mcp',
      url: 'http://127.0.0.1:4020/.well-known/oauth-authorization-server',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
