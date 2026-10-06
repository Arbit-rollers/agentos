import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PageHeader, Stepper } from '@agentos/ui';
import { WIZARD_STEPS, stepHref, type WizardStep } from './steps';

/** Page header + stepper shared by every wizard step (PRD §19, Screens 4–6). */
export async function WizardFrame({
  step,
  agent,
  children,
}: {
  step: WizardStep;
  agent?: { id: string; name: string; status: string };
  children: ReactNode;
}) {
  const t = await getTranslations('wizard');
  const editing = agent && agent.status !== 'draft';
  return (
    <>
      <PageHeader title={editing ? t('editTitle', { name: agent.name }) : t('title')} />
      <div className="mb-6">
        <Stepper
          label={t('stepsLabel')}
          steps={WIZARD_STEPS.map((s) => t(`steps.${s}`))}
          current={WIZARD_STEPS.indexOf(step)}
          hrefs={agent ? WIZARD_STEPS.map((s) => stepHref(agent.id, s)) : undefined}
          linkAs={Link}
        />
      </div>
      {children}
    </>
  );
}
