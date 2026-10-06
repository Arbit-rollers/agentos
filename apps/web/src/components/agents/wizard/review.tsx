import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { readinessErrors } from '@agentos/core';
import type { AgentWithPersonality } from '@agentos/db';
import { compilePersonality } from '@agentos/personality';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@agentos/ui';
import { AgentAvatar } from '../agent-avatar';
import { FinishButtons } from './finish-buttons';
import { stepHref } from './steps';
import { WizardNav } from './wizard-nav';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-sm whitespace-pre-line">{children}</dd>
    </div>
  );
}

export async function Review({
  agent,
  parentName,
}: {
  agent: AgentWithPersonality;
  parentName?: string;
}) {
  const t = await getTranslations();
  const missing = Object.values(readinessErrors(agent)).flat();
  const directives = compilePersonality(agent.personality?.traitScores).directives;
  const list = (items: string[]) => (items.length ? items.join('\n') : t('agents.none'));
  const edit = (step: 'basic' | 'personality') => (
    <Button variant="ghost" size="sm" asChild>
      <Link href={stepHref(agent.id, step)}>
        <Pencil aria-hidden />
        {t('wizard.editStep')}
      </Link>
    </Button>
  );

  return (
    <>
      <p className="mb-4 text-text-muted">{t('wizard.reviewDescription')}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('wizard.steps.basic')}</CardTitle>
            {edit('basic')}
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-center gap-3">
              <AgentAvatar avatar={agent.avatar} />
              <div>
                <p className="font-medium">{agent.name}</p>
                <p className="text-sm text-text-muted">{t(`agents.types.${agent.agentType}`)}</p>
              </div>
            </div>
            <dl className="divide-y divide-border">
              <Row label={t('wizard.description')}>{agent.description}</Row>
              <Row label={t('agents.reportsTo')}>{parentName ?? t('agents.noParent')}</Row>
              <Row label={t('agents.tags')}>{agent.tags.join(', ') || t('agents.none')}</Row>
              <Row label={t('agents.role')}>{agent.role || t('agents.none')}</Row>
              <Row label={t('agents.job')}>{agent.jobDefinition || t('agents.none')}</Row>
              <Row label={t('agents.goals')}>{list(agent.goals)}</Row>
              <Row label={t('agents.constraints')}>{list(agent.constraints)}</Row>
            </dl>
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>
              {t('agents.personality')}
              {agent.personality && (
                <span className="ml-2 text-sm font-normal text-text-muted">
                  {t(`presets.${agent.personality.preset as 'custom'}`)}
                </span>
              )}
            </CardTitle>
            {edit('personality')}
          </CardHeader>
          <CardContent>
            {directives.length === 0 ? (
              <p className="text-sm text-text-muted">{t('wizard.noDirectives')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {directives.map((d) => (
                  <li key={d.id} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {t(`directives.${d.id}`)}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {missing.length > 0 && agent.status === 'draft' && (
        <div
          role="status"
          className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <p className="font-medium">{t('wizard.missing')}</p>
          <ul className="mt-1 list-disc pl-5 text-text-muted">
            {missing.map((code) => (
              <li key={code}>{t(`errors.${code as 'role_required'}`)}</li>
            ))}
          </ul>
        </div>
      )}

      <WizardNav
        backHref={stepHref(agent.id, 'permissions')}
        primary={
          agent.status === 'draft' ? (
            <FinishButtons agentId={agent.id} ready={missing.length === 0} />
          ) : (
            <Button asChild>
              <Link href={`/agents/${agent.id}`}>{t('wizard.done')}</Link>
            </Button>
          )
        }
      />
    </>
  );
}
