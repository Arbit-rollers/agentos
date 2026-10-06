import { Plug, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { findAgent } from '@agentos/db';
import { normalizeTraits } from '@agentos/personality';
import { Card, EmptyState } from '@agentos/ui';
import { BasicsForm } from '@/components/agents/wizard/basics-form';
import { PersonalityEditor } from '@/components/agents/wizard/personality-editor';
import { Review } from '@/components/agents/wizard/review';
import { WIZARD_STEPS, stepHref, type WizardStep } from '@/components/agents/wizard/steps';
import { WizardFrame } from '@/components/agents/wizard/wizard-frame';
import { WizardNav } from '@/components/agents/wizard/wizard-nav';
import { loadAgentOr404, parentOptionsByType } from '@/server/agents';
import { brainOptions, brainValue } from '@/server/models';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

type Params = { params: Promise<{ id: string; step: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('wizard'))('title') };
}

export default async function AgentSetupPage({ params }: Params) {
  const { id, step } = await params;
  if (!WIZARD_STEPS.includes(step as WizardStep)) notFound();
  const { ctx } = await requireSession();
  const agent = await loadAgentOr404(ctx, id);
  if (agent.status === 'archived') redirect(`/agents/${id}`);
  const t = await getTranslations('wizard');

  let body;
  switch (step as WizardStep) {
    case 'basic':
      body = <BasicsForm agent={agent} parentOptions={await parentOptionsByType(ctx, id)} />;
      break;
    case 'personality':
      body = (
        <PersonalityEditor
          agentId={id}
          initial={normalizeTraits(agent.personality?.traitScores)}
          connections={await brainOptions(ctx)}
          brain={await brainValue(ctx, id)}
        />
      );
      break;
    case 'tools':
    case 'permissions':
      // Arrive with the MCP Hub in M5.
      body = (
        <>
          <Card>
            <EmptyState
              icon={step === 'tools' ? <Plug /> : <ShieldCheck />}
              title={t(`steps.${step as 'tools'}`)}
              description={t(step === 'tools' ? 'toolsComingSoon' : 'permissionsComingSoon')}
            />
          </Card>
          <WizardNav
            backHref={stepHref(id, step === 'tools' ? 'personality' : 'tools')}
            nextHref={stepHref(id, step === 'tools' ? 'permissions' : 'review')}
          />
        </>
      );
      break;
    case 'review': {
      const parent = agent.parentAgentId
        ? await findAgent(getServices().db, ctx, agent.parentAgentId)
        : undefined;
      body = <Review agent={agent} parentName={parent?.name} />;
      break;
    }
  }

  return (
    <WizardFrame step={step as WizardStep} agent={agent}>
      {body}
    </WizardFrame>
  );
}
