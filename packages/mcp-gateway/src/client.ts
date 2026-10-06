import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { McpGatewayError } from './errors';
import type { Discovery, McpAccess, NormalizedTool, ToolResult } from './types';

const CLIENT_INFO = { name: 'AgentOS', version: '0.1.0' };
const TIMEOUT_MS = 30_000;

function headersFor(access: McpAccess): Record<string, string> {
  switch (access.auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${access.auth.token}` };
    case 'headers':
      return access.auth.headers;
    default:
      return {};
  }
}

function transportFor(access: McpAccess) {
  const url = new URL(access.endpoint);
  const options = {
    requestInit: { headers: headersFor(access) },
    ...(access.auth.type === 'oauth' && { authProvider: access.auth.provider }),
  };
  return access.transport === 'sse'
    ? new SSEClientTransport(url, options)
    : new StreamableHTTPClientTransport(url, options);
}

function fromStatus(code: number | undefined): McpGatewayError {
  if (code === 401 || code === 403)
    return new McpGatewayError('auth', 'The server rejected the credentials');
  if (code === 404) return new McpGatewayError('unavailable', 'No MCP endpoint at this URL');
  if (code === 408 || code === 504)
    return new McpGatewayError('timeout', 'The server did not answer in time');
  if (code !== undefined && code >= 500)
    return new McpGatewayError('unavailable', 'The server is unavailable');
  return new McpGatewayError('protocol', 'The server returned an unexpected response');
}

/** Maps SDK and network failures onto a few kinds, using typed errors and status codes. */
export function classifyMcpError(error: unknown): unknown {
  if (error instanceof McpGatewayError) return error;
  if (error instanceof UnauthorizedError)
    return new McpGatewayError('auth', 'The server requires authorization');
  if (error instanceof StreamableHTTPError || error instanceof SseError)
    return fromStatus(error.code);
  if (error instanceof McpError) {
    // JSON-RPC level: -32001 is the SDK's request timeout.
    return error.code === -32001
      ? new McpGatewayError('timeout', 'The server did not answer in time')
      : new McpGatewayError('protocol', 'The server returned an error');
  }
  // fetch() network failures surface as TypeError ("fetch failed").
  if (error instanceof TypeError)
    return new McpGatewayError('unavailable', 'Could not reach the server');
  return new McpGatewayError('protocol', 'The server returned an unexpected response');
}

/** Opens a session, runs `fn`, and always closes the session. */
export async function withMcpClient<T>(
  access: McpAccess,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(CLIENT_INFO);
  try {
    await client.connect(transportFor(access), { timeout: TIMEOUT_MS });
    return await fn(client);
  } catch (error) {
    throw classifyMcpError(error);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Server info, all tools (following pagination) and resources (PRD §8.3). */
export async function discover(access: McpAccess): Promise<Discovery> {
  return withMcpClient(access, async (client) => {
    const info = client.getServerVersion();
    const capabilities = client.getServerCapabilities() ?? {};

    const tools: NormalizedTool[] = [];
    if (capabilities.tools) {
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: TIMEOUT_MS });
        for (const tool of page.tools) {
          tools.push({
            name: tool.name,
            ...(tool.title && { title: tool.title }),
            description: tool.description ?? '',
            inputSchema: tool.inputSchema as Record<string, unknown>,
            annotations: {
              ...(tool.annotations?.readOnlyHint !== undefined && {
                readOnlyHint: tool.annotations.readOnlyHint,
              }),
              ...(tool.annotations?.destructiveHint !== undefined && {
                destructiveHint: tool.annotations.destructiveHint,
              }),
              ...(tool.annotations?.idempotentHint !== undefined && {
                idempotentHint: tool.annotations.idempotentHint,
              }),
              ...(tool.annotations?.openWorldHint !== undefined && {
                openWorldHint: tool.annotations.openWorldHint,
              }),
            },
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
    }

    const resources: Discovery['resources'] = [];
    if (capabilities.resources) {
      const page = await client.listResources({}, { timeout: TIMEOUT_MS });
      for (const r of page.resources) {
        resources.push({
          uri: r.uri,
          name: r.name,
          ...(r.description && { description: r.description }),
          ...(r.mimeType && { mimeType: r.mimeType }),
        });
      }
    }

    return {
      server: {
        name: info?.name ?? 'unknown',
        version: info?.version ?? '',
        ...(info?.title && { title: info.title }),
        ...(client.getInstructions() && { instructions: client.getInstructions() }),
      },
      tools,
      resources,
    };
  });
}

/**
 * Calls one tool. Callers must have passed the policy check first (PRD §21: every tool call
 * goes through server-side policy validation). A tool-level failure comes back with
 * `isError: true` and is never reported as success (AC 22).
 */
export async function callTool(
  access: McpAccess,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return withMcpClient(access, async (client) => {
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: TIMEOUT_MS,
    });
    const content = Array.isArray(result.content)
      ? (result.content as { type: string; text?: string }[])
      : [];
    return {
      isError: result.isError === true,
      text: content.map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`)).join('\n'),
      content,
      ...(result.structuredContent !== undefined && {
        structuredContent: result.structuredContent,
      }),
    };
  });
}
