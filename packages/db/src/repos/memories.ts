import {
  and,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Executor } from '../client';
import { agents, memories } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type Memory = typeof memories.$inferSelect;
export type MemoryType = Memory['type'];
export type MemoryStatus = Memory['status'];

/** Memory belongs to one user; nobody else can read or change it (PRD §12). */
const own = (ctx: TenantContext): SQL => eq(memories.userId, ctx.userId);

export async function insertMemory(
  db: Executor,
  ctx: TenantContext,
  values: Pick<Memory, 'agentId' | 'type' | 'content' | 'provenance'> &
    Partial<Pick<Memory, 'confidence' | 'pinned' | 'status' | 'embedding' | 'embeddingModel'>>,
): Promise<Memory> {
  const [row] = await db
    .insert(memories)
    .values({ ...values, workspaceId: ctx.workspaceId, userId: ctx.userId })
    .returning();
  return row!;
}

export type MemoryFilter = {
  agentId?: string;
  type?: MemoryType;
  status?: MemoryStatus;
  /** Keyword search (any of the words, already in to_tsquery form). */
  tsquery?: string;
  limit?: number;
};

export async function listMemories(
  db: Executor,
  ctx: TenantContext,
  filter: MemoryFilter = {},
): Promise<(Omit<Memory, 'embedding' | 'search'> & { agentName: string | null })[]> {
  const query = filter.tsquery ? sql`to_tsquery('simple', ${filter.tsquery})` : undefined;
  const rows = await db
    .select({
      id: memories.id,
      workspaceId: memories.workspaceId,
      userId: memories.userId,
      agentId: memories.agentId,
      type: memories.type,
      content: memories.content,
      provenance: memories.provenance,
      confidence: memories.confidence,
      pinned: memories.pinned,
      status: memories.status,
      embeddingModel: memories.embeddingModel,
      lastUsedAt: memories.lastUsedAt,
      createdAt: memories.createdAt,
      updatedAt: memories.updatedAt,
      agentName: agents.name,
    })
    .from(memories)
    .leftJoin(agents, eq(agents.id, memories.agentId))
    .where(
      tenantScope(
        ctx,
        memories,
        own(ctx),
        filter.agentId ? eq(memories.agentId, filter.agentId) : undefined,
        filter.type ? eq(memories.type, filter.type) : undefined,
        filter.status ? eq(memories.status, filter.status) : undefined,
        query ? sql`${memories.search} @@ ${query}` : undefined,
      ),
    )
    .orderBy(desc(memories.pinned), desc(memories.updatedAt))
    .limit(filter.limit ?? 200);
  return rows;
}

export async function findMemory(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<Memory | undefined> {
  const [row] = await db
    .select()
    .from(memories)
    .where(tenantScope(ctx, memories, own(ctx), eq(memories.id, id)))
    .limit(1);
  return row;
}

export async function updateMemory(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<
      Memory,
      'content' | 'type' | 'pinned' | 'status' | 'confidence' | 'embedding' | 'embeddingModel'
    >
  >,
): Promise<Memory | undefined> {
  const [row] = await db
    .update(memories)
    .set({ ...values, updatedAt: new Date() })
    .where(tenantScope(ctx, memories, own(ctx), eq(memories.id, id)))
    .returning();
  return row;
}

/** Hard delete: a deleted memory must never reach a later run (AC 21). */
export async function deleteMemory(db: Executor, ctx: TenantContext, id: string): Promise<boolean> {
  const rows = await db
    .delete(memories)
    .where(tenantScope(ctx, memories, own(ctx), eq(memories.id, id)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

export type MemoryHit = Pick<Memory, 'id' | 'type' | 'content' | 'pinned' | 'confidence'> & {
  score: number;
};

const hitColumns = {
  id: memories.id,
  type: memories.type,
  content: memories.content,
  pinned: memories.pinned,
  confidence: memories.confidence,
};

/** Active memories of this user that apply to the agent (its own or all-agent ones). */
const usableFor = (ctx: TenantContext, agentId: string): SQL =>
  and(
    own(ctx),
    eq(memories.status, 'active'),
    or(isNull(memories.agentId), eq(memories.agentId, agentId)),
  )!;

/** Pinned memories and operating rules (procedural) apply to every run. */
export async function listStandingMemories(
  db: Executor,
  ctx: TenantContext,
  agentId: string,
  limit: number,
): Promise<MemoryHit[]> {
  const rows = await db
    .select(hitColumns)
    .from(memories)
    .where(
      tenantScope(
        ctx,
        memories,
        usableFor(ctx, agentId),
        or(eq(memories.pinned, true), eq(memories.type, 'procedural')),
      ),
    )
    .orderBy(desc(memories.pinned), desc(memories.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, score: 1 }));
}

export async function searchMemoriesByVector(
  db: Executor,
  ctx: TenantContext,
  input: { agentId: string; embedding: number[]; embeddingModel: string; limit: number },
): Promise<MemoryHit[]> {
  const distance = cosineDistance(memories.embedding, input.embedding);
  const rows = await db
    .select({ ...hitColumns, distance })
    .from(memories)
    .where(
      tenantScope(
        ctx,
        memories,
        usableFor(ctx, input.agentId),
        eq(memories.embeddingModel, input.embeddingModel),
        isNotNull(memories.embedding),
      ),
    )
    .orderBy(distance)
    .limit(input.limit);
  return rows.map(({ distance: d, ...hit }) => ({ ...hit, score: 1 - Number(d) }));
}

export async function searchMemoriesByText(
  db: Executor,
  ctx: TenantContext,
  input: { agentId: string; tsquery: string; limit: number },
): Promise<MemoryHit[]> {
  if (!input.tsquery) return [];
  const query = sql`to_tsquery('simple', ${input.tsquery})`;
  const rank = sql<number>`ts_rank(${memories.search}, ${query})`;
  const rows = await db
    .select({ ...hitColumns, rank })
    .from(memories)
    .where(
      tenantScope(
        ctx,
        memories,
        usableFor(ctx, input.agentId),
        sql`${memories.search} @@ ${query}`,
      ),
    )
    .orderBy(desc(rank))
    .limit(input.limit);
  return rows.map(({ rank: r, ...hit }) => ({ ...hit, score: Number(r) }));
}

export async function touchMemories(db: Executor, ctx: TenantContext, ids: string[]) {
  if (ids.length === 0) return;
  await db
    .update(memories)
    .set({ lastUsedAt: new Date() })
    .where(tenantScope(ctx, memories, own(ctx), inArray(memories.id, ids)));
}

/**
 * Memories in the workspace whose vectors don't match the embedding model (system-level:
 * the worker re-embeds each one as its owner).
 */
export async function listMemoriesNeedingEmbedding(
  db: Executor,
  workspaceId: string,
  embeddingModel: string,
  limit = 500,
): Promise<Pick<Memory, 'id' | 'userId' | 'content'>[]> {
  return db
    .select({ id: memories.id, userId: memories.userId, content: memories.content })
    .from(memories)
    .where(
      and(
        eq(memories.workspaceId, workspaceId),
        or(isNull(memories.embeddingModel), sql`${memories.embeddingModel} <> ${embeddingModel}`),
      ),
    )
    .limit(limit);
}

/** Of `ids`, the memories that are still active (a run re-checks before each model call). */
export async function filterActiveMemoryIds(
  db: Executor,
  ctx: TenantContext,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      tenantScope(
        ctx,
        memories,
        own(ctx),
        eq(memories.status, 'active'),
        inArray(memories.id, ids),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
