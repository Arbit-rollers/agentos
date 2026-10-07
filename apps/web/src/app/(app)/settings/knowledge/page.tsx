import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEmbeddingSetting, suggestedEmbeddingModel } from '@agentos/core';
import { listProviderConnections } from '@agentos/db';
import { Card, CardContent, CardHeader, CardTitle } from '@agentos/ui';
import { EmbeddingForm } from '@/components/settings/embedding-form';
import { AdminOnlyNote } from '@/components/admin-only-note';
import { isAdmin } from '@/server/permissions';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('embedding'))('title') };
}

/** Settings → Knowledge (PRD §29: embeddings through the Model Gateway). */
export default async function KnowledgeSettingsPage() {
  const session = await requireSession();
  const { ctx } = session;
  const db = getServices().db;
  const t = await getTranslations('embedding');
  const [connections, current] = await Promise.all([
    listProviderConnections(db, ctx),
    getEmbeddingSetting(db, ctx),
  ]);
  // Anthropic has no embeddings API.
  const providers = connections
    .filter((c) => c.provider !== 'anthropic')
    .map((c) => ({ id: c.id, name: c.name, suggestedModel: suggestedEmbeddingModel(c.provider) }));
  const currentName = current && connections.find((c) => c.id === current.connectionId)?.name;

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" data-testid="embedding-status">
          {current && currentName
            ? t('current', { provider: currentName, model: current.model })
            : t('none')}
        </p>
        {!isAdmin(session) ? (
          <AdminOnlyNote />
        ) : providers.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t('noProviders')}{' '}
            <Link href="/settings/providers" className="text-primary hover:underline">
              →
            </Link>
          </p>
        ) : (
          <EmbeddingForm providers={providers} current={currentName ? current : null} />
        )}
      </CardContent>
    </Card>
  );
}
