export type McpErrorKind = 'auth' | 'unavailable' | 'timeout' | 'protocol' | 'tool_not_found';

/** Classified MCP failure. Messages carry no credentials or server payloads. */
export class McpGatewayError extends Error {
  constructor(
    readonly kind: McpErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'McpGatewayError';
  }
}
