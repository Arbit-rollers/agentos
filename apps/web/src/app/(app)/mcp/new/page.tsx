import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@agentos/ui';
import { ConnectForm } from '@/components/mcp/connect-form';
import { GoogleWorkspaceForm } from '@/components/mcp/google-workspace-form';
import { templateFor } from '@/components/mcp/templates';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

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
  const { env, mcpDeps } = getServices();
  const redirectUri = `${env.APP_URL.replace(/\/+$/, '')}/api/mcp/oauth/callback`;
  return (
    <>
      <PageHeader title={t('connect')} description={t('subtitle')} />
      {template?.key === 'google_workspace' ? (
        <GoogleWorkspaceForm
          platformAvailable={Boolean(mcpDeps.googleClient)}
          redirectUri={redirectUri}
        />
      ) : (
        <ConnectForm
          template={template?.key}
          templateName={template ? t(`templates.${template.key}.name`) : undefined}
          redirectUri={redirectUri}
        />
      )}
    </>
  );
}
