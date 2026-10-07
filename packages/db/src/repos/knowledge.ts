import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Executor } from '../client';
import { agents, knowledgeChunks, knowledgeSources } from '../schema/index';
import { tenantScope, type TenantContext } from '../tenant';

export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type KnowledgeScope = KnowledgeSource['scope'];

/** User-scoped sources are private to their uploader; the rest are shared in the workspace. */
const visible = (ctx: TenantContext): SQL =>
  or(ne(knowledgeSources.scope, 'user'), eq(knowledgeSources.createdBy, ctx.userId))!;

export async function insertKnowledgeSource(
  db: Executor,
  ctx: TenantContext,
  values: Pick<
    KnowledgeSource,
    'scope' | 'agentId' | 'type' | 'name' | 'sourceRef' | 'mimeType' | 'sizeBytes' | 'content'
  >,
): Promise<KnowledgeSource> {
  const [row] = await db
    .insert(knowledgeSources)
    .values({ ...values, workspaceId: ctx.workspaceId, createdBy: ctx.userId })
    .returning();
  return row!;
}

export async function listKnowledgeSources(
  db: Executor,
  ctx: TenantContext,
  filter: { agentId?: string; scope?: KnowledgeScope } = {},
): Promise<(KnowledgeSource & { agentName: string | null })[]> {
  const rows = await db
    .select({ source: knowledgeSources, agentName: agents.name })
    .from(knowledgeSources)
    .leftJoin(agents, eq(agents.id, knowledgeSources.agentId))
    .where(
      tenantScope(
        ctx,
        knowledgeSources,
        visible(ctx),
        filter.agentId ? eq(knowledgeSources.agentId, filter.agentId) : undefined,
        filter.scope ? eq(knowledgeSources.scope, filter.scope) : undefined,
      ),
    )
    .orderBy(desc(knowledgeSources.createdAt));
  return rows.map((r) => ({ ...r.source, agentName: r.agentName }));
}

