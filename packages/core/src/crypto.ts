import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type EncryptedPayload = { keyVersion: string; wrappedDek: Buffer; ciphertext: Buffer };

/** Packs iv | tag | ciphertext into one buffer. */
function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/**
 * AES-256-GCM envelope encryption (PRD §21, §29). Every secret gets a fresh data key (DEK);
 * the DEK is wrapped with the master key. `context` (e.g. workspace id + kind) is bound as
 * associated data, so a ciphertext copied to another workspace or purpose fails to decrypt.
 */
export function createSecretCipher(masterKeyBase64: string, keyVersion = 'v1') {
  const masterKey = Buffer.from(masterKeyBase64, 'base64');
  if (masterKey.length !== 32) throw new Error('Master key must be 32 bytes');

  return {
    encrypt(plaintext: string, context: string): EncryptedPayload {
      const aad = Buffer.from(context, 'utf8');
      const dek = randomBytes(32);
      try {
        return {
          keyVersion,
          wrappedDek: seal(masterKey, dek, aad),
          ciphertext: seal(dek, Buffer.from(plaintext, 'utf8'), aad),
        };
      } finally {
        dek.fill(0);
      }
    },

    decrypt(payload: EncryptedPayload, context: string): string {
      if (payload.keyVersion !== keyVersion) {
        throw new Error(`Unknown secret key version: ${payload.keyVersion}`);
      }
      const aad = Buffer.from(context, 'utf8');
      const dek = open(masterKey, payload.wrappedDek, aad);
      try {
        return open(dek, payload.ciphertext, aad).toString('utf8');
      } finally {
        dek.fill(0);
      }
    },
  };
}

export type SecretCipher = ReturnType<typeof createSecretCipher>;
