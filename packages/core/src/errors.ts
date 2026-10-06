export type AppErrorCode =
  | 'VALIDATION'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'MODEL_REQUIRED';

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
