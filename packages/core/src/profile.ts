import { updateUserProfile, type Database, type TenantContext } from '@agentos/db';
import { z } from 'zod';
import { recordAudit } from './audit';
import { displayNameSchema, localeSchema, parse } from './auth';

const profileSchema = z.object({ displayName: displayNameSchema, locale: localeSchema });

/** Updates the signed-in user's own profile (Settings → Profile). */
export async function updateProfile(
  db: Database,
  ctx: TenantContext,
  input: { displayName: unknown; locale: unknown },
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
