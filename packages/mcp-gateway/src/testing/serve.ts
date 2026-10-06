// Runs the fake MCP server standalone (Playwright starts it for E2E tests).
import { startFakeMcpServer } from './fake-mcp-server';

const { ready } = startFakeMcpServer({ port: Number(process.env.FAKE_MCP_PORT ?? 4020) });
console.log(`fake MCP server listening on ${(await ready).url}`);
