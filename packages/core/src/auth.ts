import { createHash, randomBytes } from 'node:crypto';
import {
  createWorkspaceWithOwner,
  deleteSession,
  extendSession,
  findActiveSession,
  findDefaultWorkspaceForUser,
  findMembership,
  findUserByEmail,
  findUserById,
  insertSession,
  insertUser,
  withTransaction,
  type Database,
  type TenantContext,
  type User,
  type Workspace,
  type WorkspaceRole,
} from '@agentos/db';
import { locales, type Locale } from '@agentos/i18n';
import { z } from 'zod';
import { recordAudit } from './audit';
import { AppError } from './errors';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions are extended on use once less than half of their lifetime remains. */
const SESSION_RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;

export { locales as SUPPORTED_LOCALES, type Locale } from '@agentos/i18n';

// Validation messages are stable codes; the UI translates them (PRD §33).
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'invalid_email' }));

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'name_required' })
  .max(80, { error: 'name_too_long' });

export const localeSchema = z.enum(locales, { error: 'invalid_locale' });

const registerSchema = z.object({
  displayName: displayNameSchema,
  email,
  password: z
    .string()
    .min(10, { error: 'password_too_short' })
    .max(256, { error: 'password_too_long' }),
  locale: localeSchema.catch('en'),
});

const loginSchema = z.object({ email, password: z.string().min(1).max(256) });

export type SessionToken = { token: string; expiresAt: Date };

export type AuthenticatedSession = {
  ctx: TenantContext;
  user: Pick<User, 'id' | 'email' | 'displayName'> & { locale: Locale };
  workspace: Pick<Workspace, 'id' | 'name'>;
  role: WorkspaceRole;
  /** Set when the session was extended; the caller should re-issue the cookie. */
  renewedExpiresAt?: Date;
};

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('VALIDATION', 'Invalid input', z.flattenError(result.error).fieldErrors);
  }
  return result.data;
}

/** The cookie carries the raw token; the database stores only its hash. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function startSession(db: Database, userId: string, workspaceId: string, now: Date) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await insertSession(db, { id: hashSessionToken(token), userId, workspaceId, expiresAt });
  return { token, expiresAt };
}

/**
 * Creates the user, their private default workspace and an owner membership atomically
 * (PRD §2), then signs them in.
 */
export async function register(
  db: Database,
  input: { displayName: unknown; email: unknown; password: unknown; locale?: unknown },
  now = new Date(),
): Promise<SessionToken> {
  const data = parse(registerSchema, input);
  if (await findUserByEmail(db, data.email)) {
    throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.');
  }
  const passwordHash = await hashPassword(data.password);

  const { user, workspace } = await withTransaction(db, async (tx) => {
    const user = await insertUser(tx, {
      displayName: data.displayName,
      email: data.email,
      passwordHash,
      locale: data.locale,
    });
    const workspace = await createWorkspaceWithOwner(tx, {
      ownerUserId: user.id,
      name: 'Personal',
    });
    const base = { workspaceId: workspace.id, actorUserId: user.id, outcome: 'success' } as const;
    await recordAudit(tx, {
      ...base,
      action: 'user.registered',
      targetType: 'user',
      targetId: user.id,
    });
    await recordAudit(tx, {
      ...base,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: workspace.id,
    });
    return { user, workspace };
  }).catch((error: unknown) => {
    // Lost a race with a concurrent registration for the same email.
    if (isUniqueViolation(error)) {
      throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw error;
  });

  return startSession(db, user.id, workspace.id, now);
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as { code?: string })?.code === '23505' || cause?.code === '23505';
}

export async function login(
  db: Database,
  input: { email: unknown; password: unknown },
  now = new Date(),
): Promise<SessionToken> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.');
  const { email, password } = parsed.data;

  const user = await findUserByEmail(db, email);
  if (!user?.passwordHash) {
    await verifyAgainstDummy(password);
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.');
  }

  const workspace = await findDefaultWorkspaceForUser(db, user.id);
  const valid = await verifyPassword(user.passwordHash, password);
  const audit = {
    workspaceId: workspace?.id ?? null,
    actorUserId: user.id,
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
  };

  if (!valid) {
    await recordAudit(db, { ...audit, outcome: 'failure', metadata: { reason: 'bad_password' } });
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  if (user.status !== 'active' || !workspace) {
    await recordAudit(db, {
      ...audit,
      outcome: 'denied',
      metadata: { reason: 'account_disabled' },
    });
    throw new AppError('ACCOUNT_DISABLED', 'This account is disabled.');
  }

  await recordAudit(db, { ...audit, outcome: 'success' });
  return startSession(db, user.id, workspace.id, now);
}

/**
 * Resolves a session token to a TenantContext. Re-checks the user's status and workspace
 * membership on every request, so removing either takes effect immediately.
 */
export async function authenticate(
  db: Database,
  token: string | undefined,
  now = new Date(),
): Promise<AuthenticatedSession | null> {
  if (!token) return null;
  const sessionId = hashSessionToken(token);
  const session = await findActiveSession(db, sessionId, now);
  if (!session) return null;

  const [user, membership] = await Promise.all([
    findUserById(db, session.userId),
    findMembership(db, session.userId, session.workspaceId),
  ]);
  if (!user || user.status !== 'active' || !membership) {
    await deleteSession(db, sessionId);
    return null;
  }

  let renewedExpiresAt: Date | undefined;
  if (session.expiresAt.getTime() - now.getTime() < SESSION_RENEW_THRESHOLD_MS) {
    renewedExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await extendSession(db, sessionId, renewedExpiresAt);
  }

  return {
    ctx: { userId: user.id, workspaceId: membership.workspace.id },
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: localeSchema.catch('en').parse(user.locale),
    },
    workspace: { id: membership.workspace.id, name: membership.workspace.name },
    role: membership.role,
    ...(renewedExpiresAt && { renewedExpiresAt }),
  };
}

export async function logout(db: Database, token: string | undefined): Promise<void> {
  if (!token) return;
  const sessionId = hashSessionToken(token);
  const session = await findActiveSession(db, sessionId, new Date(0));
  await deleteSession(db, sessionId);
  if (session) {
    await recordAudit(db, {
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      action: 'auth.logout',
      targetType: 'user',
      targetId: session.userId,
      outcome: 'success',
    });
  }
}
