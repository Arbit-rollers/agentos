import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listApprovalRequests, listTasksByIds } from '@agentos/db';
import { Card, EmptyState, PageHeader } from '@agentos/ui';
import { toApprovalView } from '@/components/approvals/approval-view';
import { ApprovalCard } from '@/components/approvals/approval-card';
import { QueryTabs } from '@/components/common/query-tabs';
import { canManageItem } from '@/server/permissions';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('approvals'))('title') };
}

/** Approval Inbox (PRD §10). */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireSession();
  const { ctx } = session;
  const db = getServices().db;
  const t = await getTranslations('approvals');
  const view = (await searchParams).view === 'history' ? 'history' : 'pending';
  const all = await listApprovalRequests(db, ctx, { limit: 200 });
  const pending = all.filter((a) => a.status === 'pending');
  const shown = view === 'pending' ? pending : all.filter((a) => a.status !== 'pending');
  const owners = new Map(
    (
      await listTasksByIds(db, ctx, [
        ...new Set(shown.flatMap((a) => (a.taskId ? [a.taskId] : []))),
      ])
    ).map((task) => [task.id, task.createdBy]),
  );

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="mb-5">
        <QueryTabs
          param="view"
          value={view}
          label={t('title')}
          tabs={[
            { value: 'pending', label: t('pending'), count: pending.length },
            { value: 'history', label: t('history'), count: all.length - pending.length },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck />}
            title={view === 'pending' ? t('empty') : t('emptyHistory')}
          />
        </Card>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {shown.map((approval) => (
            <li key={approval.id}>
              <ApprovalCard
                approval={toApprovalView(approval)}
                canDecide={canManageItem(
                  session,
                  approval.taskId ? owners.get(approval.taskId) : null,
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
