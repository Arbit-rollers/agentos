import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { validateWorkflowGraph, workflowSchedules } from '@agentos/core';
import {
  findWorkflow,
  findWorkflowVersion,
  listAgents,
  listMcpConnections,
  listMcpTools,
  listProviderConnections,
  listWorkflowRunSteps,
  listWorkflowRuns,
  listWorkflowVersions,
} from '@agentos/db';
import { Card, CardContent, StatusBadge, cn } from '@agentos/ui';
import { WorkflowBuilder } from '@/components/workflows/builder';
import { DeleteWorkflowButton, RestoreVersionButton } from '@/components/workflows/run-actions';
import { WorkflowRunList } from '@/components/workflows/run-list';
import { isUuid } from '@/server/api';
import { canManageItem } from '@/server/permissions';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const TABS = ['builder', 'runs', 'versions'] as const;
type Tab = (typeof TABS)[number];
type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; run?: string }>;
};

async function load(id: string) {
  const session = await requireSession();
  const workflow = isUuid(id) ? await findWorkflow(getServices().db, session.ctx, id) : undefined;
  if (!workflow) notFound();
  return { session, workflow };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: (await load((await params).id)).workflow.name };
}

/** Workflow Builder, runs and versions (PRD §16, Screen 9). */
export default async function WorkflowPage({ params, searchParams }: Params) {
  const { id } = await params;
  const query = await searchParams;
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : 'builder';
  const { session, workflow } = await load(id);
  const { ctx } = session;
  const db = getServices().db;
  const t = await getTranslations('workflows');
  const format = await getFormatter();
  const canManage = canManageItem(session, workflow.createdBy);

  let body: React.ReactNode;
  if (tab === 'builder') {
    const [version, agents, tools, connections, providers, schedules] = await Promise.all([
      findWorkflowVersion(db, ctx, workflow.currentVersionId!),
      listAgents(db, ctx, { statuses: ['configured', 'active', 'paused'] }),
      listMcpTools(db, ctx),
      listMcpConnections(db, ctx),
      listProviderConnections(db, ctx),
      workflowSchedules(db, ctx, id),
    ]);
    const serverName = new Map(connections.map((c) => [c.id, c.name]));
    const graph = version!.graph;
    body = (
      <WorkflowBuilder
        workflow={{
          id,
          name: workflow.name,
          description: workflow.description,
          active: workflow.active,
          version: version!.version,
        }}
        graph={graph}
        initialIssues={await validateWorkflowGraph(db, ctx, graph)}
        canManage={canManage}
        schedules={schedules.map((s) => ({
          id: s.id,
          name: s.name,
          when: s.cron ?? '',
          timezone: s.timezone,
        }))}
        catalog={{
          agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role })),
          tools: tools
            .filter((tool) => tool.enabled && tool.available)
            .map((tool) => ({
              id: tool.id,
              name: tool.name,
              server: serverName.get(tool.connectionId) ?? '',
              permission: tool.defaultPermission,
              arguments: Object.keys(
                (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
              ),
            })),
          providers: providers.map((p) => ({
            id: p.id,
            name: p.name,
            models: p.models.map((m) => m.id),
          })),
        }}
      />
    );
  } else if (tab === 'runs') {
    const runs = await listWorkflowRuns(db, ctx, id);
    const steps = await listWorkflowRunSteps(
      db,
      ctx,
      runs.map((r) => r.id),
    );
    body = (
      <Card>
        <CardContent className="pt-5">
          <WorkflowRunList
            workflowId={id}
            runs={runs}
            steps={steps}
            openRunId={query.run}
            canCancel={(run) => canManageItem(session, run.triggeredBy)}
          />
        </CardContent>
      </Card>
    );
  } else {
    const versions = await listWorkflowVersions(db, ctx, id);
    body = (
      <Card>
        <CardContent className="pt-5">
          <ul className="divide-y divide-border" aria-label={t('versions')}>
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{t('version', { version: v.version })}</span>
                  {v.id === workflow.currentVersionId && (
                    <StatusBadge tone="info" className="ml-2">
                      {t('current')}
                    </StatusBadge>
                  )}
                  <span className="ml-2 text-text-muted">
                    {v.creatorName} ·{' '}
                    {format.dateTime(v.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </span>
                {canManage && v.id !== workflow.currentVersionId && (
                  <RestoreVersionButton workflowId={id} versionId={v.id} version={v.version} />
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-6 border-t border-border pt-4">
              <DeleteWorkflowButton id={id} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Link
        href="/workflows"
        className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('title')}
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{workflow.name}</h1>
        <StatusBadge tone={workflow.active ? 'success' : 'neutral'}>
          {workflow.active ? t('activeLabel') : t('inactive')}
        </StatusBadge>
      </div>
      <nav aria-label={workflow.name} className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((name) => (
          <Link
            key={name}
            href={name === 'builder' ? `/workflows/${id}` : `/workflows/${id}?tab=${name}`}
            aria-current={tab === name ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === name
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`tabs.${name}`)}
          </Link>
        ))}
      </nav>
      {body}
    </>
  );
}
