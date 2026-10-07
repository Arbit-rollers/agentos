import { CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { nextRunAt } from '@agentos/core';
import { listAgents, listSchedules } from '@agentos/db';
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
import { NewScheduleDialog } from '@/components/schedules/new-schedule-dialog';
import { ScheduleActions } from '@/components/schedules/schedule-actions';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('schedules'))('title') };
}

/** Schedules (PRD §17). */
export default async function SchedulesPage() {
  const { ctx } = await requireSession();
  const db = getServices().db;
  const t = await getTranslations('schedules');
  const format = await getFormatter();
  const [schedules, agents] = await Promise.all([
    listSchedules(db, ctx),
    listAgents(db, ctx, { statuses: ['active', 'configured', 'paused'] }),
  ]);
  const now = new Date();
  const at = (date: Date | null, timeZone: string) =>
    date
      ? format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short', timeZone })
      : t('never');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={<NewScheduleDialog agents={agents.map((a) => ({ id: a.id, name: a.name }))} />}
      />
      {schedules.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarClock />} title={t('empty')} />
        </Card>
      ) : (
        <Card className="p-2">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('name')}</TableHeaderCell>
                <TableHeaderCell>{t('whenLabel')}</TableHeaderCell>
                <TableHeaderCell>{t('nextRun')}</TableHeaderCell>
                <TableHeaderCell>{t('lastRun')}</TableHeaderCell>
                <TableHeaderCell />
              </tr>
            </TableHead>
            <tbody>
              {schedules.map((s) => {
                const status = s.active
                  ? 'active'
                  : s.kind === 'once' && s.lastFiredAt
                    ? 'done'
                    : 'paused';
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-text-muted">
                        <Link href={`/agents/${s.agentId}`} className="hover:text-primary">
                          {s.agentName}
                        </Link>{' '}
                        · {s.objective}
                      </p>
                      <StatusBadge
                        tone={status === 'active' ? 'success' : 'neutral'}
                        className="mt-1"
                      >
                        {t(status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {s.kind === 'once' ? at(s.runAt, s.timezone) : s.cron}
                      </span>
                      <p className="text-xs text-text-subtle">{s.timezone}</p>
                    </TableCell>
                    <TableCell className="text-sm">{at(nextRunAt(s, now), s.timezone)}</TableCell>
                    <TableCell className="text-sm">
                      {s.lastTaskId ? (
                        <Link href={`/tasks/${s.lastTaskId}`} className="hover:text-primary">
                          {at(s.lastFiredAt, s.timezone)}
                        </Link>
                      ) : (
                        t('never')
                      )}
                    </TableCell>
                    <TableCell>
                      <ScheduleActions id={s.id} name={s.name} active={s.active} />
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
