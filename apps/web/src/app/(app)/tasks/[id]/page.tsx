import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  findAgent,
  findTask,
  listRunsWithDetails,
  listTaskHistory,
  listTasksByIds,
} from '@agentos/db';
import { Card, CardContent, CardHeader, CardTitle, StatusBadge } from '@agentos/ui';
import { Markdown } from '@/components/markdown';
import { RunLog } from '@/components/runs/run-log';
import { DelegationTree, loadDelegationTree } from '@/components/tasks/delegation-tree';
import { TaskActions } from '@/components/tasks/task-actions';
import { TASK_TONE } from '@/components/tasks/task-table';
import { isUuid } from '@/server/api';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  const { ctx } = await requireSession();
  const task = isUuid(id) ? await findTask(getServices().db, ctx, id) : undefined;
  if (!task) notFound();
  return { ctx, task };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: (await load((await params).id)).task.objective.slice(0, 60) };
}

/** Task detail: output, state history and runs (PRD §14, §22). */
export default async function TaskPage({ params }: Params) {
  const { ctx, task } = await load((await params).id);
  const db = getServices().db;
  const t = await getTranslations();
  const format = await getFormatter();
  const [agent, history, runs, blockers, delegated, parent] = await Promise.all([
    findAgent(db, ctx, task.agentId),
    listTaskHistory(db, ctx, task.id),
    listRunsWithDetails(db, ctx, { taskId: task.id, limit: 20 }),
    listTasksByIds(db, ctx, task.dependsOn),
    loadDelegationTree(ctx, task.id),
    task.parentTaskId ? findTask(db, ctx, task.parentTaskId) : undefined,
  ]);
  const parentAgent = parent ? await findAgent(db, ctx, parent.agentId) : undefined;
  const active = ['queued', 'running', 'waiting_for_agent', 'waiting_for_approval'].includes(
    task.state,
  );
  const note = (value: string | null) => {
    if (!value) return null;
    const [code, detail] = value.split(':');
    if (code?.startsWith('retry_'))
      return `${t('tasksPage.attempt', { n: code.slice(6) })} · ${t.has(`errors.${detail}` as never) ? t(`errors.${detail}` as never) : detail}`;
    if (t.has(`tasksPage.notes.${value}` as never)) return t(`tasksPage.notes.${value}` as never);
    return t.has(`errors.${value}` as never) ? t(`errors.${value}` as never) : value;
  };

  return (
    <>
      <Link
        href="/tasks"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('tasksPage.back')}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{task.objective}</h1>
            <StatusBadge tone={TASK_TONE[task.state]}>{t(`taskStates.${task.state}`)}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {agent && (
              <Link href={`/agents/${agent.id}`} className="hover:text-primary">
                {agent.name}
              </Link>
            )}
            {' · '}
            {t(`tasksPage.origins.${task.origin as 'manual'}`)} ·{' '}
            {t(`tasksPage.priorities.${String(task.priority) as '0'}`)}
            {task.attempt > 0 && ` · ${t('tasksPage.attempt', { n: task.attempt + 1 })}`}
            {task.dueAt &&
              ` · ${t('tasksPage.due', { time: format.dateTime(task.dueAt, { dateStyle: 'medium', timeStyle: 'short' }) })}`}
          </p>
          {parent && (
            <p className="mt-1 text-sm text-text-muted">
              {t('tasksPage.delegatedBy', { agent: parentAgent?.name ?? '—' })} ·{' '}
              <Link href={`/tasks/${parent.id}`} className="text-primary hover:underline">
                {t('tasksPage.openParent')}
              </Link>
            </p>
          )}
          {blockers.length > 0 && (
            <p className="mt-1 text-sm text-text-muted">
              {t('tasksPage.dependsOn')}:{' '}
              {blockers.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ', '}
                  <Link href={`/tasks/${b.id}`} className="hover:text-primary">
                    {b.objective}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <TaskActions
          id={task.id}
          canCancel={active}
          canRetry={task.state === 'failed' || task.state === 'cancelled'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {task.input && (
            <Card>
              <CardHeader>
                <CardTitle>{t('tasksPage.input')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{task.input}</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('tasksPage.output')}</CardTitle>
            </CardHeader>
            <CardContent>
              {task.error && (
                <p role="alert" className="mb-2 text-sm text-danger">
                  {t('tasksPage.error')}: {note(task.error)}
                </p>
              )}
              {task.output ? (
                <Markdown>{task.output}</Markdown>
              ) : (
                !task.error && <p className="text-sm text-text-muted">{t('tasksPage.noOutput')}</p>
              )}
            </CardContent>
          </Card>
          {delegated.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('tasksPage.delegatedTo')}</CardTitle>
              </CardHeader>
              <CardContent>
                <DelegationTree nodes={delegated} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('tasksPage.runs')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RunLog runs={runs} />
            </CardContent>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t('tasksPage.history')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol
              className="space-y-3 border-l border-border pl-4"
              aria-label={t('tasksPage.history')}
            >
              {history.map((entry) => (
                <li key={entry.id} className="text-sm">
                  <StatusBadge tone={TASK_TONE[entry.state]}>
                    {t(`taskStates.${entry.state}`)}
                  </StatusBadge>
                  <time
                    className="ml-2 text-xs text-text-subtle"
                    dateTime={entry.createdAt.toISOString()}
                  >
                    {format.dateTime(entry.createdAt, { timeStyle: 'medium', dateStyle: 'short' })}
                  </time>
                  {note(entry.note) && (
                    <p className="mt-0.5 text-xs text-text-muted">{note(entry.note)}</p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
