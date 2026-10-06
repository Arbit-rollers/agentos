/**
 * Provider failures, classified so the gateway can decide whether to fall back (PRD §7.2 C).
 * Messages never include request bodies or credentials.
 */
export type ProviderErrorKind =
  'auth' | 'rate_limit' | 'timeout' | 'unavailable' | 'bad_request' | 'not_found' | 'unknown';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Outages, rate limits and timeouts trigger a fallback; configuration errors don't. */
export const FALLBACK_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  'rate_limit',
  'timeout',
  'unavailable',
]);

export function errorKindForStatus(status: number | undefined): ProviderErrorKind {
  if (status === undefined) return 'unavailable';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'unavailable';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}
