import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@agentos/ui';
import { ConnectForm } from '@/components/mcp/connect-form';
import { templateFor } from '@/components/mcp/templates';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mcp'))('connect') };
}

export default async function ConnectMcpPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  await requireSession();
  const t = await getTranslations('mcp');
  const template = templateFor((await searchParams).template ?? '');
  return (
    <>
      <PageHeader title={t('connect')} description={t('subtitle')} />
      <ConnectForm
        template={template?.key}
        templateName={template ? t(`templates.${template.key}.name`) : undefined}
      />
    </>
  );
}
