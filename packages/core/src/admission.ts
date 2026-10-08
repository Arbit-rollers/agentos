import { countRuns, type Database, type TenantContext } from '@agentos/db';
import { AppError } from './errors';
import { enforceRateLimit, type RateLimiter } from './rate-limit';

export type WorkspaceLimits = {
  /** New chat messages and tasks are refused (WORKSPACE_BUSY) while this many runs wait. */
  maxQueuedRuns?: number;
  /** At most this many runs execute at once; the rest wait their turn on the queue. */
  maxRunningRuns?: number;
  /** How long a run waits before it checks for a free slot again. */
  slotWaitMs?: number;
};

/**
 * Admission for work a person starts directly (chat, New Task): their rate limit and the
 * workspace's queue limit. Automated work (schedules, delegation, workflows) isn't refused;
 * it is only paced by `maxRunningRuns`.
 */
export async function admitNewWork(
  db: Database,
  deps: { rateLimiter?: RateLimiter; limits?: WorkspaceLimits },
  ctx: TenantContext,
): Promise<void> {
  await enforceRateLimit(deps.rateLimiter, 'runs', ctx.userId);
  const max = deps.limits?.maxQueuedRuns;
  if (max !== undefined && (await countRuns(db, ctx, ['queued'])) >= max) {
    throw new AppError('WORKSPACE_BUSY', 'Too much work is already queued in this workspace');
  }
}
