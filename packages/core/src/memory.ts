import {
  deleteMemory as deleteMemoryRow,
  findAgent,
  findMemory,
  insertMemory,
  updateMemory as updateMemoryRow,
  type Database,
  type Memory,
  type MemoryType,
  type TenantContext,
} from '@agentos/db';
import { z } from 'zod';
import { recordAudit } from './audit';
import { parse } from './auth';
import { AppError } from './errors';
import { workspaceEmbedder } from './knowledge';
import type { ProviderDeps } from './providers';

const MAX_MEMORY_CHARS = 2_000;

/** Best effort: a memory without a vector is still found by keyword. */
async function embedMemory(db: Database, deps: ProviderDeps, ctx: TenantContext, content: string) {
  try {
    const embedder = await workspaceEmbedder(db, deps, ctx);
    if (!embedder) return {};
    const [embedding] = await embedder.embed([content], 'document');
    return { embedding: embedding!, embeddingModel: embedder.key };
  } catch {
    return {};
  }
}

const audit = (
  db: Database,
  ctx: TenantContext,
  action: string,
  memory: Memory,
  metadata: Record<string, unknown> = {},
) =>
  recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: memory.agentId,
    action,
    targetType: 'memory',
    targetId: memory.id,
    outcome: 'success',
    metadata: { type: memory.type, ...metadata },
  });

const memorySchema = z.object({
  type: z.enum(['episodic', 'semantic', 'procedural']),
  content: z
    .string()
    .trim()
    .min(1, { error: 'memory_required' })
    .max(MAX_MEMORY_CHARS, { error: 'memory_too_long' }),
  agentId: z.uuid().nullable().optional(),
  pinned: z.boolean().optional(),
});

export type MemoryInput = z.input<typeof memorySchema>;

/** Memory → Add (PRD §12). */
export async function createMemory(
  db: Database,
  deps: ProviderDeps,
  ctx: TenantContext,
  input: MemoryInput,
  provenance: Record<string, unknown> = { kind: 'manual' },
  status: Memory['status'] = 'active',
): Promise<Memory> {
  const data = parse(memorySchema, input);
  if (data.agentId && !(await findAgent(db, ctx, data.agentId)))
    throw new AppError('VALIDATION', 'Unknown agent', { agentId: ['agent_required'] });
  const memory = await insertMemory(db, ctx, {
    agentId: data.agentId ?? null,
    type: data.type,
    content: data.content,
    provenance,
    pinned: data.pinned ?? false,
    status,
    ...(await embedMemory(db, deps, ctx, data.content)),
  });
  await audit(db, ctx, status === 'suggested' ? 'memory.suggested' : 'memory.created', memory, {
    provenance: provenance.kind,
  });
  return memory;
}

async function requireMemory(db: Database, ctx: TenantContext, id: string) {
  const memory = await findMemory(db, ctx, id);
  if (!memory) throw new AppError('NOT_FOUND', 'Memory not found');
  return memory;
}

/** Memory → Edit. Content changes are re-embedded and audited with before/after. */
export async function editMemory(
  db: Database,
  deps: ProviderDeps,
  ctx: TenantContext,
  id: string,
  input: { content?: string; type?: MemoryType },
): Promise<Memory> {
  const current = await requireMemory(db, ctx, id);
  const data = parse(memorySchema.pick({ content: true, type: true }), {
    content: input.content ?? current.content,
    type: input.type ?? current.type,
  });
  if (data.content === current.content && data.type === current.type) return current;
  const updated = (await updateMemoryRow(db, ctx, id, {
    content: data.content,
    type: data.type,
    ...(data.content !== current.content && (await embedMemory(db, deps, ctx, data.content))),
  }))!;
  await audit(db, ctx, 'memory.edited', updated, {
    before: { type: current.type, content: current.content },
    after: { type: updated.type, content: updated.content },
  });
  return updated;
}

/** Memory → Pin / Disable / Enable. A suggested memory changes only through feedback. */
export async function setMemoryFlags(
  db: Database,
  ctx: TenantContext,
  id: string,
  flags: { pinned?: boolean; enabled?: boolean },
): Promise<Memory> {
  const current = await requireMemory(db, ctx, id);
  if (current.status === 'suggested')
    throw new AppError('INVALID_TRANSITION', 'Accept or dismiss the suggestion first');
  const updated = (await updateMemoryRow(db, ctx, id, {
    ...(flags.pinned !== undefined && { pinned: flags.pinned }),
    ...(flags.enabled !== undefined && { status: flags.enabled ? 'active' : 'disabled' }),
  }))!;
  if (flags.pinned !== undefined && flags.pinned !== current.pinned)
    await audit(db, ctx, flags.pinned ? 'memory.pinned' : 'memory.unpinned', updated);
  if (updated.status !== current.status)
    await audit(
      db,
      ctx,
      updated.status === 'active' ? 'memory.enabled' : 'memory.disabled',
      updated,
    );
  return updated;
}

/** Memory → Delete. Hard delete; the audit log keeps only type and provenance, not content. */
export async function deleteMemory(db: Database, ctx: TenantContext, id: string): Promise<void> {
  const memory = await requireMemory(db, ctx, id);
  await deleteMemoryRow(db, ctx, id);
  await audit(db, ctx, 'memory.deleted', memory, { provenance: memory.provenance.kind });
}

const EPISODE_OUTPUT_CHARS = 400;

/**
 * Episodic memory (PRD §12): one line per finished manual or scheduled task — what was asked
 * and how it ended. Chat turns are not recorded (the conversation already holds them).
 */
export async function recordTaskEpisode(
  db: Database,
  deps: ProviderDeps,
  ctx: TenantContext,
  task: {
    id: string;
    agentId: string;
    objective: string;
    origin: string;
    output: string | null;
    error: string | null;
  },
  runId: string | null,
  outcome: 'completed' | 'failed',
): Promise<Memory | null> {
  if (task.origin === 'chat') return null;
  const output = (task.output ?? '').replace(/\s+/g, ' ').trim();
  const content =
    outcome === 'completed'
      ? `Task "${task.objective}" completed.${output ? ` Result: ${output.length > EPISODE_OUTPUT_CHARS ? `${output.slice(0, EPISODE_OUTPUT_CHARS)}…` : output}` : ''}`
      : `Task "${task.objective}" failed (${task.error ?? 'unknown error'}).`;
  return insertMemory(db, ctx, {
    agentId: task.agentId,
    type: 'episodic',
    content,
    provenance: { kind: 'run', taskId: task.id, runId },
    confidence: outcome === 'completed' ? 0.8 : 0.6,
    ...(await embedMemory(db, deps, ctx, content)),
  });
}
