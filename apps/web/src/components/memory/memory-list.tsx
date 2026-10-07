import { Brain } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { toTsquery } from '@agentos/core';
import { listMemories, type TenantContext } from '@agentos/db';
import { EmptyState } from '@agentos/ui';
import { getServices } from '@/server/services';
import { MemoryItem, type MemoryView } from './memory-item';
import type { MemoryFilter } from './filters';

/** Loads the caller's memories for a filter (never suggested ones) and the tab counts. */
export async function loadMemories(
  ctx: TenantContext,
  options: { filter?: MemoryFilter; q?: string; agentId?: string },
) {
  const db = getServices().db;
  const all = (
    await listMemories(db, ctx, {
      agentId: options.agentId,
      tsquery: options.q ? toTsquery(options.q) || undefined : undefined,
      limit: 500,
    })
  ).filter((m) => m.status !== 'suggested');
  const counts: Record<MemoryFilter, number> = {
    all: all.filter((m) => m.status === 'active').length,
    procedural: all.filter((m) => m.status === 'active' && m.type === 'procedural').length,
    semantic: all.filter((m) => m.status === 'active' && m.type === 'semantic').length,
    episodic: all.filter((m) => m.status === 'active' && m.type === 'episodic').length,
    disabled: all.filter((m) => m.status === 'disabled').length,
  };
  const filter = options.filter ?? 'all';
  const shown = all.filter((m) =>
    filter === 'disabled'
      ? m.status === 'disabled'
      : m.status === 'active' && (filter === 'all' || m.type === filter),
  );
  return { memories: shown, counts };
}

export async function MemoryList({
  memories,
}: {
  memories: Awaited<ReturnType<typeof loadMemories>>['memories'];
}) {
  const t = await getTranslations('memoryPage');
  const format = await getFormatter();
  const now = new Date();
  if (memories.length === 0)
    return <EmptyState icon={<Brain />} title={t('empty')} description={t('emptyHint')} />;
  return (
    <ul className="divide-y divide-border" aria-label={t('title')}>
      {memories.map((m) => {
        const view: MemoryView = {
          id: m.id,
          type: m.type,
          content: m.content,
          pinned: m.pinned,
          status: m.status,
          agentId: m.agentId,
          agentName: m.agentName,
          provenance: m.provenance as MemoryView['provenance'],
          lastUsed: m.lastUsedAt ? format.relativeTime(m.lastUsedAt, now) : null,
        };
        return <MemoryItem key={m.id} memory={view} />;
      })}
    </ul>
  );
}
