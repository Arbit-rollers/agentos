import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://agentos:agentos@localhost:5432/agentos',
  REDIS_URL: 'redis://localhost:6379',
  AGENTOS_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.OLLAMA_BASE_URL).toBe('http://localhost:11434');
  });

  it('accepts a 32-byte base64 master key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(loadEnv({ ...base, AGENTOS_MASTER_KEY: key }).AGENTOS_MASTER_KEY).toBe(key);
  });

  it('rejects a master key of the wrong length', () => {
    const key = Buffer.alloc(16, 7).toString('base64');
    expect(() => loadEnv({ ...base, AGENTOS_MASTER_KEY: key })).toThrow(/AGENTOS_MASTER_KEY/);
  });

  it('reports every missing required variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL[\s\S]*AGENTOS_MASTER_KEY/);
  });
});
