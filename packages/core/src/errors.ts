export type AppErrorCode =
  | 'VALIDATION'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'MODEL_REQUIRED'
  | 'PROVIDER_IN_USE'
  | 'MODEL_CALL_FAILED'
  | 'MCP_UNAVAILABLE'
  /** A per-user MCP connection the person has not connected their own account to yet. */
  | 'MCP_NEEDS_USER_AUTH'
  | 'TOOL_BLOCKED'
  | 'APPROVAL_REQUIRED'
  | 'AGENT_NOT_RUNNABLE'
  | 'ALREADY_DECIDED'
  /** The caller's workspace role doesn't allow this (e.g. a member managing members). */
  | 'FORBIDDEN'
  /** Too many attempts in a short time; details.retryAfterSeconds says when to try again. */
  | 'RATE_LIMITED'
  /** The workspace already has too much work queued; new work waits until some finishes. */
  | 'WORKSPACE_BUSY';

/** Expected, user-facing failures. Anything else is a bug and should surface as a 500. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
