import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PageHeader } from '@agentos/ui';
import { SettingsNav } from '@/components/settings/settings-nav';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('settings');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <SettingsNav />
      {children}
    </>
  );
}
