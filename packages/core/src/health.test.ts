import { describe, expect, it } from 'vitest';
import { checkHealth } from './health';

describe('checkHealth', () => {
  it('is ok when every component succeeds', async () => {
    const report = await checkHealth({ db: async () => {}, redis: async () => 'PONG' });
    expect(report).toEqual({ ok: true, components: { db: { ok: true }, redis: { ok: true } } });
  });

  it('reports the failing component without throwing', async () => {
    const report = await checkHealth({
      db: async () => {},
      redis: async () => {
        throw new Error('connection refused');
      },
    });
    expect(report.ok).toBe(false);
    expect(report.components.redis).toEqual({ ok: false, error: 'connection refused' });
    expect(report.components.db).toEqual({ ok: true });
  });
});

describe('checkHealth timeouts', () => {
  it('reports a hanging component as failed', async () => {
    const report = await checkHealth(
      { redis: () => new Promise(() => {}), db: async () => {} },
      { timeoutMs: 20 },
    );
    expect(report.ok).toBe(false);
    expect(report.components.redis).toEqual({ ok: false, error: 'timed out after 20ms' });
  });
});
