import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BasicsForm } from '@/components/agents/wizard/basics-form';
import { WizardFrame } from '@/components/agents/wizard/wizard-frame';
import { parentOptionsByType } from '@/server/agents';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('wizard'))('title') };
}

export default async function NewAgentPage() {
  const { ctx } = await requireSession();
  return (
    <WizardFrame step="basic">
      <BasicsForm parentOptions={await parentOptionsByType(ctx)} />
    </WizardFrame>
  );
}
