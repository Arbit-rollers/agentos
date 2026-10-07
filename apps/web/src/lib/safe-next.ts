/** A same-site path to continue to after signing in; anything else falls back to the dashboard. */
export function safeNext(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    value.length < 500
    ? value
    : '/dashboard';
}
