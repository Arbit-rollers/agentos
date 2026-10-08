import type { ModelTarget } from './router';

/**
 * Remembers which models keep failing so calls stop waiting on them (circuit breaker).
 * After `threshold` consecutive outages, rate limits or timeouts, a model is "open" for
 * `cooldownMs`: the gateway tries its other candidates first. After the cooldown the next call
 * probes it again; one more failure reopens it straight away, a success closes it.
 */
export type ModelHealth = {
  isOpen(target: ModelTarget): boolean;
  recordSuccess(target: ModelTarget): void;
  recordFailure(target: ModelTarget): void;
};

/** The same breaker over plain string keys (e.g. an MCP connection id). */
export type KeyedBreaker = {
  isOpen(key: string): boolean;
  recordSuccess(key: string): void;
  recordFailure(key: string): void;
};

export function createKeyedBreaker(
  options: { threshold?: number; cooldownMs?: number; now?: () => number } = {},
): KeyedBreaker {
  const threshold = options.threshold ?? 3;
  const cooldownMs = options.cooldownMs ?? 60_000;
  const now = options.now ?? Date.now;
  const state = new Map<string, { failures: number; openUntil: number }>();
  return {
    isOpen: (key) => (state.get(key)?.openUntil ?? 0) > now(),
    recordSuccess: (key) => {
      state.delete(key);
    },
    recordFailure: (key) => {
      const entry = state.get(key) ?? { failures: 0, openUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= threshold) entry.openUntil = now() + cooldownMs;
      state.set(key, entry);
    },
  };
}

export function createCircuitBreaker(
  options: { threshold?: number; cooldownMs?: number; now?: () => number } = {},
): ModelHealth {
  const breaker = createKeyedBreaker(options);
  const key = (t: ModelTarget) => `${t.connectionId}\u0000${t.model}`;
  return {
    isOpen: (target) => breaker.isOpen(key(target)),
    recordSuccess: (target) => breaker.recordSuccess(key(target)),
    recordFailure: (target) => breaker.recordFailure(key(target)),
  };
}
