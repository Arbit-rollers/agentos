import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';

export const MCP_TRANSPORTS = ['streamable_http', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const MCP_AUTH_TYPES = ['none', 'bearer', 'headers', 'oauth'] as const;
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number];

export type McpAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'headers'; headers: Record<string, string> }
  | { type: 'oauth'; provider: OAuthClientProvider };

/** What the gateway needs to reach a server. Credentials are resolved at the call site. */
export type McpAccess = { endpoint: string; transport: McpTransport; auth: McpAuth };

export type NormalizedTool = {
  name: string;
  title?: string;
  description: string;
  /** JSON Schema of the tool's arguments, as published by the server. */
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type DiscoveredResource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type Discovery = {
  server: { name: string; version: string; title?: string; instructions?: string };
  tools: NormalizedTool[];
  resources: DiscoveredResource[];
};

export type ToolResult = {
  isError: boolean;
  /** Text content joined; other content types are summarized by type. */
  text: string;
  content: unknown[];
  structuredContent?: unknown;
};
