import { Workflow as WorkflowIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listSchedules, listWorkflows } from '@agentos/db';
import {
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@agentos/ui';
import { NewWorkflowDialog } from '@/components/workflows/new-workflow-dialog';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('workflows'))('title') };
}

/** Workflows (PRD §16). */
export default async function WorkflowsPage() {
  const { ctx } = await requireSession();
  const db = getServices().db;
  const t = await getTranslations('workflows');
  const format = await getFormatter();
  const [workflows, schedules] = await Promise.all([
    listWorkflows(db, ctx),
    listSchedules(db, ctx),
  ]);

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} actions={<NewWorkflowDialog />} />
      {workflows.length === 0 ? (
        <Card>
          <EmptyState icon={<WorkflowIcon />} title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <Card className="p-2">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('name')}</TableHeaderCell>
                <TableHeaderCell>{t('status')}</TableHeaderCell>
                <TableHeaderCell>{t('trigger')}</TableHeaderCell>
                <TableHeaderCell>{t('updated')}</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {workflows.map((w) => {
                const own = schedules.filter((s) => s.workflowId === w.id);
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      <Link href={`/workflows/${w.id}`} className="font-medium hover:text-primary">
                        {w.name}
                      </Link>
                      <p className="text-xs text-text-muted">
                        {w.version !== null && t('version', { version: w.version })} ·{' '}
                        {w.creatorName}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={w.active ? 'success' : 'neutral'}>
                        {w.active ? t('activeLabel') : t('inactive')}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {own.length === 0 ? t('manual') : own.map((s) => s.cron ?? '').join(', ')}
                    </TableCell>
                    <TableCell className="text-sm text-text-muted">
                      {format.relativeTime(w.updatedAt, new Date())}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
