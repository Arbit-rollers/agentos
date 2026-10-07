import { findUserById, updateUserProfile, type Database, type TenantContext } from '@agentos/db';
import { z } from 'zod';
import { recordAudit } from './audit';
import { displayNameSchema, localeSchema, parse } from './auth';
import { isValidTimezone } from './time';

const profileSchema = z.object({
  displayName: displayNameSchema,
  locale: localeSchema,
  timezone: z.string().refine(isValidTimezone, { error: 'invalid_timezone' }).optional(),
});

/** Updates the signed-in user's own profile (Settings → Profile). */
export async function updateProfile(
  db: Database,
  ctx: TenantContext,
  input: { displayName: unknown; locale: unknown; timezone?: unknown },
): Promise<void> {
  const data = parse(profileSchema, input);
  await updateUserProfile(db, ctx.userId, data);
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: 'user.profile_updated',
    targetType: 'user',
    targetId: ctx.userId,
    outcome: 'success',
    metadata: { fields: Object.keys(data) },
  });
}

/**
 * Saves the browser's timezone the first time a person uses the app, so agents know their
 * "today". An explicit choice in Settings → Profile is never overwritten.
 */
export async function rememberDetectedTimezone(db: Database, ctx: TenantContext, timezone: string) {
  if (!isValidTimezone(timezone)) return;
  const user = await findUserById(db, ctx.userId);
  if (!user || user.timezone) return;
  await updateUserProfile(db, ctx.userId, { timezone });
}
