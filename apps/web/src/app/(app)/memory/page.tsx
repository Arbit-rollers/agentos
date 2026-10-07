import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listAgents, listFeedbackEvents } from '@agentos/db';
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from '@agentos/ui';
import { AddMemoryDialog } from '@/components/memory/add-memory-dialog';
import { MEMORY_FILTERS, type MemoryFilter } from '@/components/memory/filters';
import { MemoryFilters } from '@/components/memory/memory-filters';
import { MemoryList, loadMemories } from '@/components/memory/memory-list';
import { SuggestionItems } from '@/components/memory/suggestion-list';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('memoryPage'))('title') };
}

type Params = { searchParams: Promise<{ type?: string; q?: string }> };

/** Memory (PRD §12): inspect, search, edit, pin, disable and delete; feedback suggestions. */
export default async function MemoryPage({ searchParams }: Params) {
  const query = await searchParams;
  const filter = MEMORY_FILTERS.includes(query.type as MemoryFilter)
    ? (query.type as MemoryFilter)
    : 'all';
  const { ctx } = await requireSession();
  const db = getServices().db;
  const t = await getTranslations('memoryPage');
  const [{ memories, counts }, agents, pending] = await Promise.all([
    loadMemories(ctx, { filter, q: query.q }),
    listAgents(db, ctx, { statuses: ['draft', 'configured', 'active', 'paused'] }),
    listFeedbackEvents(db, ctx, { pendingOnly: true }),
  ]);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  // Suggestions belong to the person who gave the feedback.
  const mine = pending.filter((event) => event.userId === ctx.userId);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={<AddMemoryDialog agents={agents.map((a) => ({ id: a.id, name: a.name }))} />}
      />
      {mine.length > 0 && (
        <Card className="mb-4" aria-label={t('suggestions')}>
          <CardHeader className="flex-col items-start gap-1">
            <CardTitle>{t('suggestions')}</CardTitle>
            <p className="text-sm text-text-muted">{t('suggestionsHint')}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {mine.map((event) => (
              <div
                key={event.id}
                className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0"
              >
                <p className="text-xs text-text-muted">
                  {t('feedbackOn', { agent: agentName.get(event.agentId) ?? '—' })}
                  {event.comment && <> · “{event.comment}”</>}
                </p>
                <SuggestionItems feedbackId={event.id} suggestions={event.suggestions} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <MemoryFilters counts={counts} />
      <Card>
        <CardContent className="pt-2">
          <MemoryList memories={memories} />
        </CardContent>
      </Card>
    </>
  );
}
