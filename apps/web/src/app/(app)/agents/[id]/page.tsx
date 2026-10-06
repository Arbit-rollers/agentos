import { Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { allowedActions, canAgentRun } from '@agentos/core';
import { findAgent, listAgentRuns, listChildAgents, listProviderConnections } from '@agentos/db';
import { TRAITS, compilePersonality, normalizeTraits } from '@agentos/personality';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@agentos/ui';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentStatusBadge } from '@/components/agents/agent-status';
import { RecentRuns } from '@/components/agents/recent-runs';
import { TryAgent } from '@/components/agents/try-agent';
import { StatusActions } from '@/components/agents/status-actions';
import { stepHref } from '@/components/agents/wizard/steps';
import { loadAgentOr404 } from '@/server/agents';
import { brainValue } from '@/server/models';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ctx } = await requireSession();
  return { title: (await loadAgentOr404(ctx, (await params).id)).name };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-text-muted uppercase">{title}</h3>
      <div className="text-sm whitespace-pre-line">{children}</div>
    </div>
  );
}

/**
 * Agent overview. The full six-tab Agent Workspace (Chat, Tasks, Tools, Files, Memory, Logs)
 * replaces this page in M6 (PRD §20).
 */
export default async function AgentPage({ params }: Params) {
  const { id } = await params;
  const { ctx } = await requireSession();
  const db = getServices().db;
  const agent = await loadAgentOr404(ctx, id);
  const [parent, children, brain, connections, runs, canRun] = await Promise.all([
    agent.parentAgentId ? findAgent(db, ctx, agent.parentAgentId) : undefined,
    listChildAgents(db, ctx, id),
    brainValue(ctx, id),
    listProviderConnections(db, ctx),
    listAgentRuns(db, ctx, id, 8),
    canAgentRun(db, ctx, id),
  ]);
  const connectionName = new Map(connections.map((c) => [c.id, c.name]));
  const targetLabel = (target: { connectionId: string; model: string }) =>
    `${connectionName.get(target.connectionId) ?? '?'} · ${target.model}`;
  const t = await getTranslations();
  const format = await getFormatter();
  const traits = normalizeTraits(agent.personality?.traitScores);
  const directives = compilePersonality(traits).directives;
  const archived = agent.status === 'archived';
  const list = (items: string[]) =>
    items.length ? (
      <ul className="list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ) : (
      <span className="text-text-muted">{t('agents.none')}</span>
    );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <AgentAvatar avatar={agent.avatar} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
              <AgentStatusBadge status={agent.status} />
            </div>
            <p className="text-text-muted">
              {t(`agents.types.${agent.agentType}`)}
              {agent.role && ` · ${agent.role}`}
            </p>
            <p className="mt-0.5 text-xs text-text-subtle">
              {t('agents.updated', { time: format.relativeTime(agent.updatedAt, new Date()) })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {!archived && (
            <Button variant="secondary" asChild>
              <Link href={stepHref(id, 'basic')}>
                <Pencil aria-hidden />
                {t('agents.edit')}
              </Link>
            </Button>
          )}
          <StatusActions agentId={id} actions={allowedActions(agent)} canRun={canRun} />
        </div>
      </div>

      {archived && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted"
        >
          {t('agents.archivedNotice')}
        </p>
      )}
      {agent.status === 'configured' && !canRun && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm"
        >
          {t('agents.activateNeedsModel')}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-5 pt-5">
              <p>{agent.description}</p>
              <Section title={t('agents.role')}>{agent.role || t('agents.none')}</Section>
              <Section title={t('agents.job')}>{agent.jobDefinition || t('agents.none')}</Section>
              <div className="grid gap-5 sm:grid-cols-2">
                <Section title={t('agents.goals')}>{list(agent.goals)}</Section>
                <Section title={t('agents.constraints')}>{list(agent.constraints)}</Section>
              </div>
              {agent.tags.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={t('agents.tags')}>
                  {agent.tags.map((tag) => (
                    <li key={tag} className="rounded-full bg-surface-3 px-2.5 py-0.5 text-xs">
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('brain.title')}</CardTitle>
              {!archived && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={stepHref(id, 'personality')}>
                    <Pencil aria-hidden />
                    {brain ? t('agents.edit') : t('runs.configureBrain')}
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!brain ? (
                <p className="text-text-muted">{t('runs.aiBrainNotSet')}</p>
              ) : (
                <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-text-muted">{t('brain.strategy')}</dt>
                  <dd>{t(`brain.strategies.${brain.strategy}`)}</dd>
                  <dt className="text-text-muted">{t('brain.primary')}</dt>
                  <dd className="font-mono text-xs">{targetLabel(brain.primary)}</dd>
                  {brain.routes.length > 0 && (
                    <>
                      <dt className="text-text-muted">{t('runs.routesLabel')}</dt>
                      <dd className="space-y-0.5">
                        {brain.routes.map((r) => (
                          <p key={r.category}>
                            {t(`brain.categories.${r.category as 'general'}`)} →{' '}
                            <span className="font-mono text-xs">{targetLabel(r)}</span>
                          </p>
                        ))}
                      </dd>
                    </>
                  )}
                  {brain.fallbacks.length > 0 && (
                    <>
                      <dt className="text-text-muted">{t('runs.fallbacksLabel')}</dt>
                      <dd className="font-mono text-xs">
                        {brain.fallbacks.map(targetLabel).join(' → ')}
                      </dd>
                    </>
                  )}
                  {(brain.budget.perTaskUsd !== undefined ||
                    brain.budget.dailyUsd !== undefined) && (
                    <>
                      <dt className="text-text-muted">{t('runs.budgetLabel')}</dt>
                      <dd>
                        {[
                          brain.budget.perTaskUsd !== undefined &&
                            t('runs.perTask', {
                              amount: format.number(brain.budget.perTaskUsd, {
                                style: 'currency',
                                currency: 'USD',
                              }),
                            }),
                          brain.budget.dailyUsd !== undefined &&
                            t('runs.daily', {
                              amount: format.number(brain.budget.dailyUsd, {
                                style: 'currency',
                                currency: 'USD',
                              }),
                            }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </>
                  )}
                </dl>
              )}
            </CardContent>
          </Card>

          {brain && !archived && (
            <Card>
              <CardHeader className="flex-col items-start gap-1">
                <CardTitle>{t('runs.tryTitle')}</CardTitle>
                <p className="text-sm text-text-muted">{t('runs.tryHint')}</p>
              </CardHeader>
              <CardContent>
                <TryAgent agentId={id} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('runs.recentRuns')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentRuns runs={runs} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('agents.hierarchy')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm">
                <span className="text-text-muted">{t('agents.reportsTo')}: </span>
                {parent ? (
                  <Link href={`/agents/${parent.id}`} className="text-primary hover:underline">
                    {parent.name}
                  </Link>
                ) : (
                  t('agents.noParent')
                )}
              </p>
              <h3 className="mb-1 text-xs font-medium text-text-muted uppercase">
                {t('agents.directReports')}
              </h3>
              {children.length === 0 ? (
                <p className="text-sm text-text-muted">{t('agents.noDirectReports')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/agents/${child.id}`}
                        className="flex items-center gap-3 py-2 hover:text-primary"
                      >
                        <AgentAvatar avatar={child.avatar} size="sm" />
                        <span className="flex-1 truncate text-sm">{child.name}</span>
                        <AgentStatusBadge status={child.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>
              {t('agents.personality')}
              {agent.personality && (
                <span className="ml-2 text-sm font-normal text-text-muted">
                  {t(`presets.${agent.personality.preset as 'custom'}`)} ·{' '}
                  {t('agents.version', { version: agent.personality.version })}
                </span>
              )}
            </CardTitle>
            {!archived && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={stepHref(id, 'personality')} aria-label={t('agents.editPersonality')}>
                  <Pencil aria-hidden />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            <dl aria-label={t('agents.traitsLabel')} className="space-y-2">
              {TRAITS.map((trait) => (
                <div
                  key={trait}
                  className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-sm"
                >
                  <dt className="truncate text-text-muted">{t(`traits.${trait}.name`)}</dt>
                  <dd className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${traits[trait]}%` }}
                    />
                  </dd>
                  <dd className="text-right tabular-nums">{traits[trait]}</dd>
                </div>
              ))}
            </dl>
            <Section title={t('agents.runtimeDirectives')}>
              {directives.length === 0 ? (
                <span className="text-text-muted">{t('wizard.noDirectives')}</span>
              ) : (
                <ul className="space-y-1.5 whitespace-normal">
                  {directives.map((d) => (
                    <li key={d.id} className="flex gap-2">
                      <span
                        aria-hidden
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                      />
                      {t(`directives.${d.id}`)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
