import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';
import { REDACTED, redact } from './redact';

describe('redact', () => {
  it('replaces values under sensitive keys at any depth', () => {
    expect(
      redact({
        user: 'a@b.c',
        password: 'hunter22',
        provider: { apiKey: 'x', api_key: 'y', headers: { Authorization: 'Bearer abc' } },
        list: [{ token: 't' }],
      }),
    ).toEqual({
      user: 'a@b.c',
      password: REDACTED,
      provider: { apiKey: REDACTED, api_key: REDACTED, headers: { Authorization: REDACTED } },
      list: [{ token: REDACTED }],
    });
  });

  it('masks credential-shaped strings under innocent keys', () => {
    const out = redact({
      note: 'key is sk-proj-abcdefghijklmnop1234 ok',
      header: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
      gh: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    });
    expect(JSON.stringify(out)).not.toMatch(/sk-proj|eyJhbG|ghp_/);
  });

  it('handles errors, buffers and cycles', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ name: 'loop', self: '[Circular]' });
    expect(redact(Buffer.from('secret'))).toBe(REDACTED);
    expect(redact(new Error('failed with sk-abcdefghijklmnopqrstu'))).toEqual({
      name: 'Error',
      message: `failed with ${REDACTED}`,
    });
  });
});

describe('createLogger', () => {
  it('writes redacted JSON lines', () => {
    const lines: string[] = [];
    const log = createLogger({ service: 'test' }, (line) => lines.push(line)).child({ run: 1 });
    log.info('calling provider', { apiKey: 'sk-abcdefghijklmnopqrstu', model: 'm' });
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: 'info', service: 'test', run: 1, model: 'm' });
    expect(entry.apiKey).toBe(REDACTED);
    expect(lines[0]).not.toContain('sk-abc');
  });
});
