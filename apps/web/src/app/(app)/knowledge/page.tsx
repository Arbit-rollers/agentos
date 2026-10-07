import { BookOpen, Settings2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEmbeddingSetting } from '@agentos/core';
import { listAgents, listKnowledgeSources } from '@agentos/db';
import { Button, Card, EmptyState, PageHeader } from '@agentos/ui';
import { AddSourceDialog } from '@/components/knowledge/add-source-dialog';
import { SourceTable } from '@/components/knowledge/source-table';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('knowledge'))('title') };
}

/** Knowledge (PRD §11): sources, their scope and indexing status. */
export default async function KnowledgePage() {
  const { ctx } = await requireSession();
  const db = getServices().db;
  const t = await getTranslations();
  const [sources, agents, embedding] = await Promise.all([
    listKnowledgeSources(db, ctx),
    listAgents(db, ctx, { statuses: ['draft', 'configured', 'active', 'paused'] }),
    getEmbeddingSetting(db, ctx),
  ]);

  return (
    <>
      <PageHeader
        title={t('knowledge.title')}
        description={t('knowledge.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href="/settings/knowledge">
                <Settings2 aria-hidden />
                {t('embedding.title')}
              </Link>
            </Button>
            <AddSourceDialog agents={agents.map((a) => ({ id: a.id, name: a.name }))} />
          </div>
        }
      />
      {!embedding && (
        <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
          {t('embedding.none')}{' '}
          <Link href="/settings/knowledge" className="text-primary hover:underline">
            {t('embedding.title')}
          </Link>
        </p>
      )}
      {sources.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen />}
            title={t('knowledge.empty')}
            description={t('knowledge.emptyHint')}
          />
        </Card>
      ) : (
        <Card className="p-2">
          <SourceTable sources={sources} />
        </Card>
      )}
    </>
  );
}
