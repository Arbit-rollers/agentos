import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { Task } from '@agentos/db';
import {
  StatusBadge,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type StatusTone,
} from '@agentos/ui';

export const TASK_TONE: Record<Task['state'], StatusTone> = {
  draft: 'neutral',
  queued: 'neutral',
  running: 'info',
  waiting_for_agent: 'info',
  waiting_for_approval: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** Tasks (PRD §14, Screen 8). */
export async function TaskTable({
  tasks,
  showAgent = true,
}: {
  tasks: (Task & { agentName: string })[];
  showAgent?: boolean;
}) {
  const t = await getTranslations();
  const format = await getFormatter();
  if (tasks.length === 0) return <p className="text-sm text-text-muted">{t('tasksPage.empty')}</p>;
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeaderCell>{t('tasksPage.objective')}</TableHeaderCell>
          {showAgent && <TableHeaderCell>{t('tasksPage.agent')}</TableHeaderCell>}
          <TableHeaderCell>{t('tasksPage.state')}</TableHeaderCell>
          <TableHeaderCell>{t('tasksPage.type')}</TableHeaderCell>
          <TableHeaderCell className="text-right">{t('tasksPage.created')}</TableHeaderCell>
        </tr>
      </TableHead>
      <tbody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="max-w-md">
              <Link href={`/tasks/${task.id}`} className="block truncate hover:text-primary">
                {task.objective}
              </Link>
              {task.state === 'queued' && task.dependsOn.length > 0 && (
                <span className="text-xs text-text-subtle">
                  {t('tasksPage.waitsFor', { count: task.dependsOn.length })}
                </span>
              )}
            </TableCell>
            {showAgent && (
              <TableCell>
                <Link href={`/agents/${task.agentId}`} className="hover:text-primary">
                  {task.agentName}
                </Link>
              </TableCell>
            )}
            <TableCell>
              <StatusBadge tone={TASK_TONE[task.state]}>
                {t(`taskStates.${task.state}`)}
              </StatusBadge>
            </TableCell>
            <TableCell className="text-text-muted">
              {t(`tasksPage.origins.${task.origin as 'manual'}`)}
            </TableCell>
            <TableCell className="text-right text-text-muted">
              <time dateTime={task.createdAt.toISOString()}>
                {format.dateTime(task.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </Table>
  );
}
