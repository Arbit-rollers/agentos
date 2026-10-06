import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretCipher } from './crypto';

const key = () => randomBytes(32).toString('base64');

describe('createSecretCipher', () => {
  const cipher = createSecretCipher(key());

  it('round-trips a secret', () => {
    const payload = cipher.encrypt('sk-live-123', 'ws-1:provider:openai');
    expect(cipher.decrypt(payload, 'ws-1:provider:openai')).toBe('sk-live-123');
  });

  it('never stores the plaintext and uses a fresh data key each time', () => {
    const a = cipher.encrypt('sk-live-123', 'ctx');
    const b = cipher.encrypt('sk-live-123', 'ctx');
    expect(a.ciphertext.toString('utf8')).not.toContain('sk-live-123');
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it('fails to decrypt under a different context (e.g. another workspace)', () => {
    const payload = cipher.encrypt('sk-live-123', 'ws-1:provider:openai');
    expect(() => cipher.decrypt(payload, 'ws-2:provider:openai')).toThrow();
  });

  it('detects tampering', () => {
    const payload = cipher.encrypt('sk-live-123', 'ctx');
    const tampered = Buffer.from(payload.ciphertext);
    tampered[tampered.length - 1]! ^= 0xff;
    expect(() => cipher.decrypt({ ...payload, ciphertext: tampered }, 'ctx')).toThrow();
  });

  it('cannot be decrypted with another master key', () => {
    const payload = cipher.encrypt('sk-live-123', 'ctx');
    expect(() => createSecretCipher(key()).decrypt(payload, 'ctx')).toThrow();
  });

  it('rejects master keys that are not 32 bytes', () => {
    expect(() => createSecretCipher(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
