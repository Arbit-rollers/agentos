import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { allowedActions } from '@agentos/core';
import type { Agent, AgentWithPersonality } from '@agentos/db';
import { TRAITS, compilePersonality, normalizeTraits } from '@agentos/personality';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@agentos/ui';
import { AgentAvatar } from './agent-avatar';
import { AgentStatusBadge } from './agent-status';
import type { BrainValue } from './brain-types';
import { StatusActions } from './status-actions';
import { stepHref } from './wizard/steps';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-text-muted uppercase">{title}</h3>
      <div className="text-sm whitespace-pre-line">{children}</div>
    </div>
  );
}

/**
 * The agent's configuration at a glance: the Settings drawer of the Agent Workspace
 * (PRD v1.2 §20: Personality, Role & Instructions, AI Brain, Budgets, General).
 */
export async function AgentOverview({
  agent,
  parent,
  children,
  brain,
  connectionNames,
  canRun,
}: {
  agent: AgentWithPersonality;
  parent?: Agent;
  children: Agent[];
  brain: BrainValue | null;
  connectionNames: Map<string, string>;
  canRun: boolean;
}) {
  const t = await getTranslations();
  const format = await getFormatter();
  const id = agent.id;
  const archived = agent.status === 'archived';
  const traits = normalizeTraits(agent.personality?.traitScores);
  const directives = compilePersonality(traits).directives;
  const targetLabel = (target: { connectionId: string; model: string }) =>
    `${connectionNames.get(target.connectionId) ?? '?'} · ${target.model}`;
  const usd = (amount: number) => format.number(amount, { style: 'currency', currency: 'USD' });
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
  const edit = (step: 'basic' | 'personality', label: string) =>
    !archived && (
      <Button variant="ghost" size="sm" asChild>
        <Link href={stepHref(id, step)}>
          <Pencil aria-hidden />
          {label}
        </Link>
      </Button>
    );

  return (
    <div className="space-y-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AgentStatusBadge status={agent.status} />
          <span className="text-sm text-text-muted">
            {t(`agents.types.${agent.agentType}`)} ·{' '}
            {t('agents.updated', { time: format.relativeTime(agent.updatedAt, new Date()) })}
          </span>
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
          className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted"
        >
          {t('agents.archivedNotice')}
        </p>
      )}
      {agent.status === 'configured' && !canRun && (
        <p role="status" className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
          {t('agents.activateNeedsModel')}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('wizard.roleTitle')}</CardTitle>
          {edit('basic', t('agents.edit'))}
        </CardHeader>
        <CardContent className="space-y-5">
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
          {edit('personality', brain ? t('agents.edit') : t('runs.configureBrain'))}
        </CardHeader>
        <CardContent className="text-sm">
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
              <dt className="text-text-muted">{t('runs.budgetLabel')}</dt>
              <dd>
                {[
                  brain.budget.perTaskUsd !== undefined &&
                    t('runs.perTask', { amount: usd(brain.budget.perTaskUsd) }),
                  brain.budget.dailyUsd !== undefined &&
                    t('runs.daily', { amount: usd(brain.budget.dailyUsd) }),
                  `${t('brain.maxToolCalls')}: ${brain.budget.maxToolCalls ?? 10}`,
                  `${t('brain.maxRuntimeSeconds')}: ${brain.budget.maxRuntimeSeconds ?? 300}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
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
          {edit('personality', t('agents.editPersonality'))}
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
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
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {t(`directives.${d.id}`)}
                  </li>
                ))}
              </ul>
            )}
          </Section>
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
          {(agent.agentType === 'master_orchestrator' || agent.agentType === 'manager') && (
            <p className="mb-2 text-xs text-text-muted" data-testid="team-hint">
              {children.length > 0
                ? t('workspace.teamHint', { agents: children.map((c) => c.name).join(', ') })
                : t('workspace.noTeam')}
            </p>
          )}
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
  );
}