export async function findKnowledgeSource(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<KnowledgeSource | undefined> {
  const [row] = await db
    .select()
    .from(knowledgeSources)
    .where(tenantScope(ctx, knowledgeSources, visible(ctx), eq(knowledgeSources.id, id)))
    .limit(1);
  return row;
}

export async function updateKnowledgeSource(
  db: Executor,
  ctx: TenantContext,
  id: string,
  values: Partial<
    Pick<
      KnowledgeSource,
      'status' | 'error' | 'chunkCount' | 'embeddingModel' | 'content' | 'metadata' | 'name'
    >
  >,
): Promise<KnowledgeSource | undefined> {
  const [row] = await db
    .update(knowledgeSources)
    .set({ ...values, updatedAt: new Date() })
    .where(tenantScope(ctx, knowledgeSources, visible(ctx), eq(knowledgeSources.id, id)))
    .returning();
  return row;
}

export async function deleteKnowledgeSource(
  db: Executor,
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(knowledgeSources)
    .where(tenantScope(ctx, knowledgeSources, visible(ctx), eq(knowledgeSources.id, id)))
    .returning({ id: knowledgeSources.id });
  return rows.length > 0;
}

/** Replaces a source's chunks (re-indexing is all or nothing). */
export async function replaceKnowledgeChunks(
  db: Executor,
  ctx: TenantContext,
  sourceId: string,
  chunks: { content: string; tokenCount: number; embedding: number[] | null }[],
): Promise<void> {
  await db
    .delete(knowledgeChunks)
    .where(tenantScope(ctx, knowledgeChunks, eq(knowledgeChunks.sourceId, sourceId)));
  for (let i = 0; i < chunks.length; i += 200) {
    await db.insert(knowledgeChunks).values(
      chunks.slice(i, i + 200).map((chunk, n) => ({
        ...chunk,
        workspaceId: ctx.workspaceId,
        sourceId,
        ordinal: i + n,
      })),
    );
  }
}

export async function listKnowledgeChunks(
  db: Executor,
  ctx: TenantContext,
  sourceId: string,
  limit = 50,
): Promise<Pick<KnowledgeChunk, 'id' | 'ordinal' | 'content' | 'tokenCount'>[]> {
  return db
    .select({
      id: knowledgeChunks.id,
      ordinal: knowledgeChunks.ordinal,
      content: knowledgeChunks.content,
      tokenCount: knowledgeChunks.tokenCount,
    })
    .from(knowledgeChunks)
    .where(tenantScope(ctx, knowledgeChunks, eq(knowledgeChunks.sourceId, sourceId)))
    .orderBy(asc(knowledgeChunks.ordinal))
    .limit(limit);
}

export type ChunkHit = {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  content: string;
  tokenCount: number;
  score: number;
};

/**
 * Sources a run may read: workspace-wide, this agent's, and the run owner's private ones.
 * Never another user's private sources (PRD §12).
 */
const readableBy = (ctx: TenantContext, agentId: string | null): SQL =>
  and(
    eq(knowledgeSources.status, 'ready'),
    or(
      eq(knowledgeSources.scope, 'workspace'),
      agentId
        ? and(eq(knowledgeSources.scope, 'agent'), eq(knowledgeSources.agentId, agentId))
        : undefined,
      and(eq(knowledgeSources.scope, 'user'), eq(knowledgeSources.createdBy, ctx.userId)),
    ),
  )!;

const hitColumns = {
  chunkId: knowledgeChunks.id,
  sourceId: knowledgeSources.id,
  sourceName: knowledgeSources.name,
  content: knowledgeChunks.content,
  tokenCount: knowledgeChunks.tokenCount,
};

/** Nearest chunks by cosine distance, among chunks embedded with `embeddingModel`. */
export async function searchKnowledgeByVector(
  db: Executor,
  ctx: TenantContext,
  input: { agentId: string | null; embedding: number[]; embeddingModel: string; limit: number },
): Promise<ChunkHit[]> {
  const distance = cosineDistance(knowledgeChunks.embedding, input.embedding);
  const rows = await db
    .select({ ...hitColumns, distance })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
    .where(
      tenantScope(
        ctx,
        knowledgeChunks,
        readableBy(ctx, input.agentId),
        eq(knowledgeSources.embeddingModel, input.embeddingModel),
        isNotNull(knowledgeChunks.embedding),
      ),
    )
    .orderBy(distance)
    .limit(input.limit);
  return rows.map(({ distance: d, ...hit }) => ({ ...hit, score: 1 - Number(d) }));
}

/** Keyword search (any of the words), ranked by ts_rank. Works without embeddings. */
export async function searchKnowledgeByText(
  db: Executor,
  ctx: TenantContext,
  input: { agentId: string | null; tsquery: string; limit: number },
): Promise<ChunkHit[]> {
  if (!input.tsquery) return [];
  const query = sql`to_tsquery('simple', ${input.tsquery})`;
  const rank = sql<number>`ts_rank(${knowledgeChunks.search}, ${query})`;
  const rows = await db
    .select({ ...hitColumns, rank })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
    .where(
      tenantScope(
        ctx,
        knowledgeChunks,
        readableBy(ctx, input.agentId),
        sql`${knowledgeChunks.search} @@ ${query}`,
      ),
    )
    .orderBy(desc(rank))
    .limit(input.limit);
  return rows.map(({ rank: r, ...hit }) => ({ ...hit, score: Number(r) }));
}

/** Ready sources whose vectors don't match the workspace's current embedding model. */
export async function listSourcesNeedingReindex(
  db: Executor,
  ctx: TenantContext,
  embeddingModel: string | null,
): Promise<Pick<KnowledgeSource, 'id' | 'createdBy'>[]> {
  // Includes other members' private sources: re-indexing runs as each source's owner.
  return db
    .select({ id: knowledgeSources.id, createdBy: knowledgeSources.createdBy })
    .from(knowledgeSources)
    .where(
      tenantScope(
        ctx,
        knowledgeSources,
        eq(knowledgeSources.status, 'ready'),
        embeddingModel
          ? or(
              sql`${knowledgeSources.embeddingModel} is null`,
              ne(knowledgeSources.embeddingModel, embeddingModel),
            )
          : isNotNull(knowledgeSources.embeddingModel),
      ),
    );
}

/** Of `ids`, the sources that still exist and are ready. */
export async function filterReadySourceIds(
  db: Executor,
  ctx: TenantContext,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: knowledgeSources.id })
    .from(knowledgeSources)
    .where(
      tenantScope(
        ctx,
        knowledgeSources,
        eq(knowledgeSources.status, 'ready'),
        inArray(knowledgeSources.id, ids),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
