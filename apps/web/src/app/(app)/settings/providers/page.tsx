import { Cpu } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listProviderConnections, type ProviderConnection } from '@agentos/db';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
  type StatusTone,
} from '@agentos/ui';
import { AddProviderForm } from '@/components/settings/add-provider-form';
import { ProviderActions } from '@/components/settings/provider-actions';
import { AdminOnlyNote } from '@/components/admin-only-note';
import { isAdmin } from '@/server/permissions';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('providers'))('title') };
}

const TONE: Record<ProviderConnection['status'], StatusTone> = {
  connected: 'success',
  error: 'danger',
  untested: 'neutral',
};

export default async function ProvidersPage() {
  const session = await requireSession();
  const { ctx } = session;
  const admin = isAdmin(session);
  const { db, env } = getServices();
  const connections = await listProviderConnections(db, ctx);
  const t = await getTranslations('providers');
  const format = await getFormatter();
  const now = new Date();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle>{t('title')}</CardTitle>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <EmptyState
              icon={<Cpu />}
              title={t('empty')}
              description={t('emptyHint')}
              className="py-6"
            />
          ) : (
            <ul className="divide-y divide-border">
              {connections.map((connection) => (
                <li
                  key={connection.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{connection.name}</p>
                      <StatusBadge tone={TONE[connection.status]}>
                        {t(`status.${connection.status}`)}
                      </StatusBadge>
                    </div>
                    <p className="text-sm text-text-muted">
                      {t(`kinds.${connection.provider}`)}
                      {connection.endpoint && ` · ${connection.endpoint}`}
                      {' · '}
                      {t('models', { count: connection.models.length })}
                      {' · '}
                      {connection.lastCheckedAt
                        ? t('lastChecked', {
                            time: format.relativeTime(connection.lastCheckedAt, now),
                          })
                        : t('neverChecked')}
                    </p>
                    {connection.status === 'error' && connection.lastError && (
                      <p className="text-sm text-danger">
                        {t(`errorCodes.${connection.lastError as 'unknown'}`)}
                      </p>
                    )}
                  </div>
                  {admin && <ProviderActions id={connection.id} name={connection.name} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {admin ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('add')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AddProviderForm ollamaDefault={env.OLLAMA_BASE_URL} />
          </CardContent>
        </Card>
      ) : (
        <AdminOnlyNote />
      )}
    </div>
  );
}
