import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended parameters (19 MiB, 2 iterations, 1 lane).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real verification, so unknown emails can't be detected by timing. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('agentos-timing-equalizer');
  await verifyPassword(await dummyHash, password);
}
