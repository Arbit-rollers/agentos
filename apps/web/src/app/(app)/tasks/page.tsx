import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listTasks, type TaskState } from '@agentos/db';
import { Card, CardContent, PageHeader } from '@agentos/ui';
import { QueryTabs } from '@/components/common/query-tabs';
import { TaskTable } from '@/components/tasks/task-table';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const FILTERS: Record<string, TaskState[]> = {
  active: ['queued', 'running'],
  waiting: ['waiting_for_approval', 'waiting_for_agent'],
  completed: ['completed'],
  failed: ['failed', 'cancelled'],
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('tasksPage'))('title') };
}

/** Tasks (PRD §14, Screen 8). Creating and scheduling tasks directly arrives in v0.2. */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { ctx } = await requireSession();
  const t = await getTranslations('tasksPage');
  const requested = (await searchParams).filter ?? 'all';
  const filter = requested in FILTERS ? requested : 'all';
  const tasks = await listTasks(getServices().db, ctx, { limit: 200 });
  const count = (key: string) => tasks.filter((task) => FILTERS[key]!.includes(task.state)).length;
  const shown =
    filter === 'all' ? tasks : tasks.filter((task) => FILTERS[filter]!.includes(task.state));

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="mb-5">
        <QueryTabs
          param="filter"
          value={filter}
          label={t('title')}
          tabs={[
            { value: 'all', label: t('filters.all'), count: tasks.length },
            ...Object.keys(FILTERS).map((key) => ({
              value: key,
              label: t(`filters.${key as 'active'}`),
              count: count(key),
            })),
          ]}
        />
      </div>
      <Card>
        <CardContent className="pt-5">
          <TaskTable tasks={shown} />
        </CardContent>
      </Card>
    </>
  );
}
