import { Activity, Bot, CircleCheck, Plug, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getDashboardSummary } from '@agentos/core';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatTile,
} from '@agentos/ui';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentStatusBadge } from '@/components/agents/agent-status';
import { Greeting } from '@/components/dashboard/greeting';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { TaskOverviewChart } from '@/components/dashboard/task-overview-chart';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('dashboard') };
}

export default async function DashboardPage() {
  const { ctx, user } = await requireSession();
  const summary = await getDashboardSummary(getServices().db, ctx);
  const t = await getTranslations('dashboard');
  const format = await getFormatter();

  const newAgent = (
    <Button asChild>
      <Link href="/agents/new">
        <Plus aria-hidden />
        {t('newAgent')}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={<Greeting name={user.displayName || user.email} />}
        description={summary.agents.total === 0 ? t('subtitleEmpty') : undefined}
        actions={newAgent}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<Bot />}
          label={t('stats.activeAgents')}
          value={format.number(summary.agents.active)}
          detail={
            summary.agents.paused > 0
              ? t('stats.paused', { count: summary.agents.paused })
              : undefined
          }
        />
        <StatTile
          icon={<Activity />}
          label={t('stats.runningTasks')}
          value={format.number(summary.tasks.running)}
        />
        <StatTile
          icon={<Plug />}
          label={t('stats.mcpConnections')}
          value={format.number(summary.mcpConnections.connected)}
        />
        <StatTile
          icon={<CircleCheck />}
          label={t('stats.successRate')}
          value={
            summary.successRate === null
              ? '—'
              : format.number(summary.successRate, { style: 'percent' })
          }
          detail={summary.successRate === null ? t('stats.noRuns') : undefined}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('yourAgents')}</CardTitle>
          <Link href="/agents" className="text-sm text-primary hover:underline">
            {t('viewAll')}
          </Link>
        </CardHeader>
        <CardContent>
          {summary.agentList.length === 0 ? (
            <EmptyState
              icon={<Bot />}
              title={t('agentsEmptyTitle')}
              description={t('agentsEmptyDescription')}
              action={newAgent}
              className="py-6"
            />
          ) : (
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {summary.agentList.slice(0, 8).map((agent) => (
                <li key={agent.id} className="w-56 shrink-0">
                  <Link
                    href={`/agents/${agent.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 hover:border-border-strong"
                  >
                    <AgentAvatar avatar={agent.avatar} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{agent.name}</span>
                      <span className="mt-1 block">
                        <AgentStatusBadge status={agent.status} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent className="pb-2">
            <RecentActivity events={summary.recentActivity} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('taskOverview')}</CardTitle>
            <span className="text-xs text-text-muted">{t('last7Days')}</span>
          </CardHeader>
          <CardContent>
            <TaskOverviewChart days={summary.taskOverview} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
