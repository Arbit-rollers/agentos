import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listRunsWithDetails, type Run } from '@agentos/db';
import { Card, CardContent, PageHeader } from '@agentos/ui';
import { QueryTabs } from '@/components/common/query-tabs';
import { RunLog } from '@/components/runs/run-log';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const STATUSES = ['completed', 'waiting_approval', 'waiting_agents', 'failed'] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('logs'))('title') };
}

/** Logs (PRD §22): every run with its routing, tool calls and decisions. */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { ctx } = await requireSession();
  const t = await getTranslations();
  const requested = (await searchParams).status;
  const status = STATUSES.includes(requested as (typeof STATUSES)[number])
    ? (requested as Run['status'])
    : undefined;
  const runs = await listRunsWithDetails(getServices().db, ctx, {
    ...(status && { status }),
    limit: 50,
  });

  return (
    <>
      <PageHeader title={t('logs.title')} description={t('logs.subtitle')} />
      <div className="mb-5">
        <QueryTabs
          param="status"
          value={status ?? 'all'}
          label={t('logs.filtersLabel')}
          tabs={[
            { value: 'all', label: t('logs.all') },
            ...STATUSES.map((s) => ({ value: s, label: t(`runs.status.${s}`) })),
          ]}
        />
      </div>
      <Card>
        <CardContent className="pt-5">
          <RunLog runs={runs} showAgent />
        </CardContent>
      </Card>
    </>
  );
}
