// Runs the fake MCP server standalone (Playwright starts it for E2E tests).
import { startFakeMcpServer } from './fake-mcp-server';

const { ready } = startFakeMcpServer({
  port: Number(process.env.FAKE_MCP_PORT ?? 4020),
  staticPort: Number(process.env.FAKE_MCP_STATIC_PORT ?? 4021),
});
const { url, staticUrl } = await ready;
console.log(`fake MCP server listening on ${url} (Google-like OAuth on ${staticUrl})`);
