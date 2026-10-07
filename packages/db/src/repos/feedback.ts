import { desc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../client';
import { feedbackEvents } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type FeedbackEvent = typeof feedbackEvents.$inferSelect;
export type FeedbackAction = FeedbackEvent['action'];
export type { FeedbackSuggestion } from '../schema/index';

export async function insertFeedbackEvent(
  db: Executor,
  ctx: TenantContext,
  values: Pick<
    FeedbackEvent,
    | 'agentId'
    | 'messageId'
    | 'runId'
    | 'taskId'
    | 'action'
    | 'comment'
    | 'promotionState'
    | 'suggestions'
  >,
): Promise<FeedbackEvent> {
  const [row] = await db
    .insert(feedbackEvents)
    .values({ ...values, workspaceId: ctx.workspaceId, userId: ctx.userId })
    .returning();
  return row!;
}

export async function findFeedbackEvent(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<FeedbackEvent | undefined> {
  const [row] = await db
    .select()
    .from(feedbackEvents)
    .where(tenantScope(ctx, feedbackEvents, eq(feedbackEvents.id, id)))
    .limit(1);
  return row;
}

export async function listFeedbackEvents(
  db: Executor,
  ctx: TenantContext,
  filter: { agentId?: string; messageIds?: string[]; pendingOnly?: boolean; limit?: number } = {},
): Promise<FeedbackEvent[]> {
  if (filter.messageIds && filter.messageIds.length === 0) return [];
  return db
    .select()
    .from(feedbackEvents)
    .where(
      tenantScope(
        ctx,
        feedbackEvents,
        filter.agentId ? eq(feedbackEvents.agentId, filter.agentId) : undefined,
        filter.messageIds ? inArray(feedbackEvents.messageId, filter.messageIds) : undefined,
        filter.pendingOnly ? eq(feedbackEvents.promotionState, 'suggested') : undefined,
      ),
    )
    .orderBy(desc(feedbackEvents.createdAt))
    .limit(filter.limit ?? 100);
}

export async function updateFeedbackEvent(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<FeedbackEvent, 'promotionState' | 'suggestions' | 'decidedBy' | 'decidedAt'>
  >,
): Promise<FeedbackEvent | undefined> {
  const [row] = await db
    .update(feedbackEvents)
    .set(values)
    .where(tenantScope(ctx, feedbackEvents, eq(feedbackEvents.id, id)))
    .returning();
  return row;
}
